import type Database from 'better-sqlite3';
import { closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, renameSync, rmdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { access, lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { DeleteMediaResult } from '@luvia/contracts';
import { appendLibraryChange } from './library-changes.ts';
import { virtualPath } from './paths.ts';
import { materializeFolders } from '../worker/scan.ts';
import { publishLibraryEvent } from '../worker/watch-events.ts';
import { statFields } from '../watch/file-info.ts';

export type MediaDeleteSource = { size: number; modifiedAt: number; generation: number };
type FileRow = {
  id: string; library_id: string; relative_path: string; folder: string; name: string;
  size: number; modified_at: number; cache_generation: number; missing_at_ms: number | null;
  mtime_ms: number | null; dev: string | null; ino: string | null; head_hash: string | null;
  root: string; enabled: number;
};
type OperationRow = {
  operation_id: string; media_id: string; library_id: string; relative_path: string;
  source_size: number; source_modified: number; source_generation: number; state: 'pending' | 'file_deleted' | 'deleted' | 'failed';
};

export class MediaDeleteError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const activeOperations = new Set<string>();
const now = () => Math.floor(Date.now() / 1000);
const sourceMatches = (row: { size: number; modified_at: number; cache_generation: number }, source: MediaDeleteSource) =>
  row.size === source.size && row.modified_at === source.modifiedAt && row.cache_generation === source.generation;

const stageDirectory = (parent: string, operationId: string) =>
  path.join(parent, `.luvia-delete-${createHash('sha256').update(operationId).digest('hex')}`);

/** 将暂存文件恢复到空闲的原路径；已有不同文件时保留暂存文件等待处理。 */
function restoreStagedFile(stage: string, target: string): void {
  try {
    linkSync(stage, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const a = lstatSync(stage, { bigint: true });
    const b = lstatSync(target, { bigint: true });
    if (a.dev !== b.dev || a.ino !== b.ino) throw error;
  }
  unlinkSync(stage);
}

function lstatIfPresent(file: string) {
  try { return lstatSync(file, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

function syncDirectory(directory: string): void {
  if (process.platform !== 'linux') return;
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** 文件系统操作在 SQLite 写事务内串行执行，避免其他 API 实例同时恢复同一删除。 */
function recoverPendingStage(db: Database.Database, op: OperationRow, parent: string): 'restart' | 'finish' {
  return db.transaction(() => {
    const current = db.prepare('SELECT state FROM media_operations WHERE operation_id=?').get(op.operation_id) as { state: OperationRow['state'] } | undefined;
    if (!current || current.state === 'failed') return 'restart';
    if (current.state === 'deleted' || current.state === 'file_deleted') return 'finish';
    const target = path.join(parent, path.basename(op.relative_path));
    const stageDir = stageDirectory(parent, op.operation_id);
    const stageInfo = lstatIfPresent(stageDir);
    if (stageInfo) {
      if (!stageInfo.isDirectory() || stageInfo.isSymbolicLink()) throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '删除暂存目录异常');
      const staged = path.join(stageDir, 'source');
      if (lstatIfPresent(staged)) {
        try { restoreStagedFile(staged, target); }
        catch { throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '原路径已被占用，待删除文件保留在暂存目录'); }
      }
      try { rmdirSync(stageDir); }
      catch { throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '删除暂存目录无法清理'); }
    }
    if (!lstatIfPresent(target)) throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '文件已不可见，无法确认删除状态，请检查媒体库');
    db.prepare("DELETE FROM media_operations WHERE operation_id=? AND state='pending'").run(op.operation_id);
    return 'restart';
  }).immediate();
}

function finishStagedDelete(db: Database.Database, op: OperationRow, parent: string): void {
  db.transaction(() => {
    const current = db.prepare('SELECT state,stage_state,stage_dev,stage_ino,stage_mtime_ns FROM media_operations WHERE operation_id=?').get(op.operation_id) as
      { state: OperationRow['state']; stage_state: string | null; stage_dev: string | null; stage_ino: string | null; stage_mtime_ns: string | null } | undefined;
    if (!current || current.state === 'deleted') return;
    if (current.state !== 'file_deleted') throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '删除状态待恢复');
    if (current.stage_state === 'unlinked') return;
    if (current.stage_state !== 'prepared') throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '删除阶段无法确认，请检查媒体库');
    const stageDir = stageDirectory(parent, op.operation_id);
    const stageInfo = lstatIfPresent(stageDir);
    if (!stageInfo) throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '暂存目录不可见，无法确认删除状态');
    if (!stageInfo.isDirectory() || stageInfo.isSymbolicLink()) throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '删除暂存目录异常');
    const staged = path.join(stageDir, 'source');
    const file = lstatIfPresent(staged);
    if (!file || !file.isFile() || Number(file.size) !== op.source_size || file.dev.toString() !== current.stage_dev ||
        file.ino.toString() !== current.stage_ino || file.mtimeNs.toString() !== current.stage_mtime_ns) {
      throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '暂存文件不可见或已变化');
    }
    unlinkSync(staged);
    syncDirectory(stageDir);
    db.prepare("UPDATE media_operations SET stage_state='unlinked',updated_at=? WHERE operation_id=?").run(now(), op.operation_id);
    rmdirSync(stageDir);
  }).immediate();
}

/** 把文件的缓存与关联从索引中移除；调用方负责事务。 */
function removeMediaRow(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM favorites WHERE item_type='file' AND item_id=?").run(id);
  db.prepare('UPDATE albums SET cover_id=NULL WHERE cover_id=?').run(id);
  db.prepare(`INSERT OR REPLACE INTO cache_gc(cache_key,relative_path) SELECT cache_key,relative_path FROM cache_entries
    WHERE media_id=? AND (variant IS NULL OR variant<>'hls')`).run(id);
  db.prepare('DELETE FROM cache_entries WHERE media_id=? OR hls_session_id IN (SELECT id FROM hls_sessions WHERE media_id=?)').run(id, id);
  db.prepare('DELETE FROM files WHERE id=?').run(id);
}

function folderOf(libraryId: string, relativePath: string): string {
  const dir = path.posix.dirname(relativePath);
  return virtualPath(libraryId, dir === '.' ? '' : dir);
}

/** 文件已经从磁盘删除后，幂等完成索引清理；失败时保留 file_deleted 供同一 operationId 重试。 */
async function finishIndexCleanup(db: Database.Database, op: OperationRow): Promise<void> {
  const changed = db.transaction(() => {
    const current = db.prepare('SELECT state,stage_state,stage_dev,stage_ino,stage_mtime_ns FROM media_operations WHERE operation_id=?').get(op.operation_id) as
      { state: OperationRow['state']; stage_state: string | null; stage_dev: string | null; stage_ino: string | null; stage_mtime_ns: string | null } | undefined;
    if (current?.state === 'deleted') return false;
    if (!current || current.state !== 'file_deleted' || current.stage_state !== 'unlinked') throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '删除状态待恢复');
    const row = db.prepare('SELECT library_id,relative_path,size,modified_at,cache_generation,dev,ino,mtime_ms FROM files WHERE id=?').get(op.media_id) as
      { library_id: string; relative_path: string; size: number; modified_at: number; cache_generation: number; dev: string | null; ino: string | null; mtime_ms: number | null } | undefined;
    if (row && (row.library_id !== op.library_id || row.relative_path !== op.relative_path || row.size !== op.source_size ||
      row.modified_at !== op.source_modified || row.cache_generation !== op.source_generation)) {
      throw new MediaDeleteError(409, 'MEDIA_CHANGED', '媒体索引已发生变化，无法自动完成删除');
    }
    if (row && current.stage_dev && current.stage_ino && current.stage_mtime_ns) {
      const identity = statFields({ dev: BigInt(current.stage_dev), ino: BigInt(current.stage_ino), size: BigInt(op.source_size), mtimeNs: BigInt(current.stage_mtime_ns) });
      if ((row.dev !== null && row.dev !== identity.dev) || (row.ino !== null && row.ino !== identity.ino) ||
          (row.mtime_ms !== null && row.mtime_ms !== identity.mtimeMs)) {
        throw new MediaDeleteError(409, 'MEDIA_CHANGED', '媒体索引已发生变化，无法自动完成删除');
      }
    }
    if (row) removeMediaRow(db, op.media_id);
    db.prepare("UPDATE media_operations SET state='deleted',error_code=NULL,updated_at=? WHERE operation_id=?").run(now(), op.operation_id);
    return true;
  }).immediate();
  if (!changed) return;
  const folder = folderOf(op.library_id, op.relative_path);
  try { await materializeFolders(db, op.library_id, () => {}); } catch { /* 索引行已删除；下次扫描会重新对账目录统计。 */ }
  try {
    appendLibraryChange(db, op.library_id, {
      ts: new Date().toISOString(), kind: 'removed', path: op.relative_path, fromPath: null,
      isDir: false, mediaId: op.media_id, source: 'scan',
    });
    publishLibraryEvent(db, { libraryId: op.library_id, source: 'scan', folders: [folder], added: 0, removed: 1, updated: 0, moved: 0 });
  } catch { /* 事件写入失败不影响文件与索引已经完成的删除。 */ }
}

/**
 * 管理员确认后的磁盘删除。
 * - 只删除用户选择的单个普通文件；拒绝符号链接、目录与路径逃逸。
 * - 源版本、实际文件大小/修改时间与数据库必须同时匹配。
 * - 只读挂载返回 MEDIA_READ_ONLY；状态无法确认时保留索引并返回 OPERATION_PARTIAL。
 */
export async function deleteMediaFile(
  db: Database.Database,
  input: { mediaId: string; source: MediaDeleteSource; operationId: string },
): Promise<DeleteMediaResult> {
  if (activeOperations.has(input.operationId)) throw new MediaDeleteError(409, 'OPERATION_CONFLICT', '删除操作正在处理，请稍后刷新重试');
  activeOperations.add(input.operationId);
  try {
    // 已结束的操作只保留 30 天用于追溯；活动状态（pending/file_deleted）不清理。
    db.prepare("DELETE FROM media_operations WHERE state IN ('deleted','failed') AND updated_at<?").run(now() - 30 * 86_400);

    const existing = db.prepare('SELECT * FROM media_operations WHERE operation_id=?').get(input.operationId) as OperationRow | undefined;
    if (existing) {
      if (existing.media_id !== input.mediaId || existing.source_size !== input.source.size ||
          existing.source_modified !== input.source.modifiedAt || existing.source_generation !== input.source.generation) {
        throw new MediaDeleteError(409, 'OPERATION_CONFLICT', '操作编号已用于其他删除请求');
      }
      if (existing.state === 'deleted') return { operationId: input.operationId, status: 'deleted' };
      if (existing.state === 'pending' || existing.state === 'file_deleted') {
        const library = db.prepare('SELECT root,enabled FROM libraries WHERE id=?').get(existing.library_id) as { root: string; enabled: number } | undefined;
        if (!library?.enabled) throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '删除状态待恢复，媒体库暂不可访问');
        const root = await realpath(library.root).catch(() => null);
        if (!root) throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '删除状态待恢复，媒体库暂不可访问');
        const parent = await realpath(path.dirname(path.join(root, existing.relative_path))).catch(() => null);
        if (!parent || path.relative(root, parent).startsWith('..') || path.isAbsolute(path.relative(root, parent))) {
          throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '删除状态待恢复，文件所在目录不可访问');
        }
        const action = existing.state === 'pending' ? recoverPendingStage(db, existing, parent) : 'finish';
        if (action === 'finish') {
          try { finishStagedDelete(db, existing, parent); await finishIndexCleanup(db, existing); }
          catch { throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '删除状态无法确认，请核验媒体库和暂存状态'); }
          return { operationId: input.operationId, status: 'deleted' };
        }
      }
      // 只移除失败记录，避免覆盖其他实例新建的活动操作。
      if (existing.state === 'failed') db.prepare("DELETE FROM media_operations WHERE operation_id=? AND state='failed'").run(input.operationId);
    }

    const row = db.prepare(`SELECT f.id,f.library_id,f.relative_path,f.folder,f.name,f.size,f.modified_at,f.cache_generation,
      f.missing_at_ms,f.mtime_ms,f.dev,f.ino,f.head_hash,l.root,l.enabled FROM files f JOIN libraries l ON l.id=f.library_id WHERE f.id=?`).get(input.mediaId) as FileRow | undefined;
    if (!row) throw new MediaDeleteError(404, 'NOT_FOUND', '媒体不存在或已被删除');
    if (!row.enabled) throw new MediaDeleteError(409, 'MEDIA_READ_ONLY', '媒体库已停用，无法删除原文件');
    if (row.missing_at_ms !== null) throw new MediaDeleteError(404, 'NOT_FOUND', '文件已不在磁盘上');
    if (!sourceMatches(row, input.source)) throw new MediaDeleteError(409, 'MEDIA_CHANGED', '媒体已发生变化，请刷新后重试');

    const root = await realpath(row.root).catch(() => { throw new MediaDeleteError(404, 'NOT_FOUND', '媒体库目录不可用'); });
    const parent = await realpath(path.dirname(path.join(root, row.relative_path))).catch(() => { throw new MediaDeleteError(404, 'NOT_FOUND', '文件所在目录不可用'); });
    const fromRoot = path.relative(root, parent);
    if (fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
      throw new MediaDeleteError(403, 'FORBIDDEN', '媒体路径不在允许的目录中');
    }
    const target = path.join(parent, path.basename(row.relative_path));
    const rawInfo = await lstat(target, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new MediaDeleteError(404, 'NOT_FOUND', '文件已不在磁盘上');
      throw new MediaDeleteError(404, 'NOT_FOUND', '文件不可访问');
    });
    // realpath 会跟随符号链接；这里再确认目标本身不是链接，避免误删链接指向的文件。
    if (rawInfo.isSymbolicLink() || !rawInfo.isFile()) throw new MediaDeleteError(409, 'MEDIA_CHANGED', '目标不是普通文件，已拒绝删除');
    const info = statFields(rawInfo);
    if (row.mtime_ms === null || row.dev === null || row.ino === null) {
      throw new MediaDeleteError(409, 'MEDIA_CHANGED', '媒体索引缺少文件身份或精确修改时间，请先重新扫描');
    }
    if (info.size !== input.source.size || Math.floor(info.mtimeMs / 1000) !== input.source.modifiedAt ||
        (row.mtime_ms !== null && info.mtimeMs !== row.mtime_ms) ||
        (row.dev !== null && info.dev !== row.dev) || (row.ino !== null && info.ino !== row.ino)) {
      throw new MediaDeleteError(409, 'MEDIA_CHANGED', '文件已在磁盘上变化，请刷新后重试');
    }
    if (row.head_hash) {
      const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() => {
        throw new MediaDeleteError(409, 'MEDIA_CHANGED', '文件已在磁盘上变化，请刷新后重试');
      });
      try {
        const bytes = Buffer.alloc(65_536);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        const after = statFields(await handle.stat({ bigint: true }));
        const actualHash = createHash('sha256').update(bytes.subarray(0, bytesRead)).digest('hex');
        if (actualHash !== row.head_hash || after.dev !== info.dev || after.ino !== info.ino || after.size !== info.size || after.mtimeMs !== info.mtimeMs) {
          throw new MediaDeleteError(409, 'MEDIA_CHANGED', '文件已在磁盘上变化，请刷新后重试');
        }
      } finally { await handle.close(); }
    }
    try { await access(parent, constants.W_OK); }
    catch { throw new MediaDeleteError(409, 'MEDIA_READ_ONLY', '媒体库目录当前为只读挂载，无法删除原文件'); }

    try {
      db.prepare(`INSERT INTO media_operations(operation_id,media_id,library_id,relative_path,source_size,source_modified,source_generation,state,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'pending',?,?)`).run(input.operationId, row.id, row.library_id, row.relative_path,
        input.source.size, input.source.modifiedAt, input.source.generation, now(), now());
    } catch {
      const active = db.prepare("SELECT operation_id FROM media_operations WHERE media_id=? AND state IN ('pending','file_deleted')").get(row.id) as { operation_id: string } | undefined;
      if (active?.operation_id === input.operationId) {
        throw new MediaDeleteError(409, 'OPERATION_CONFLICT', '删除操作正在处理，请稍后刷新重试');
      }
      throw new MediaDeleteError(409, 'OPERATION_CONFLICT', '该媒体已有删除操作正在进行，请刷新后重试');
    }

    const stageDir = stageDirectory(parent, input.operationId);
    const staged = path.join(stageDir, 'source');
    try {
      const outcome = db.transaction(() => {
        const current = db.prepare('SELECT state FROM media_operations WHERE operation_id=?').get(input.operationId) as { state: OperationRow['state'] } | undefined;
        if (!current || current.state !== 'pending') throw new MediaDeleteError(409, 'OPERATION_CONFLICT', '删除操作状态已变化');
        let stageCreated = false;
        try {
          mkdirSync(stageDir, { mode: 0o700 });
          stageCreated = true;
          renameSync(target, staged);
        } catch (error) {
          if (stageCreated) { try { rmdirSync(stageDir); } catch { /* 保留待恢复的文件。 */ } }
          throw error;
        }
        const stagedInfo = lstatIfPresent(staged);
        if (!stagedInfo || !stagedInfo.isFile() || stagedInfo.dev !== rawInfo.dev || stagedInfo.ino !== rawInfo.ino ||
            stagedInfo.size !== rawInfo.size || stagedInfo.mtimeNs !== rawInfo.mtimeNs) {
          try { restoreStagedFile(staged, target); rmdirSync(stageDir); }
          catch { throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '文件已变化且原路径被占用，文件保留在暂存目录'); }
          db.prepare("UPDATE media_operations SET state='failed',error_code='MEDIA_CHANGED',updated_at=? WHERE operation_id=?").run(now(), input.operationId);
          return 'changed';
        }
        // 文件仍在暂存区时提交阶段，重试时先处理暂存文件，再清理索引。
        syncDirectory(stageDir);
        syncDirectory(parent);
        db.prepare("UPDATE media_operations SET state='file_deleted',stage_state='prepared',stage_dev=?,stage_ino=?,stage_mtime_ns=?,updated_at=? WHERE operation_id=?")
          .run(stagedInfo.dev.toString(), stagedInfo.ino.toString(), stagedInfo.mtimeNs.toString(), now(), input.operationId);
        return 'staged';
      }).immediate();
      if (outcome === 'changed') throw new MediaDeleteError(409, 'MEDIA_CHANGED', '文件已在磁盘上变化，请刷新后重试');
    } catch (error) {
      if (error instanceof MediaDeleteError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      const publicCode = code === 'EACCES' || code === 'EPERM' || code === 'EROFS' ? 'MEDIA_READ_ONLY' : 'OPERATION_FAILED';
      const message = publicCode === 'MEDIA_READ_ONLY' ? '媒体库目录当前为只读挂载，无法删除原文件' : '删除原文件失败，请稍后重试';
      if (lstatIfPresent(stageDir)) throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '删除状态待恢复，请重试同一操作');
      db.prepare("UPDATE media_operations SET state='failed',error_code=?,updated_at=? WHERE operation_id=? AND state='pending'").run(publicCode, now(), input.operationId);
      throw new MediaDeleteError(publicCode === 'MEDIA_READ_ONLY' ? 409 : 500, publicCode, message);
    }

    try {
      const fileDeleted = db.prepare('SELECT * FROM media_operations WHERE operation_id=?').get(input.operationId) as OperationRow;
      finishStagedDelete(db, fileDeleted, parent);
      await finishIndexCleanup(db, fileDeleted);
    } catch {
      throw new MediaDeleteError(500, 'OPERATION_PARTIAL', '删除状态无法确认，请核验媒体库和暂存状态');
    }
    return { operationId: input.operationId, status: 'deleted' };
  } finally { activeOperations.delete(input.operationId); }
}
