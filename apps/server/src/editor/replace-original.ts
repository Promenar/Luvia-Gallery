import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, chownSync, closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { lstat, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { MediaSourceVersion, ReplaceEditorOriginalResult } from '@luvia/contracts';
import { statFields } from '../watch/file-info.ts';
import { enqueueMediaTask } from '../core/media-cache.ts';
import { replaceEvictedThumbnailCovers } from '../core/folder-covers.ts';
import { appendLibraryChange } from '../core/library-changes.ts';
import { virtualPath } from '../core/paths.ts';
import { publishLibraryEvent } from '../worker/watch-events.ts';

export class ReplaceOriginalError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string, message: string) { super(message); this.statusCode = statusCode; this.code = code; }
}

type Operation = {
  operation_id: string; user_id: string; job_id: string; media_id: string; library_id: string; relative_path: string;
  source_size: number; source_modified: number; source_generation: number;
  source_dev: string; source_ino: string; source_mtime_ns: string;
  parent_dev: string; parent_ino: string; stage_dev: string; stage_ino: string; result_dev: string; result_ino: string;
  stage_name: string | null; source_sha256: string | null; result_size: number | null; result_modified: number | null;
  root_real: string | null; root_dev: string | null; root_ino: string | null;
  result_generation: number | null; result_thumb_version: number | null;
  status: 'pending' | 'saved' | 'attention';
};
type FileRow = {
  id: string; library_id: string; relative_path: string; root: string; enabled: number; missing_at_ms: number | null;
  size: number; modified_at: number; cache_generation: number; mtime_ms: number | null; dev: string | null; ino: string | null;
};
type Job = { id: string; user_id: string; media_id: string; source_size: number; source_modified: number; source_generation: number;
  source_sha256: string | null; status: string; result_path: string | null; expires_at: number | null };
const seconds = () => Math.floor(Date.now() / 1000);
const guardId = (id: string) => `replace:${id}`;
const stageName = (id: string) => `.luvia-replace-${createHash('sha256').update(id).digest('hex')}`;
const stageFor = (op: Operation) => op.stage_name ?? stageName(op.operation_id);
const matches = (info: ReturnType<typeof lstatSync> | null, dev: string, ino: string) => !!info && info.isFile() && !info.isSymbolicLink() && String(info.dev) === dev && String(info.ino) === ino;
const needsAttention = (error: unknown) =>
  (error instanceof ReplaceOriginalError && ['OPERATION_PARTIAL', 'OPERATION_UNAVAILABLE'].includes(error.code)) ||
  ['ENOENT', 'ENOTDIR', 'ELOOP', 'EACCES', 'EPERM', 'ESTALE', 'EIO', 'EROFS'].includes((error as NodeJS.ErrnoException)?.code ?? '');
function readStat(filename: string) {
  try { return lstatSync(filename, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function syncDir(directory: string) {
  if (process.platform !== 'linux') return;
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
/** 固定并复核从媒体库根到目标父目录的整个路径。 */
function pinParent(root: string, relative: string) {
  const parts = relative.split('/');
  if (!relative || relative.startsWith('/') || relative.includes('\\') || parts.some((part) => !part || part === '.' || part === '..')) {
    throw new ReplaceOriginalError(403, 'FORBIDDEN', '媒体路径无效');
  }
  parts.pop();
  const rootPath = realpathSync(root);
  let fd = openSync(rootPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  const parents: Array<{ path: string; dev: bigint; ino: bigint }> = [];
  let visible = rootPath;
  try {
    const first = fstatSync(fd, { bigint: true });
    parents.push({ path: visible, dev: first.dev, ino: first.ino });
    for (const part of parts) {
      const next = openSync(path.join(process.platform === 'linux' ? `/proc/self/fd/${fd}` : visible, part), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      closeSync(fd); fd = next; visible = path.join(visible, part);
      const info = fstatSync(fd, { bigint: true });
      parents.push({ path: visible, dev: info.dev, ino: info.ino });
    }
    const directory = process.platform === 'linux' ? `/proc/self/fd/${fd}` : visible;
    const verify = () => {
      if (realpathSync(root) !== rootPath) throw new ReplaceOriginalError(409, 'OPERATION_PARTIAL', '媒体库根目录已变化');
      for (const item of parents) {
        const current = lstatSync(item.path, { bigint: true });
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== item.dev || current.ino !== item.ino) {
          throw new ReplaceOriginalError(409, 'OPERATION_PARTIAL', '媒体目录已变化');
        }
      }
    };
    verify();
    return { directory, rootPath, rootDev: String(first.dev), rootIno: String(first.ino), verify, stat: () => fstatSync(fd, { bigint: true }), close: () => closeSync(fd) };
  } catch (error) { closeSync(fd); throw error; }
}
function pinStage(parent: string, name: string, dev: string, ino: string) {
  if (!name.startsWith('.luvia-replace-') || path.basename(name) !== name) throw new ReplaceOriginalError(409, 'OPERATION_PARTIAL', '暂存目录名称无效');
  const visible = path.join(parent, name);
  const fd = openSync(visible, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const verify = () => {
      const current = lstatSync(visible, { bigint: true }); const held = fstatSync(fd, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || String(current.dev) !== dev || String(current.ino) !== ino ||
          String(held.dev) !== dev || String(held.ino) !== ino) throw new ReplaceOriginalError(409, 'OPERATION_PARTIAL', '暂存目录身份已变化');
    };
    verify();
    return { directory: process.platform === 'linux' ? `/proc/self/fd/${fd}` : visible, verify, close: () => closeSync(fd) };
  } catch (error) { closeSync(fd); throw error; }
}
function sourceResult(db: Database.Database, op: Operation): ReplaceEditorOriginalResult {
  if (op.result_size !== null && op.result_modified !== null && op.result_generation !== null && op.result_thumb_version !== null) {
    return { status: 'saved', mediaId: op.media_id, source: { size: op.result_size, modifiedAt: op.result_modified, generation: op.result_generation }, thumbVersion: op.result_thumb_version };
  }
  const row = db.prepare('SELECT id,size,modified_at,cache_generation,thumb_version FROM files WHERE id=?').get(op.media_id) as
    { id: string; size: number; modified_at: number; cache_generation: number; thumb_version: number } | undefined;
  if (!row) throw new ReplaceOriginalError(404, 'NOT_FOUND', '媒体不存在');
  return { status: 'saved', mediaId: row.id, source: { size: row.size, modifiedAt: row.modified_at, generation: row.cache_generation }, thumbVersion: row.thumb_version };
}

/** 暂存目录只清理身份已确认的文件；其他内容保留供人工检查。 */
function cleanup(op: Operation, parent: string): boolean {
  const stage = path.join(parent, stageFor(op));
  const dir = readStat(stage);
  if (!dir) return true;
  if (!dir.isDirectory() || dir.isSymbolicLink() || String(dir.dev) !== op.stage_dev || String(dir.ino) !== op.stage_ino) return false;
  const pinned = pinStage(parent, stageFor(op), op.stage_dev, op.stage_ino);
  try {
  const original = path.join(pinned.directory, 'original');
  const result = path.join(pinned.directory, 'result');
  const old = readStat(original); const replacement = readStat(result);
  pinned.verify();
  if (old && matches(old, op.source_dev, op.source_ino) && String(old.mtimeNs) === op.source_mtime_ns &&
      (!op.source_sha256 || createHash('sha256').update(readFileSync(original)).digest('hex') === op.source_sha256)) unlinkSync(original);
  pinned.verify();
  if (replacement && matches(replacement, op.result_dev, op.result_ino)) unlinkSync(result);
  pinned.verify();
  try { rmdirSync(stage); syncDir(parent); return true; } catch { return false; }
  } finally { pinned.close(); }
}

/** 由同一数据库写事务串行发布并恢复已持久化的操作。 */
function publish(db: Database.Database, operationId: string): ReplaceEditorOriginalResult {
  if (process.platform !== 'linux') throw new ReplaceOriginalError(409, 'OPERATION_UNAVAILABLE', '当前服务平台不支持安全覆盖原图，请保存副本');
  let parent = '';
  const pinned: { value: ReturnType<typeof pinParent> | null } = { value: null };
  const pinnedStage: { value: ReturnType<typeof pinStage> | null } = { value: null };
  try {
  const outcome = db.transaction(() => {
    const op = db.prepare('SELECT * FROM editor_overwrites WHERE operation_id=?').get(operationId) as Operation | undefined;
    if (!op) throw new ReplaceOriginalError(404, 'NOT_FOUND', '覆盖操作不存在');
    if (op.status === 'saved') return { op, done: true as const };
    if (op.status === 'attention') {
      if (db.prepare('SELECT 1 FROM scan_locks WHERE library_id=? AND lease_expires_at>unixepoch()').get(op.library_id)) {
        throw new ReplaceOriginalError(409, 'OPERATION_CONFLICT', '媒体库正在扫描，请稍后重试');
      }
      db.prepare('DELETE FROM scan_locks WHERE library_id=? AND lease_expires_at<=unixepoch()').run(op.library_id);
      db.prepare("UPDATE editor_overwrites SET status='pending' WHERE operation_id=? AND status='attention'").run(operationId);
    }
    const library = db.prepare('SELECT root,enabled FROM libraries WHERE id=?').get(op.library_id) as { root: string; enabled: number } | undefined;
    if (!library?.enabled) throw new ReplaceOriginalError(409, 'OPERATION_PARTIAL', '媒体库暂不可访问，覆盖操作等待恢复');
    pinned.value = pinParent(library.root, op.relative_path);
    if (!op.root_real || pinned.value.rootPath !== op.root_real || pinned.value.rootDev !== op.root_dev || pinned.value.rootIno !== op.root_ino) {
      throw new ReplaceOriginalError(409, 'OPERATION_PARTIAL', '媒体库根目录身份已变化，覆盖操作等待恢复');
    }
    parent = pinned.value.directory;
    const parentInfo = pinned.value.stat();
    if (!parentInfo.isDirectory() || String(parentInfo.dev) !== op.parent_dev || String(parentInfo.ino) !== op.parent_ino) {
      throw new ReplaceOriginalError(409, 'OPERATION_PARTIAL', '媒体目录已变化，覆盖操作等待恢复');
    }
    const stage = path.join(parent, stageFor(op));
    const dir = readStat(stage);
    if (!dir || !dir.isDirectory() || dir.isSymbolicLink() || String(dir.dev) !== op.stage_dev || String(dir.ino) !== op.stage_ino) {
      throw new ReplaceOriginalError(409, 'OPERATION_PARTIAL', '暂存目录不可访问，覆盖操作等待恢复');
    }
    pinnedStage.value = pinStage(parent, stageFor(op), op.stage_dev, op.stage_ino);
    const row = db.prepare('SELECT size,modified_at,cache_generation FROM files WHERE id=? AND library_id=? AND relative_path=? AND missing_at_ms IS NULL')
      .get(op.media_id, op.library_id, op.relative_path) as { size: number; modified_at: number; cache_generation: number } | undefined;
    if (!row || row.size !== op.source_size || row.modified_at !== op.source_modified || row.cache_generation !== op.source_generation) {
      db.prepare("UPDATE editor_overwrites SET status='attention' WHERE operation_id=?").run(operationId);
      return { op, done: false as const };
    }
    const target = path.join(parent, path.basename(op.relative_path));
    const original = path.join(pinnedStage.value.directory, 'original'); const result = path.join(pinnedStage.value.directory, 'result');
    const replacement = readStat(result);
    if (!matches(replacement, op.result_dev, op.result_ino)) throw new ReplaceOriginalError(409, 'OPERATION_PARTIAL', '修复结果暂存文件已变化');
    let current = readStat(target); let old = readStat(original);
    const originalMatches = (value: typeof current) => matches(value, op.source_dev, op.source_ino) && String(value!.mtimeNs) === op.source_mtime_ns && Number(value!.size) === op.source_size;
    if (!old && originalMatches(current)) {
      pinned.value.verify();
      pinnedStage.value.verify();
      renameSync(target, original);
      old = readStat(original); current = readStat(target);
      syncDir(pinnedStage.value.directory); syncDir(parent);
    }
    if (!originalMatches(old)) {
      if (!current && old) { try { pinned.value.verify(); pinnedStage.value.verify(); linkSync(original, target); } catch { /* 原路径已被占用，保留暂存文件。 */ } }
      db.prepare("UPDATE editor_overwrites SET status='attention' WHERE operation_id=?").run(operationId);
      return { op, done: false as const };
    }
    if (op.source_sha256 && (createHash('sha256').update(readFileSync(original)).digest('hex') !== op.source_sha256 || !originalMatches(readStat(original)))) {
      if (!current) { try { pinned.value.verify(); pinnedStage.value.verify(); linkSync(original, target); } catch { /* 原路径已被占用，保留暂存文件。 */ } }
      db.prepare("UPDATE editor_overwrites SET status='attention' WHERE operation_id=?").run(operationId);
      return { op, done: false as const };
    }
    if (!current) {
      pinned.value.verify();
      pinnedStage.value.verify();
      try { linkSync(result, target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      current = readStat(target); syncDir(parent);
    }
    if (!matches(current, op.result_dev, op.result_ino)) {
      db.prepare("UPDATE editor_overwrites SET status='attention' WHERE operation_id=?").run(operationId);
      return { op, done: false as const };
    }
    const info = statFields(current!);
    pinned.value.verify();
    pinnedStage.value.verify();
    const modified = Math.floor(info.mtimeMs / 1000);
    db.prepare(`INSERT OR REPLACE INTO cache_gc(cache_key,relative_path) SELECT cache_key,relative_path FROM cache_entries WHERE media_id=? AND (variant IS NULL OR variant<>'hls')`).run(op.media_id);
    db.prepare('DELETE FROM cache_entries WHERE media_id=?').run(op.media_id);
    db.prepare(`UPDATE files SET size=?,modified_at=?,mtime_ms=?,dev=?,ino=?,head_hash=NULL,cache_generation=cache_generation+1,
      thumb_version=MAX(1,thumb_version+1),thumb_ready=0,thumbhash=NULL,metadata_status='pending',orientation=1,has_preview=0 WHERE id=?`)
      .run(info.size, modified, info.mtimeMs, info.dev, info.ino, op.media_id);
    replaceEvictedThumbnailCovers(db, op.media_id);
    const thumbVersion = (db.prepare('SELECT thumb_version FROM files WHERE id=?').get(op.media_id) as { thumb_version: number }).thumb_version;
    db.prepare("UPDATE editor_overwrites SET status='saved',result_size=?,result_modified=?,result_generation=?,result_thumb_version=? WHERE operation_id=?")
      .run(info.size, modified, op.source_generation + 1, thumbVersion, operationId);
    db.prepare("UPDATE media_operations SET state='deleted',updated_at=unixepoch() WHERE operation_id=?").run(guardId(operationId));
    enqueueMediaTask(db, { id: op.media_id, size: info.size, modified_at: modified, cache_generation: op.source_generation + 1 }, { kind: 'thumb', size: 'm' }, { interactive: true });
    const directory = path.posix.dirname(op.relative_path);
    const folder = virtualPath(op.library_id, directory === '.' ? '' : directory);
    appendLibraryChange(db, op.library_id, { ts: new Date().toISOString(), kind: 'updated', path: op.relative_path, fromPath: null, isDir: false, mediaId: op.media_id, source: 'scan' });
    publishLibraryEvent(db, { libraryId: op.library_id, source: 'scan', folders: [folder], added: 0, removed: 0, updated: 1, moved: 0 });
    return { op: { ...op, status: 'saved' as const, result_size: info.size, result_modified: modified, result_generation: op.source_generation + 1, result_thumb_version: thumbVersion }, done: true as const };
  }).immediate();
  if (!outcome.done) throw new ReplaceOriginalError(409, 'OPERATION_PARTIAL', `原路径已变化，原文件和修复结果保留在同目录的 ${stageFor(outcome.op)} 中`);
  pinnedStage.value?.close(); pinnedStage.value = null;
  if (parent) { try { pinned.value?.verify(); if (cleanup(outcome.op, parent)) db.prepare('UPDATE editor_overwrites SET cleanup_pending=0 WHERE operation_id=?').run(operationId); } catch { /* 清理可在恢复时再次执行。 */ } }
  return sourceResult(db, outcome.op);
  } finally { pinnedStage.value?.close(); pinned.value?.close(); }
}

/** 即使修复作业已经过期，也按原始请求返回已提交的覆盖回执。 */
export function savedReplacement(db: Database.Database, jobId: string, userId: string, body: { source: MediaSourceVersion; operationId: string }): ReplaceEditorOriginalResult | null {
  const op = db.prepare('SELECT * FROM editor_overwrites WHERE operation_id=?').get(body.operationId) as Operation | undefined;
  if (!op) return null;
  if (op.user_id !== userId || op.job_id !== jobId || op.source_size !== body.source.size || op.source_modified !== body.source.modifiedAt || op.source_generation !== body.source.generation) {
    throw new ReplaceOriginalError(409, 'OPERATION_CONFLICT', '操作编号已用于其他请求');
  }
  return op.status === 'saved' ? sourceResult(db, op) : null;
}

export async function replaceOriginal(db: Database.Database, job: Job, userId: string, body: { source: MediaSourceVersion; operationId: string }, assertAuthorized: () => void): Promise<ReplaceEditorOriginalResult> {
  if (process.platform !== 'linux') throw new ReplaceOriginalError(409, 'OPERATION_UNAVAILABLE', '当前服务平台不支持安全覆盖原图，请保存副本');
  const existing = db.prepare('SELECT * FROM editor_overwrites WHERE operation_id=?').get(body.operationId) as Operation | undefined;
  if (existing) {
    if (existing.user_id !== userId || existing.job_id !== job.id || existing.source_size !== body.source.size || existing.source_modified !== body.source.modifiedAt || existing.source_generation !== body.source.generation) {
      throw new ReplaceOriginalError(409, 'OPERATION_CONFLICT', '操作编号已用于其他请求');
    }
    return publish(db, body.operationId);
  }
  if (job.status !== 'succeeded' || !job.result_path || !job.source_sha256 || (job.expires_at !== null && job.expires_at < seconds())) {
    throw new ReplaceOriginalError(409, 'OPERATION_FAILED', '修复结果已过期或缺少源文件校验，请重新生成');
  }
  const file = db.prepare(`SELECT f.id,f.library_id,f.relative_path,f.size,f.modified_at,f.cache_generation,f.mtime_ms,f.dev,f.ino,f.missing_at_ms,l.root,l.enabled
    FROM files f JOIN libraries l ON l.id=f.library_id WHERE f.id=?`).get(job.media_id) as FileRow | undefined;
  if (!file || !file.enabled || file.missing_at_ms !== null) throw new ReplaceOriginalError(404, 'NOT_FOUND', '原图不可访问');
  if (file.size !== body.source.size || file.modified_at !== body.source.modifiedAt || file.cache_generation !== body.source.generation ||
      file.size !== job.source_size || file.modified_at !== job.source_modified || file.cache_generation !== job.source_generation ||
      file.mtime_ms === null || !file.dev || !file.ino) throw new ReplaceOriginalError(409, 'MEDIA_CHANGED', '原图已变化，请重新生成');
  const pinned = pinParent(file.root, file.relative_path);
  let stagedPin: ReturnType<typeof pinStage> | null = null;
  try {
  const parent = pinned.directory;
  const target = path.join(parent, path.basename(file.relative_path));
  const before = await lstat(target, { bigint: true });
  const fields = statFields(before);
  if (!before.isFile() || before.isSymbolicLink() || fields.dev !== file.dev || fields.ino !== file.ino || fields.size !== file.size || fields.mtimeMs !== file.mtime_ms) {
    throw new ReplaceOriginalError(409, 'MEDIA_CHANGED', '原图已在磁盘上变化，请重新生成');
  }
  const bytes = await readFile(target);
  const after = await lstat(target, { bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.size !== after.size ||
      createHash('sha256').update(bytes).digest('hex') !== job.source_sha256) throw new ReplaceOriginalError(409, 'MEDIA_CHANGED', '原图内容已变化，请重新生成');
  const meta = await sharp(bytes).metadata();
  const ext = path.extname(file.relative_path).toLowerCase();
  const format = ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : null;
  if (!format || meta.format !== format || (meta.pages ?? 1) > 1) throw new ReplaceOriginalError(409, 'OPERATION_FAILED', '覆盖仅支持单帧 JPEG、PNG 和 WebP，请保存副本');
  const result = await readFile(job.result_path);
  const resultMeta = await sharp(result).metadata();
  let normalized = result;
  if (meta.space === 'cmyk') {
    normalized = await sharp(result).withIccProfile('srgb').png().toBuffer();
  } else if (meta.icc && !meta.icc.equals(resultMeta.icc ?? Buffer.alloc(0))) {
    const profile = path.join(path.dirname(job.result_path), `profile-${randomUUID()}.icc`);
    await writeFile(profile, meta.icc, { flag: 'wx', mode: 0o600 });
    try { normalized = await sharp(result).withIccProfile(profile).png().toBuffer(); }
    finally { await unlink(profile).catch(() => {}); }
  } else if (!meta.icc && resultMeta.icc) {
    normalized = await sharp(result).withIccProfile('srgb').png().toBuffer();
  }
  let pipeline = sharp(bytes).rotate();
  if (meta.space === 'cmyk') pipeline = pipeline.toColourspace('srgb');
  pipeline = pipeline.composite([{ input: normalized, blend: 'source' }]).keepMetadata().withExifMerge({ IFD0: { Orientation: '1' } });
  if (meta.space === 'cmyk') pipeline = pipeline.withIccProfile('srgb');
  const output = await (format === 'jpeg' ? pipeline.jpeg({ quality: 95 }) : format === 'webp' ? pipeline.webp({ quality: 95 }) : pipeline.png()).toBuffer();
  pinned.verify();
  const parentInfo = pinned.stat();
  const stagingName = `${stageName(body.operationId)}-${randomUUID()}`;
  const stage = path.join(parent, stagingName);
  let reserved = false;
  let stageCreated = false;
  let preparationRecorded = false;
  try {
    pinned.verify();
    db.prepare('INSERT INTO editor_overwrite_preparations(stage_name,library_id,relative_path,parent_dev,parent_ino,root_real,root_dev,root_ino,created_at) VALUES (?,?,?,?,?,?,?,?,unixepoch())')
      .run(stagingName, file.library_id, file.relative_path, String(parentInfo.dev), String(parentInfo.ino), pinned.rootPath, pinned.rootDev, pinned.rootIno);
    preparationRecorded = true;
    mkdirSync(stage, { mode: 0o700 });
    stageCreated = true;
    const stageInfo = lstatSync(stage, { bigint: true });
    stagedPin = pinStage(parent, stagingName, String(stageInfo.dev), String(stageInfo.ino));
    db.prepare('UPDATE editor_overwrite_preparations SET stage_dev=?,stage_ino=? WHERE stage_name=?').run(String(stageInfo.dev), String(stageInfo.ino), stagingName);
    const staged = path.join(stagedPin.directory, 'result');
    stagedPin.verify();
    writeFileSync(staged, output, { flag: 'wx', mode: Number(before.mode & 0o777n) });
    if (typeof process.getuid === 'function' && (Number(before.uid) !== process.getuid() || Number(before.gid) !== process.getgid?.())) chownSync(staged, Number(before.uid), Number(before.gid));
    chmodSync(staged, Number(before.mode & 0o777n));
    const fd = openSync(staged, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); }
    syncDir(stagedPin.directory); syncDir(parent);
    const stageResult = lstatSync(staged, { bigint: true });
    db.prepare('UPDATE editor_overwrite_preparations SET result_dev=?,result_ino=? WHERE stage_name=?').run(String(stageResult.dev), String(stageResult.ino), stagingName);
    db.transaction(() => {
      assertAuthorized();
      if (db.prepare('SELECT 1 FROM scan_locks WHERE library_id=? AND lease_expires_at>unixepoch()').get(file.library_id)) throw new ReplaceOriginalError(409, 'OPERATION_CONFLICT', '媒体库正在扫描，请稍后重试');
      db.prepare('DELETE FROM scan_locks WHERE library_id=? AND lease_expires_at<=unixepoch()').run(file.library_id);
      const current = db.prepare('SELECT size,modified_at,cache_generation FROM files WHERE id=?').get(file.id) as FileRow | undefined;
      if (!current || current.size !== file.size || current.modified_at !== file.modified_at || current.cache_generation !== file.cache_generation) throw new ReplaceOriginalError(409, 'MEDIA_CHANGED', '原图已变化，请重新生成');
      db.prepare(`INSERT INTO media_operations(operation_id,media_id,library_id,relative_path,source_size,source_modified,source_generation,state,created_at,updated_at,kind)
        VALUES (?,?,?,?,?,?,?,'pending',unixepoch(),unixepoch(),'overwrite')`).run(guardId(body.operationId), file.id, file.library_id, file.relative_path, file.size, file.modified_at, file.cache_generation);
      db.prepare(`INSERT INTO editor_overwrites(operation_id,user_id,job_id,media_id,library_id,relative_path,source_size,source_modified,source_generation,
        source_dev,source_ino,source_mtime_ns,parent_dev,parent_ino,stage_dev,stage_ino,result_dev,result_ino,stage_name,source_sha256,root_real,root_dev,root_ino,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',unixepoch())`).run(body.operationId, userId, job.id, file.id, file.library_id, file.relative_path,
        file.size, file.modified_at, file.cache_generation, String(before.dev), String(before.ino), String(before.mtimeNs), String(parentInfo.dev), String(parentInfo.ino),
        String(stageInfo.dev), String(stageInfo.ino), String(stageResult.dev), String(stageResult.ino), stagingName, job.source_sha256, pinned.rootPath, pinned.rootDev, pinned.rootIno);
      db.prepare('DELETE FROM editor_overwrite_preparations WHERE stage_name=?').run(stagingName);
    }).immediate();
    reserved = true;
    return publish(db, body.operationId);
  } catch (error) {
    if (reserved && needsAttention(error)) db.prepare("UPDATE editor_overwrites SET status='attention' WHERE operation_id=? AND status='pending'").run(body.operationId);
    if (!reserved && preparationRecorded) {
      try {
        if (stageCreated) {
          if (!stagedPin) throw new Error('暂存目录身份待核验');
          stagedPin.verify(); try { unlinkSync(path.join(stagedPin.directory, 'result')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } rmdirSync(stage);
        }
        db.prepare('DELETE FROM editor_overwrite_preparations WHERE stage_name=?').run(stagingName);
      } catch { /* 留给维护任务清理。 */ }
    }
    if (error instanceof ReplaceOriginalError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (reserved) throw new ReplaceOriginalError(500, 'OPERATION_PARTIAL', '覆盖操作等待恢复，请使用相同操作编号重试');
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') throw new ReplaceOriginalError(409, 'MEDIA_READ_ONLY', '媒体目录不可写或无法保留原有权限');
    if (code?.startsWith('SQLITE_CONSTRAINT')) throw new ReplaceOriginalError(409, 'OPERATION_CONFLICT', '该媒体已有其他操作正在进行');
    throw error;
  }
  } finally { stagedPin?.close(); pinned.close(); }
}

/** 服务启动或定期维护时恢复中断的发布，并清理已完成操作的暂存。 */
export function recoverOriginalReplacements(db: Database.Database): void {
  const pending = db.prepare("SELECT operation_id FROM editor_overwrites WHERE status IN ('pending','attention') ORDER BY last_attempt_at,created_at,operation_id LIMIT 20").all() as { operation_id: string }[];
  for (const op of pending) {
    db.prepare('UPDATE editor_overwrites SET last_attempt_at=? WHERE operation_id=?').run(Date.now(), op.operation_id);
    try { publish(db, op.operation_id); }
    catch (error) {
      if (needsAttention(error)) {
        db.prepare("UPDATE editor_overwrites SET status='attention' WHERE operation_id=? AND status='pending'").run(op.operation_id);
      }
    }
  }
  if (process.platform !== 'linux') return;
  const saved = db.prepare("SELECT o.*,l.root FROM editor_overwrites o JOIN libraries l ON l.id=o.library_id WHERE o.status='saved' AND o.cleanup_pending=1 ORDER BY o.last_attempt_at,o.created_at,o.operation_id LIMIT 20").all() as Array<Operation & { root: string }>;
  for (const op of saved) {
    db.prepare('UPDATE editor_overwrites SET last_attempt_at=? WHERE operation_id=?').run(Date.now(), op.operation_id);
    try {
      const pinned = pinParent(op.root, op.relative_path);
      try {
        const parent = pinned.stat();
        if (pinned.rootPath === op.root_real && pinned.rootDev === op.root_dev && pinned.rootIno === op.root_ino &&
            String(parent.dev) === op.parent_dev && String(parent.ino) === op.parent_ino && cleanup(op, pinned.directory)) db.prepare('UPDATE editor_overwrites SET cleanup_pending=0 WHERE operation_id=?').run(op.operation_id);
      } finally { pinned.close(); }
    } catch { /* 不影响已经完成的替换。 */ }
  }
  const preparations = db.prepare(`SELECT p.*,l.root FROM editor_overwrite_preparations p JOIN libraries l ON l.id=p.library_id
    WHERE p.created_at<unixepoch()-3600 ORDER BY p.last_attempt_at,p.created_at,p.stage_name LIMIT 20`).all() as Array<{
      stage_name: string; library_id: string; relative_path: string; parent_dev: string; parent_ino: string; root: string;
      root_real: string | null; root_dev: string | null; root_ino: string | null; stage_dev: string | null; stage_ino: string | null; result_dev: string | null; result_ino: string | null;
    }>;
  for (const entry of preparations) {
    db.prepare('UPDATE editor_overwrite_preparations SET last_attempt_at=? WHERE stage_name=?').run(Date.now(), entry.stage_name);
    try {
      if (!/^\.luvia-replace-[0-9a-f]{64}-[0-9a-f-]{36}$/.test(entry.stage_name)) continue;
      const pinned = pinParent(entry.root, entry.relative_path);
      try {
        const parent = pinned.stat();
        if (!entry.root_real || pinned.rootPath !== entry.root_real || pinned.rootDev !== entry.root_dev || pinned.rootIno !== entry.root_ino ||
            String(parent.dev) !== entry.parent_dev || String(parent.ino) !== entry.parent_ino) continue;
        const stage = path.join(pinned.directory, entry.stage_name);
        const dir = readStat(stage);
        if (dir) {
          if (!entry.stage_dev || !entry.stage_ino || !dir.isDirectory() || dir.isSymbolicLink() || String(dir.dev) !== entry.stage_dev || String(dir.ino) !== entry.stage_ino) continue;
          const stagePin = pinStage(pinned.directory, entry.stage_name, String(dir.dev), String(dir.ino));
          try {
          const names = readdirSync(stagePin.directory);
          if (names.some((name) => name !== 'result')) continue;
          const result = readStat(path.join(stagePin.directory, 'result'));
          if (result && (!entry.result_dev || !entry.result_ino || !matches(result, entry.result_dev, entry.result_ino) || result.nlink !== 1n)) continue;
          pinned.verify(); stagePin.verify();
          if (result) unlinkSync(path.join(stagePin.directory, 'result'));
          stagePin.verify();
          rmdirSync(stage); syncDir(pinned.directory);
          } finally { stagePin.close(); }
        }
        db.prepare('DELETE FROM editor_overwrite_preparations WHERE stage_name=?').run(entry.stage_name);
      } finally { pinned.close(); }
    } catch { /* 留下身份不确定的目录。 */ }
  }
}
