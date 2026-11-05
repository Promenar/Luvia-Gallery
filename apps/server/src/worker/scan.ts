import type Database from 'better-sqlite3';
import { opendir, stat, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lookup } from 'mime-types';
import { mediaId, virtualPath } from '../core/paths.ts';
import { statFields } from '../watch/file-info.ts';
import { readSettings } from '../core/settings.ts';
import { cleanupDeletedMediaCache } from './cache-prune.ts';

type Options = {
  allowedRoots: string[]; openDir?: typeof opendir; signal?: AbortSignal;
  batchSize?: number; statConcurrency?: number; owner?: string; jobId?: string; jobLeaseToken?: string; clock?: () => number; cacheDir?: string;
};
type Candidate = { relative: string; size: number; mtime: number; mtimeMs: number; dev: string; ino: string; movedId: string | null };
type ScanResult = { added: number; removed: number; errors: number };
type ScanRun = ScanResult & { library_id: string; marker: string; complete: number };
const imageExt = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.heic','.heif','.tif','.tiff','.bmp']);
const videoExt = new Set(['.mp4','.m4v','.mkv','.mov','.webm','.avi','.wmv','.mpeg','.mpg']);
const audioExt = new Set(['.mp3','.wav','.flac','.m4a','.aac','.ogg','.wma','.opus']);
function typeOf(relative: string): 'image' | 'video' | 'audio' | null {
  const ext = path.extname(relative).toLowerCase();
  return imageExt.has(ext) ? 'image' : videoExt.has(ext) ? 'video' : audioExt.has(ext) ? 'audio' : null;
}
function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
class LeaseLost extends Error {
  constructor() { super('扫描租约已失效'); }
}

export async function scanLibrary(db: Database.Database, library: { id: string; root: string }, options: Options): Promise<ScanResult> {
  const owner = options.owner ?? randomUUID();
  const lockToken = randomUUID();
  const clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
  const at = clock();
  const jobToken = options.jobId ? options.jobLeaseToken ?? (db.prepare('SELECT lease_token FROM jobs WHERE id=? AND owner=?').get(options.jobId, owner) as { lease_token: string | null } | undefined)?.lease_token : null;
  if (options.jobId && !jobToken) throw new LeaseLost();
  const locked = db.prepare(`INSERT INTO scan_locks(library_id,owner,acquired_at,heartbeat_at,lease_expires_at,lease_token)
    VALUES (?,?,?,?,?,?) ON CONFLICT(library_id) DO UPDATE SET owner=excluded.owner, acquired_at=excluded.acquired_at,
    heartbeat_at=excluded.heartbeat_at, lease_expires_at=excluded.lease_expires_at,lease_token=excluded.lease_token
    WHERE scan_locks.lease_expires_at<=?`).run(library.id, owner, at, at, at + 30, lockToken, at);
  if (!locked.changes) throw new Error('媒体库正在扫描');
  let lost = false;
  const assertLease = () => {
    if (lost) throw new LeaseLost();
    const at = clock();
    const lock = db.prepare('SELECT 1 FROM scan_locks WHERE library_id=? AND owner=? AND lease_token=? AND lease_expires_at>?').get(library.id, owner, lockToken, at);
    const job = !options.jobId || db.prepare("SELECT 1 FROM jobs WHERE id=? AND status='running' AND owner=? AND lease_token=? AND lease_expires_at>?").get(options.jobId, owner, jobToken, at);
    if (!lock || !job) throw new LeaseLost();
  };
  const timer = setInterval(() => {
    try {
      const at = clock();
      if (options.jobId && !db.prepare("SELECT 1 FROM jobs WHERE id=? AND status='running' AND owner=? AND lease_token=? AND lease_expires_at>?").get(options.jobId, owner, jobToken, at)) { lost = true; return; }
      const result = db.prepare('UPDATE scan_locks SET heartbeat_at=?,lease_expires_at=? WHERE library_id=? AND owner=? AND lease_token=? AND lease_expires_at>?')
        .run(at, at + 30, library.id, owner, lockToken, at);
      if (!result.changes) lost = true;
    } catch { lost = true; }
  }, 5000);
  timer.unref();
  try { return await scanWithLock(db, library, options, assertLease); }
  finally {
    clearInterval(timer);
    db.prepare('DELETE FROM scan_locks WHERE library_id=? AND owner=? AND lease_token=?').run(library.id, owner, lockToken);
  }
}

async function scanWithLock(db: Database.Database, library: { id: string; root: string }, options: Options, assertLease: () => void): Promise<ScanResult> {
  const signal = options.signal;
  signal?.throwIfAborted();
  const openDir = options.openDir ?? opendir;
  const batchSize = Math.max(1, Math.min(1000, options.batchSize ?? 256));
  const concurrency = Math.max(1, Math.min(32, options.statConcurrency ?? 8));
  const root = await realpath(library.root);
  const rootIdentity = await stat(root, { bigint: true });
  const allowedRoots = await Promise.all(options.allowedRoots.map((allowed) => realpath(allowed)));
  if (!allowedRoots.some((allowed) => within(allowed, root))) throw new Error('扫描路径不在允许的挂载根目录内');
  const libraryRow = db.prepare('SELECT name,exclude FROM libraries WHERE id=?').get(library.id) as { name: string; exclude: string } | undefined;
  if (!libraryRow) throw new Error('媒体库不存在');
  const exclude = JSON.parse(libraryRow.exclude) as unknown;
  if (!Array.isArray(exclude) || exclude.some((rule) => typeof rule !== 'string')) throw new Error('媒体库排除规则无效');
  const jobId = options.jobId;
  let marker: string = randomUUID();
  let result: ScanResult = { added: 0, removed: 0, errors: 0 };
  if (jobId) {
    const run = db.transaction(() => {
      assertLease();
      const previous = db.prepare('SELECT * FROM scan_runs WHERE job_id=?').get(jobId) as ScanRun | undefined;
      if (previous) {
        if (previous.library_id !== library.id) throw new Error('扫描断点与媒体库不一致');
        return previous;
      }
      db.prepare('INSERT INTO scan_runs(job_id,library_id,marker) VALUES (?,?,?)').run(jobId, library.id, marker);
      db.prepare("INSERT INTO scan_directories(job_id,relative_path) VALUES (?,'')").run(jobId);
      db.prepare('UPDATE jobs SET checkpoint=? WHERE id=?').run(JSON.stringify({ scanJobId: jobId }), jobId);
      return { library_id: library.id, marker, added: 0, removed: 0, errors: 0, complete: 0 };
    }).immediate();
    marker = run.marker;
    result = { added: run.added, removed: run.removed, errors: run.errors };
    if (run.complete) return result;
  }
  db.transaction(() => {
    assertLease();
    db.prepare('DELETE FROM scan_conflicts WHERE library_id=? AND marker<>?').run(library.id, marker);
  }).immediate();
  const queue: string[] = [''];
  let batch: Candidate[] = [];
  let pending: Promise<void>[] = [];
  const existing = db.prepare('SELECT id FROM files WHERE id=?');
  const existingPath = db.prepare('SELECT id,dev,ino,missing_at_ms FROM files WHERE library_id=? AND relative_path=?');
  const identity = db.prepare('SELECT f.id,f.relative_path FROM file_watch_index w JOIN files f ON f.id=w.file_id WHERE w.library_id=? AND w.dev=? AND w.ino=? LIMIT 2');
  const grace = readSettings(db).libraries.missingGraceDays * 86_400_000;
  const scanNow = () => options.clock ? options.clock() * 1000 : Date.now();
  const removeFile = (id: string) => {
    db.prepare("DELETE FROM favorites WHERE item_type='file' AND item_id=?").run(id);
    db.prepare('UPDATE albums SET cover_id=NULL WHERE cover_id=?').run(id);
    db.prepare(`INSERT OR REPLACE INTO cache_gc(cache_key,relative_path) SELECT cache_key,relative_path FROM cache_entries
      WHERE media_id=? AND (variant IS NULL OR variant<>'hls')`).run(id);
    db.prepare('DELETE FROM cache_entries WHERE media_id=? OR hls_session_id IN (SELECT id FROM hls_sessions WHERE media_id=?)').run(id, id);
    db.prepare('DELETE FROM files WHERE id=?').run(id);
  };
  const isExpired = (at: number | null) => at !== null && (grace === 0 || scanNow() > at + grace);
  const resetMetadata = ['orientation','duration_sec','codec','audio_codec','container','fps','bitrate','make','model','lens','f_number','exposure_time','iso','focal_length','focal_length35','software','latitude','longitude','altitude','playability']
    .map((column) => `${column}=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN NULL ELSE files.${column} END`).join(',');
  const upsert = db.prepare(`INSERT INTO files
    (id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,scan_marker,dev,ino,mtime_ms)
    VALUES (@id,@library_id,@relative_path,@folder,@name,@mime,@media_type,@size,@mtime,@mtime,'mtime',@marker,@dev,@ino,@mtime_ms)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, relative_path=excluded.relative_path, folder=excluded.folder, mime=excluded.mime, media_type=excluded.media_type,
      taken_at=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN excluded.modified_at ELSE files.taken_at END,
      taken_at_source=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN 'mtime' ELSE files.taken_at_source END,
      metadata_status=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN 'pending' ELSE files.metadata_status END,
      thumb_version=CASE WHEN (files.size != excluded.size OR files.modified_at != excluded.modified_at) AND files.thumb_version>0 THEN files.thumb_version + 1 ELSE files.thumb_version END,
      thumb_ready=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN 0 ELSE files.thumb_ready END,
      thumbhash=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN NULL ELSE files.thumbhash END,
      width=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN NULL ELSE files.width END,
      height=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN NULL ELSE files.height END,
      ${resetMetadata},
      has_preview=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN 0 ELSE files.has_preview END,
      head_hash=CASE WHEN files.size != excluded.size OR files.mtime_ms != excluded.mtime_ms THEN NULL ELSE files.head_hash END,
      size=excluded.size, modified_at=excluded.modified_at, scan_marker=excluded.scan_marker,dev=excluded.dev,ino=excluded.ino,mtime_ms=excluded.mtime_ms,missing_at_ms=NULL`);
  const flush = (allowDefer = true) => {
    if (!batch.length) return;
    const current = batch; batch = [];
    db.transaction(() => {
      assertLease();
      for (const file of current) {
        let byPath = existingPath.get(library.id, file.relative) as { id: string; dev: string | null; ino: string | null; missing_at_ms: number | null } | undefined;
        let moved = file.movedId ? db.prepare('SELECT id,missing_at_ms FROM files WHERE id=? AND library_id=? AND dev=? AND ino=? AND (scan_marker IS NULL OR scan_marker<>?)').get(file.movedId, library.id, file.dev, file.ino, marker) as { id: string; missing_at_ms: number | null } | undefined : undefined;
        if (allowDefer && ((byPath?.missing_at_ms ?? null) !== null || (moved?.missing_at_ms ?? null) !== null ||
          (byPath?.dev && byPath.ino && (byPath.dev !== file.dev || byPath.ino !== file.ino)))) {
          db.prepare(`INSERT OR REPLACE INTO scan_conflicts(library_id,marker,relative_path,size,mtime,mtime_ms,dev,ino,moved_id)
            VALUES (?,?,?,?,?,?,?,?,?)`).run(library.id, marker, file.relative, file.size, file.mtime, file.mtimeMs, file.dev, file.ino, file.movedId);
          continue;
        }
        if (!allowDefer && byPath && isExpired(byPath.missing_at_ms)) { removeFile(byPath.id); result.removed++; if (moved?.id === byPath.id) moved = undefined; byPath = undefined; }
        if (!allowDefer && moved && isExpired(moved.missing_at_ms)) { removeFile(moved.id); result.removed++; moved = undefined; }
        const preferred = mediaId(library.id, file.relative);
        const id = byPath?.id ?? moved?.id ?? (existing.get(preferred) ? randomUUID() : preferred);
        const kind = typeOf(file.relative)!;
        const dirname = path.posix.dirname(file.relative);
        if (!existing.get(id)) result.added++;
        upsert.run({ id, library_id: library.id, relative_path: file.relative, folder: virtualPath(library.id, dirname === '.' ? '' : dirname),
          name: path.posix.basename(file.relative), mime: lookup(file.relative) || 'application/octet-stream', media_type: kind,
          size: file.size, mtime: file.mtime, marker, dev: file.dev, ino: file.ino, mtime_ms: file.mtimeMs });
        if (!allowDefer) db.prepare('DELETE FROM scan_conflicts WHERE library_id=? AND marker=? AND relative_path=?').run(library.id, marker, file.relative);
      }
      if (jobId) db.prepare('UPDATE scan_runs SET added=?,removed=? WHERE job_id=?').run(result.added, result.removed, jobId);
    }).immediate();
  };
  let writeFailure: unknown;
  while (true) {
    signal?.throwIfAborted();
    assertLease();
    const relativeDir = jobId
      ? (db.prepare('SELECT relative_path FROM scan_directories WHERE job_id=? AND done=0 ORDER BY relative_path LIMIT 1').get(jobId) as { relative_path: string } | undefined)?.relative_path
      : queue.pop();
    if (relativeDir === undefined) break;
    const children: string[] = [];
    const dir = path.join(root, relativeDir);
    let dirInfo: ReturnType<typeof statFields> | null = null;
    try {
      const resolved = await realpath(dir);
      if (!within(root, resolved)) throw new Error('目录越出媒体库');
      dirInfo = statFields(await stat(resolved, { bigint: true }));
      for await (const entry of await openDir(resolved)) {
        signal?.throwIfAborted();
        const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory() && exclude.some((rule: string) => path.matchesGlob(entry.name, rule) || path.matchesGlob(relative, rule))) continue;
        if (entry.isDirectory()) children.push(relative);
        else if (entry.isFile() && typeOf(relative)) {
          const full = path.join(root, relative);
          pending.push((async () => {
            try {
              const resolvedFile = await realpath(full);
              if (!within(root, resolvedFile)) throw new Error('文件越出媒体库');
              const info = await stat(resolvedFile, { bigint: true });
              if (info.isFile()) {
                const fields = statFields(info); let movedId: string | null = null;
                const candidates = identity.all(library.id, fields.dev, fields.ino) as { id: string; relative_path: string }[];
                if (candidates.length === 1 && candidates[0]!.relative_path !== relative) {
                  try {
                    const old = await lstat(path.join(root, candidates[0]!.relative_path), { bigint: true });
                    if (old.dev.toString() !== fields.dev || old.ino.toString() !== fields.ino) movedId = candidates[0]!.id;
                  }
                  catch (error) { if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) movedId = candidates[0]!.id; else throw error; }
                }
                batch.push({ relative, size: fields.size, mtime: Math.floor(fields.mtimeMs / 1000), mtimeMs: fields.mtimeMs, dev: fields.dev, ino: fields.ino, movedId });
              }
            } catch { result.errors++; }
          })());
          if (pending.length >= concurrency) {
            await Promise.all(pending); pending = [];
            if (batch.length >= batchSize) {
              try { flush(); } catch (error) { writeFailure = error; throw error; }
            }
          }
        } else if (!entry.isFile() && !entry.isSymbolicLink()) result.errors++;
      }
    } catch (error) {
      if (signal?.aborted || error instanceof LeaseLost || error === writeFailure) throw error;
      dirInfo = null;
      result.errors++;
    }
    await Promise.all(pending); pending = [];
    signal?.throwIfAborted();
    flush();
    db.transaction(() => {
      assertLease();
      const folderPath = virtualPath(library.id, relativeDir);
      const parentRelative = relativeDir ? path.posix.dirname(relativeDir) : null;
      const parent = parentRelative === null ? null : virtualPath(library.id, parentRelative === '.' ? '' : parentRelative);
      if (dirInfo) db.prepare(`INSERT INTO folders(path,library_id,parent,name,scan_marker,dev,ino,mtime_ms) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(path) DO UPDATE SET parent=excluded.parent,name=excluded.name,scan_marker=excluded.scan_marker,
          dev=excluded.dev,ino=excluded.ino,mtime_ms=excluded.mtime_ms,missing_at_ms=NULL`)
        .run(folderPath, library.id, parent, relativeDir ? path.posix.basename(relativeDir) : libraryRow.name, marker, dirInfo.dev, dirInfo.ino, dirInfo.mtimeMs);
      if (jobId) {
        const insert = db.prepare('INSERT OR IGNORE INTO scan_directories(job_id,relative_path) VALUES (?,?)');
        for (const child of children) insert.run(jobId, child);
        db.prepare('UPDATE scan_directories SET done=1 WHERE job_id=? AND relative_path=?').run(jobId, relativeDir);
        db.prepare('UPDATE scan_runs SET errors=? WHERE job_id=?').run(result.errors, jobId);
      }
    }).immediate();
    if (!jobId) queue.push(...children);
  }
  const rootAvailable = async () => {
    try {
      const finalRoot = await realpath(library.root); const finalIdentity = await stat(finalRoot, { bigint: true });
      return finalRoot === root && finalIdentity.dev === rootIdentity.dev && finalIdentity.ino === rootIdentity.ino;
    } catch { return false; }
  };
  if (result.errors === 0 && !(await rootAvailable())) result.errors++;
  while (result.errors === 0) {
    signal?.throwIfAborted();
    const conflicts = db.prepare(`SELECT relative_path AS relative,size,mtime,mtime_ms AS mtimeMs,dev,ino,moved_id AS movedId
      FROM scan_conflicts WHERE library_id=? AND marker=? ORDER BY relative_path LIMIT ?`).all(library.id, marker, batchSize) as Candidate[];
    if (!conflicts.length) break;
    if (!(await rootAvailable())) { result.errors++; break; }
    batch = conflicts; flush(false);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (result.errors === 0) {
    const nowMs = scanNow();
    const expired = db.prepare(`SELECT id FROM files WHERE library_id=? AND (scan_marker IS NULL OR scan_marker<>?)
      AND missing_at_ms IS NOT NULL AND ${grace === 0 ? 'missing_at_ms<=?' : 'missing_at_ms<?'} LIMIT 256`);
    let count: number;
    do {
      signal?.throwIfAborted();
      if (!(await rootAvailable())) { result.errors++; break; }
      count = db.transaction(() => {
        assertLease();
        const rows = expired.all(library.id, marker, nowMs - grace) as { id: string }[];
        for (const { id } of rows) removeFile(id);
        result.removed += rows.length;
        if (jobId) db.prepare('UPDATE scan_runs SET removed=? WHERE job_id=?').run(result.removed, jobId);
        return rows.length;
      }).immediate();
      if (count) await new Promise<void>((resolve) => setImmediate(resolve));
    } while (count);
    const markFiles = db.prepare(`UPDATE files SET missing_at_ms=? WHERE rowid IN (SELECT rowid FROM files WHERE library_id=?
      AND (scan_marker IS NULL OR scan_marker<>?) AND missing_at_ms IS NULL LIMIT 256)`);
    while (result.errors === 0) {
      signal?.throwIfAborted(); if (!(await rootAvailable())) { result.errors++; break; }
      count = db.transaction(() => { assertLease(); return Number(markFiles.run(nowMs, library.id, marker).changes); }).immediate();
      if (!count) break; await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const expiredFolders = db.prepare(`SELECT path FROM folders WHERE library_id=? AND (scan_marker IS NULL OR scan_marker<>?)
      AND missing_at_ms IS NOT NULL AND ${grace === 0 ? 'missing_at_ms<=?' : 'missing_at_ms<?'} LIMIT 256`);
    while (result.errors === 0) {
      signal?.throwIfAborted(); if (!(await rootAvailable())) { result.errors++; break; }
      count = db.transaction(() => {
        assertLease(); const stale = expiredFolders.all(library.id, marker, nowMs - grace) as { path: string }[];
        for (const { path: folder } of stale) {
          db.prepare("DELETE FROM favorites WHERE item_type='folder' AND item_id=?").run(folder);
          db.prepare('DELETE FROM folders WHERE path=?').run(folder);
        }
        return stale.length;
      }).immediate();
      if (!count) break; await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const markFolders = db.prepare(`UPDATE folders SET missing_at_ms=? WHERE rowid IN (SELECT rowid FROM folders WHERE library_id=?
      AND (scan_marker IS NULL OR scan_marker<>?) AND missing_at_ms IS NULL LIMIT 256)`);
    while (result.errors === 0) {
      signal?.throwIfAborted(); if (!(await rootAvailable())) { result.errors++; break; }
      count = db.transaction(() => { assertLease(); return Number(markFolders.run(nowMs, library.id, marker).changes); }).immediate();
      if (!count) break; await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  await materializeFolders(db, library.id, assertLease, signal);
  if (options.cacheDir) await cleanupDeletedMediaCache(db, options.cacheDir, { owner: options.owner ?? 'scan-cache-cleanup', signal, assertLease });
  if (jobId) db.transaction(() => {
    assertLease();
    db.prepare('UPDATE scan_runs SET complete=1 WHERE job_id=?').run(jobId);
  }).immediate();
  return result;
}

async function materializeFolders(db: Database.Database, libraryId: string, assertLease: () => void, signal?: AbortSignal): Promise<void> {
  type Folder = { path: string; parent: string | null; direct: number; total: number; children: number; latest: number | null; cover: string | null; coverAt: number | null };
  const folders = (db.prepare('SELECT path,parent FROM folders WHERE library_id=? AND missing_at_ms IS NULL').all(libraryId) as { path: string; parent: string | null }[])
    .map((folder): Folder => ({ ...folder, direct: 0, total: 0, children: 0, latest: null, cover: null, coverAt: null }));
  const byPath = new Map(folders.map((folder) => [folder.path, folder]));
  const count = db.prepare('SELECT count(*) AS n FROM files WHERE folder=? AND missing_at_ms IS NULL');
  const latest = db.prepare('SELECT taken_at FROM files WHERE folder=? AND missing_at_ms IS NULL ORDER BY taken_at DESC,id ASC LIMIT 1');
  const cover = db.prepare('SELECT id,taken_at FROM files WHERE folder=? AND missing_at_ms IS NULL AND thumb_ready=1 ORDER BY taken_at DESC,id ASC LIMIT 1');
  for (const folder of folders) {
    signal?.throwIfAborted();
    folder.direct = (count.get(folder.path) as { n: number }).n;
    folder.total = folder.direct;
    folder.latest = (latest.get(folder.path) as { taken_at: number } | undefined)?.taken_at ?? null;
    const selected = cover.get(folder.path) as { id: string; taken_at: number } | undefined;
    folder.cover = selected?.id ?? null; folder.coverAt = selected?.taken_at ?? null;
    if (folder.parent) { const parent = byPath.get(folder.parent); if (parent) parent.children++; }
  }
  folders.sort((a, b) => b.path.length - a.path.length);
  for (const folder of folders) {
    const parent = folder.parent ? byPath.get(folder.parent) : undefined;
    if (!parent) continue;
    parent.total += folder.total;
    if (folder.latest !== null && (parent.latest === null || folder.latest > parent.latest)) parent.latest = folder.latest;
    if (folder.coverAt !== null && (parent.coverAt === null || folder.coverAt > parent.coverAt)) { parent.cover = folder.cover; parent.coverAt = folder.coverAt; }
  }
  const update = db.prepare('UPDATE folders SET direct_media_count=?,media_count=?,child_count=?,cover_file_id=?,latest_at=? WHERE path=?');
  for (let offset = 0; offset < folders.length; offset += 256) {
    signal?.throwIfAborted();
    db.transaction(() => {
      assertLease();
      for (const folder of folders.slice(offset, offset + 256)) update.run(folder.direct, folder.total, folder.children, folder.cover, folder.latest, folder.path);
    }).immediate();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
