import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { constants, createWriteStream, linkSync, lstatSync, realpathSync } from 'node:fs';
import { lstat, mkdir, open, realpath, rm, rmdir, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import sharp from 'sharp';
import { mediaId, virtualPath } from '../core/paths.ts';
import { statFields } from '../watch/file-info.ts';
import { materializeFolders } from '../worker/scan.ts';
import { appendLibraryChange } from '../core/library-changes.ts';
import { publishLibraryEvent } from '../worker/watch-events.ts';
import { EditorError } from './queue.ts';

const active = new Set<string>();
type ImportBody = { libraryId: string; folder: string; name: string; operationId: string };
type ImportRow = { user_id: string; job_id: string; library_id: string; folder: string; requested_name: string;
  final_name: string | null; stage_ready: number; stage_dev: string | null; stage_ino: string | null; stage_name: string | null; parent_dev: string | null; parent_ino: string | null; owner: string | null; lease_until: number | null; status: string; media_id: string | null };
const timestamp = () => Math.floor(Date.now() / 1000);

/** 在 Linux 上逐层固定目录句柄，避免符号链接和并发替换把写入导向媒体库外。 */
async function openTarget(root: string, folder: string, create = true) {
  const rootPath = await realpath(root);
  let handle = await open(rootPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  let plain = rootPath;
  const rootInfo = await handle.stat({ bigint: true });
  const parents = [{ path: rootPath, dev: rootInfo.dev, ino: rootInfo.ino }];
  try {
    for (const part of folder ? folder.split('/') : []) {
      const parent = process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : plain;
      const child = path.join(parent, part);
      if (create) { try { await mkdir(child); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; } }
      const next = await open(child, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      if (process.platform !== 'linux') {
        const actual = await realpath(child);
        const expected = path.join(plain, part);
        if (actual !== expected) { await next.close(); throw new Error('目录包含符号链接'); }
        plain = actual;
      }
      const identity = await next.stat({ bigint: true });
      const currentPath = path.join(parents.at(-1)!.path, part);
      parents.push({ path: currentPath, dev: identity.dev, ino: identity.ino });
      await handle.close();
      handle = next;
    }
    return { handle, directory: process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : plain, parents };
  } catch (error) { await handle.close(); throw error; }
}

export async function importExternalResult(db: Database.Database, userId: string, job: {
  id: string; media_id: string; status: string; result_path: string | null; expires_at: number | null;
}, body: ImportBody) {
  const recoverable = db.prepare("SELECT 1 FROM editor_imports WHERE operation_id=? AND user_id=? AND job_id=? AND status IN ('pending','attention')")
    .get(body.operationId, userId, job.id);
  if (!job.media_id.startsWith('upload:') || job.status !== 'succeeded' || !job.result_path || ((job.expires_at ?? 0) <= timestamp() && !recoverable)) {
    throw new EditorError(409, 'OPERATION_FAILED', '修复结果不存在或已过期');
  }
  if (active.has(body.operationId)) throw new EditorError(409, 'OPERATION_CONFLICT', '导入正在进行，请稍后重试');
  if (active.size >= 2) throw new EditorError(503, 'OPERATION_CONFLICT', '导入任务较多，请稍后重试');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(body.operationId)) throw new EditorError(400, 'VALIDATION', '操作编号无效');
  if (body.folder.startsWith('/') || body.folder.includes('\\') || body.folder.includes('\0') ||
      (body.folder && body.folder.split('/').some(p => !p || p === '.' || p === '..'))) throw new EditorError(400, 'VALIDATION', '文件夹路径无效');
  if (!body.name || body.name === '.' || body.name === '..' || /[\\/\0]/.test(body.name)) throw new EditorError(400, 'VALIDATION', '文件名无效');
  const extension = path.extname(body.name).toLowerCase() || '.png';
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new EditorError(400, 'VALIDATION', '只支持 PNG、JPEG 或 WebP');
  const stem = body.name.slice(0, body.name.length - path.extname(body.name).length).trim() || '修复图片';
  const library = db.prepare('SELECT root,enabled FROM libraries WHERE id=?').get(body.libraryId) as { root: string; enabled: number } | undefined;
  if (!library?.enabled) throw new EditorError(404, 'NOT_FOUND', '媒体库不存在或未启用');
  active.add(body.operationId);
  const owner = randomUUID();
  let heartbeat: NodeJS.Timeout | undefined;
  let target: Awaited<ReturnType<typeof openTarget>> | undefined;
  let stageHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const key = createHash('sha256').update(body.operationId).digest('hex');
    let op = db.transaction(() => {
      const sourceJob = db.prepare("SELECT status,result_state FROM editor_jobs WHERE id=? AND user_id=?").get(job.id, userId) as
        { status: string; result_state: string } | undefined;
      if (!sourceJob || sourceJob.status !== 'succeeded' || sourceJob.result_state !== 'ready') {
        throw new EditorError(404, 'NOT_FOUND', '修复结果不存在或已过期');
      }
      db.prepare(`INSERT OR IGNORE INTO editor_imports(operation_id,user_id,job_id,library_id,folder,requested_name,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(body.operationId, userId, job.id, body.libraryId, body.folder, body.name, timestamp());
      const row = db.prepare('SELECT * FROM editor_imports WHERE operation_id=?').get(body.operationId) as ImportRow;
      if (row.user_id !== userId || row.job_id !== job.id || row.library_id !== body.libraryId || row.folder !== body.folder || row.requested_name !== body.name) {
        throw new EditorError(409, 'OPERATION_CONFLICT', '操作编号已用于其他导入');
      }
      if (row.status === 'saved') return row;
      if (row.owner && (row.lease_until ?? 0) > timestamp()) throw new EditorError(409, 'OPERATION_CONFLICT', '导入正在进行，请稍后重试');
      const busy = db.prepare("SELECT count(*) AS n FROM editor_imports WHERE owner IS NOT NULL AND lease_until>?").get(timestamp()) as { n: number };
      if (busy.n >= 2) throw new EditorError(503, 'OPERATION_CONFLICT', '导入任务较多，请稍后重试');
      if (!row.stage_ready && row.stage_name) {
        db.prepare(`INSERT OR IGNORE INTO editor_import_stage_gc(stage_name,operation_id,library_id,folder,parent_dev,parent_ino,stage_dev,stage_ino,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(row.stage_name, body.operationId, row.library_id, row.folder, row.parent_dev, row.parent_ino, row.stage_dev, row.stage_ino, timestamp());
      }
      const stageName = row.stage_ready && row.stage_name ? row.stage_name : `.luvia-import-${key}-${randomUUID()}.tmp`;
      db.prepare("UPDATE editor_imports SET owner=?,lease_until=?,stage_name=?,stage_dev=?,stage_ino=?,status='pending' WHERE operation_id=?")
        .run(owner, timestamp() + 120, stageName, row.stage_ready ? row.stage_dev : null, row.stage_ready ? row.stage_ino : null, body.operationId);
      return { ...row, owner, lease_until: timestamp() + 120, stage_name: stageName,
        stage_dev: row.stage_ready ? row.stage_dev : null, stage_ino: row.stage_ready ? row.stage_ino : null };
    }).immediate();
    if (op.status === 'saved') return { status: 'saved' as const, mediaId: op.media_id, name: op.final_name!, folder: body.folder };
    heartbeat = setInterval(() => {
      try { db.prepare('UPDATE editor_imports SET lease_until=? WHERE operation_id=? AND owner=?').run(timestamp() + 120, body.operationId, owner); }
      catch { /* 数据库繁忙时由发布前的围栏校验决定是否继续。 */ }
    }, 10_000);
    heartbeat.unref();
    try { target = await openTarget(library.root, body.folder); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EACCES' || code === 'EROFS' || code === 'EPERM') throw new EditorError(409, 'MEDIA_READ_ONLY', '媒体库目录不可写');
      throw new EditorError(403, 'FORBIDDEN', '目标目录不可访问或包含符号链接');
    }
    const directory = target.directory;
    if (!op.stage_name || !/^\.luvia-import-[a-f0-9]{64}-[a-f0-9-]{36}\.tmp$/.test(op.stage_name)) {
      throw new EditorError(500, 'OPERATION_PARTIAL', '导入暂存记录异常');
    }
    const parentIdentity = await target.handle.stat({ bigint: true });
    if (op.stage_ready && (parentIdentity.dev.toString() !== op.parent_dev || parentIdentity.ino.toString() !== op.parent_ino)) {
      throw new EditorError(500, 'OPERATION_PARTIAL', '导入目录身份已变化');
    }
    if (!op.stage_ready) {
      db.prepare('UPDATE editor_imports SET parent_dev=?,parent_ino=? WHERE operation_id=? AND owner=?')
        .run(parentIdentity.dev.toString(), parentIdentity.ino.toString(), body.operationId, owner);
      await mkdir(path.join(directory, op.stage_name), { mode: 0o700 });
    }
    stageHandle = await open(path.join(directory, op.stage_name), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const stageIdentity = await stageHandle.stat({ bigint: true });
    const stageDir = process.platform === 'linux' ? `/proc/self/fd/${stageHandle.fd}` : path.join(directory, op.stage_name);
    const stage = path.join(stageDir, 'image');
    if (!op.stage_ready) {
      const file = await open(stage, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        const identity = await file.stat({ bigint: true });
        const changed = db.prepare('UPDATE editor_imports SET stage_dev=?,stage_ino=? WHERE operation_id=? AND owner=? AND lease_until>=?')
          .run(identity.dev.toString(), identity.ino.toString(), body.operationId, owner, timestamp());
        if (!changed.changes) throw new EditorError(409, 'OPERATION_CONFLICT', '导入认领已失效，请重试');
        op = { ...op, stage_dev: identity.dev.toString(), stage_ino: identity.ino.toString() };
        let image = sharp(job.result_path).keepIccProfile();
        image = extension === '.jpg' || extension === '.jpeg' ? image.jpeg({ quality: 92 }) : extension === '.webp' ? image.webp({ quality: 92 }) : image.png();
        await pipeline(image, createWriteStream('', { fd: file.fd, autoClose: false }));
        await file.chmod(0o666 & ~process.umask());
        await file.sync();
      } finally { await file.close(); }
      const changed = db.prepare('UPDATE editor_imports SET stage_ready=1 WHERE operation_id=? AND owner=? AND lease_until>=?')
        .run(body.operationId, owner, timestamp());
      if (!changed.changes) throw new EditorError(409, 'OPERATION_CONFLICT', '导入认领已失效，请重试');
      op = { ...op, stage_ready: 1 };
    }
    const staged = await lstat(stage, { bigint: true });
    if (!staged.isFile() || staged.isSymbolicLink() || staged.dev.toString() !== op.stage_dev || staged.ino.toString() !== op.stage_ino)
      throw new EditorError(500, 'OPERATION_PARTIAL', '导入暂存文件异常或身份已变化');
    const verifyParents = () => {
      try { if (realpathSync(library.root) !== target!.parents[0]!.path) throw new Error(); }
      catch { throw new EditorError(500, 'OPERATION_PARTIAL', '媒体库根目录已变化，请检查导入结果'); }
      let visibleStage;
      try { visibleStage = lstatSync(path.join(directory, op.stage_name!), { bigint: true }); }
      catch { throw new EditorError(500, 'OPERATION_PARTIAL', '导入暂存目录已变化'); }
      if (!visibleStage.isDirectory() || visibleStage.isSymbolicLink() || visibleStage.dev !== stageIdentity.dev || visibleStage.ino !== stageIdentity.ino)
        throw new EditorError(500, 'OPERATION_PARTIAL', '导入暂存目录已变化');
      for (const parent of target!.parents) {
        let current;
        try { current = lstatSync(parent.path, { bigint: true }); } catch { throw new EditorError(500, 'OPERATION_PARTIAL', '目标目录已变化，请检查导入结果'); }
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== parent.dev || current.ino !== parent.ino) {
          throw new EditorError(500, 'OPERATION_PARTIAL', '目标目录已变化，请检查导入结果');
        }
      }
    };
    // 候选名称先提交，崩溃后必须恢复同一个名称，避免生成第二份可见文件。
    let chosen = op.final_name;
    if (!chosen) {
      for (let i = 0; i < 100; i++) {
        const candidate = i === 0 ? `${stem}${extension}` : `${stem} (${i})${extension}`;
        try { await lstat(path.join(directory, candidate)); continue; }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        try {
          const reserved = db.prepare('UPDATE editor_imports SET final_name=? WHERE operation_id=? AND owner=? AND lease_until>=? AND final_name IS NULL')
            .run(candidate, body.operationId, owner, timestamp());
          if (!reserved.changes) throw new EditorError(409, 'OPERATION_CONFLICT', '导入认领已失效，请重试');
          chosen = candidate;
          break;
        } catch (error) {
          if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') continue;
          throw error;
        }
      }
      if (!chosen) throw new EditorError(409, 'OPERATION_CONFLICT', '同名文件过多，请更换名称');
    }
    db.transaction(() => {
      const current = db.prepare('SELECT owner,lease_until,final_name FROM editor_imports WHERE operation_id=?').get(body.operationId) as
        { owner: string | null; lease_until: number | null; final_name: string | null };
      if (current.owner !== owner || (current.lease_until ?? 0) < timestamp() || current.final_name !== chosen)
        throw new EditorError(409, 'OPERATION_CONFLICT', '导入认领已失效，请重试');
      verifyParents();
      try { linkSync(stage, path.join(directory, chosen!)); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const present = lstatSync(path.join(directory, chosen!), { bigint: true });
        if (present.dev !== staged.dev || present.ino !== staged.ino) {
          throw new EditorError(500, 'OPERATION_PARTIAL', '目标文件已被占用或替换，请检查导入结果');
        }
      }
      verifyParents();
    }).immediate();
    const relative = body.folder ? `${body.folder}/${chosen}` : chosen;
    const folder = virtualPath(body.libraryId, body.folder);
    const id = mediaId(body.libraryId, relative);
    const file = await stat(stage);
    const identity = statFields(staged);
    const meta = await sharp(stage).metadata();
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    try {
      db.transaction(() => {
        verifyParents();
        const visible = lstatSync(path.join(directory, chosen!), { bigint: true });
        if (!visible.isFile() || visible.dev !== staged.dev || visible.ino !== staged.ino) {
          throw new EditorError(500, 'OPERATION_PARTIAL', '导入目标已变化，请检查文件');
        }
        const prior = db.prepare('SELECT dev,ino FROM files WHERE id=?').get(id) as { dev: string | null; ino: string | null } | undefined;
        if (prior && (prior.dev !== identity.dev || prior.ino !== identity.ino)) throw new Error('索引文件身份冲突');
        if (!prior) db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,width,height,mtime_ms,dev,ino)
          VALUES (?,?,?,?,?,?,'image',?,?,?,'mtime',?,?,?,?,?)`).run(id, body.libraryId, relative, folder, chosen, mime, file.size,
          Math.floor(file.mtimeMs / 1000), Math.floor(file.mtimeMs / 1000), meta.width, meta.height, identity.mtimeMs, identity.dev, identity.ino);
        const changed = db.prepare("UPDATE editor_imports SET status='saved',media_id=? WHERE operation_id=? AND owner=? AND lease_until>=?")
          .run(id, body.operationId, owner, timestamp());
        if (!changed.changes) throw new Error('导入认领已失效');
      }).immediate();
    } catch (error) {
      if (error instanceof EditorError) throw error;
      return { status: 'pending' as const, mediaId: null, name: chosen, folder: body.folder };
    }
    try { await materializeFolders(db, body.libraryId, () => {}); } catch { /* 目录统计会由后续扫描恢复。 */ }
    try {
      appendLibraryChange(db, body.libraryId, { ts: new Date().toISOString(), kind: 'added', path: relative, fromPath: null, isDir: false, mediaId: id, source: 'scan' });
      publishLibraryEvent(db, { libraryId: body.libraryId, source: 'scan', folders: [folder], added: 1, removed: 0, updated: 0, moved: 0 });
    } catch { /* 不影响已写盘并索引的结果。 */ }
    return { status: 'saved' as const, mediaId: id, name: chosen, folder: body.folder };
  } catch (error) {
    try {
      if (error instanceof EditorError && error.code === 'OPERATION_PARTIAL') {
        db.prepare("UPDATE editor_imports SET status='attention' WHERE operation_id=? AND owner=? AND stage_ready=1")
          .run(body.operationId, owner);
      }
      db.prepare("UPDATE editor_imports SET status='failed' WHERE operation_id=? AND owner=? AND stage_ready=0").run(body.operationId, owner);
      db.prepare(`INSERT OR IGNORE INTO editor_import_stage_gc(stage_name,operation_id,library_id,folder,parent_dev,parent_ino,stage_dev,stage_ino,created_at)
        SELECT stage_name,operation_id,library_id,folder,parent_dev,parent_ino,stage_dev,stage_ino,? FROM editor_imports
        WHERE operation_id=? AND owner=? AND status='failed' AND stage_name IS NOT NULL`).run(timestamp(), body.operationId, owner);
    } catch { /* 认领到期后可重试。 */ }
    if (error instanceof EditorError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EROFS' || code === 'EPERM') throw new EditorError(409, 'MEDIA_READ_ONLY', '媒体库目录不可写');
    throw new EditorError(500, 'OPERATION_FAILED', '导入失败，请使用相同操作编号重试');
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    try { db.prepare('UPDATE editor_imports SET owner=NULL,lease_until=NULL WHERE operation_id=? AND owner=?').run(body.operationId, owner); } catch { /* 下次租约到期后可恢复。 */ }
    await stageHandle?.close();
    await target?.handle.close();
    active.delete(body.operationId);
  }
}

/** 只清理数据库登记、身份一致的私有暂存目录。 */
export async function cleanupSavedImport(db: Database.Database, operationId: string): Promise<void> {
  const owner = randomUUID();
  const row = db.transaction(() => {
    const item = db.prepare(`SELECT i.stage_name,i.stage_dev,i.stage_ino,i.parent_dev,i.parent_ino,i.folder,i.owner,i.lease_until,l.root FROM editor_imports i
      JOIN libraries l ON l.id=i.library_id WHERE i.operation_id=? AND i.status='saved'`).get(operationId) as
      { stage_name: string | null; stage_dev: string | null; stage_ino: string | null; parent_dev: string | null; parent_ino: string | null;
        folder: string; owner: string | null; lease_until: number | null; root: string } | undefined;
    if (!item?.stage_name || (item.owner && (item.lease_until ?? 0) > timestamp())) return null;
    db.prepare('UPDATE editor_imports SET owner=?,lease_until=? WHERE operation_id=?').run(owner, timestamp() + 120, operationId);
    return item;
  }).immediate();
  if (!row?.stage_name || !/^\.luvia-import-[a-f0-9]{64}-[a-f0-9-]{36}\.tmp$/.test(row.stage_name)) return;
  let target: Awaited<ReturnType<typeof openTarget>> | undefined;
  let stageHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    target = await openTarget(row.root, row.folder, false).catch(() => undefined);
    if (!target) return;
    const parent = await target.handle.stat({ bigint: true });
    if (parent.dev.toString() !== row.parent_dev || parent.ino.toString() !== row.parent_ino) return;
    const directory = path.join(target.directory, row.stage_name);
    try { stageHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return;
    }
    const stage = path.join(process.platform === 'linux' ? `/proc/self/fd/${stageHandle.fd}` : directory, 'image');
    let info;
    try { info = await lstat(stage, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; info = null; }
    if (info && (!info.isFile() || info.isSymbolicLink() || info.dev.toString() !== row.stage_dev || info.ino.toString() !== row.stage_ino)) return;
    if (info) await rm(stage);
    await stageHandle.close(); stageHandle = undefined;
    await rmdir(directory);
    db.prepare("UPDATE editor_imports SET stage_name=NULL WHERE operation_id=? AND status='saved' AND stage_name=?")
      .run(operationId, row.stage_name);
  } finally {
    await stageHandle?.close();
    await target?.handle.close();
    db.prepare('UPDATE editor_imports SET owner=NULL,lease_until=NULL WHERE operation_id=? AND owner=?').run(operationId, owner);
  }
}

/** 清理失去认领的旧私有目录；身份不足时保留原样。 */
export async function cleanupRetiredImport(db: Database.Database, stageName: string): Promise<void> {
  const row = db.prepare(`SELECT g.*,l.root FROM editor_import_stage_gc g JOIN libraries l ON l.id=g.library_id
    WHERE g.stage_name=? AND NOT EXISTS (SELECT 1 FROM editor_imports i WHERE i.stage_name=g.stage_name AND i.status='pending' AND i.owner IS NOT NULL AND i.lease_until>?)`)
    .get(stageName, timestamp()) as { stage_name: string; folder: string; root: string; parent_dev: string | null; parent_ino: string | null;
      stage_dev: string | null; stage_ino: string | null } | undefined;
  if (!row || !/^\.luvia-import-[a-f0-9]{64}-[a-f0-9-]{36}\.tmp$/.test(row.stage_name) || !row.parent_dev || !row.parent_ino) return;
  const target = await openTarget(row.root, row.folder, false).catch(() => null);
  if (!target) return;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const parent = await target.handle.stat({ bigint: true });
    if (parent.dev.toString() !== row.parent_dev || parent.ino.toString() !== row.parent_ino) return;
    const directory = path.join(target.directory, row.stage_name);
    try { handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const image = path.join(process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : directory, 'image');
    let info;
    try { info = await lstat(image, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; info = null; }
    if (info && (!row.stage_dev || !row.stage_ino || !info.isFile() || info.isSymbolicLink() || info.dev.toString() !== row.stage_dev || info.ino.toString() !== row.stage_ino)) return;
    if (info) await rm(image);
    await handle.close(); handle = undefined;
    await rmdir(directory);
    db.prepare('DELETE FROM editor_import_stage_gc WHERE stage_name=?').run(stageName);
  } finally { await handle?.close(); await target.handle.close(); }
}
