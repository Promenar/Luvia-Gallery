import type Database from 'better-sqlite3';
import { opendir, stat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lookup } from 'mime-types';
import { mediaId, virtualPath } from '../core/paths.ts';

type Options = {
  allowedRoots: string[]; openDir?: typeof opendir; signal?: AbortSignal;
  batchSize?: number; statConcurrency?: number; owner?: string; jobId?: string; clock?: () => number;
};
type Candidate = { relative: string; size: number; mtime: number };
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
  const clock = options.clock ?? (() => Math.floor(Date.now() / 1000));
  const at = clock();
  const locked = db.prepare(`INSERT INTO scan_locks(library_id,owner,acquired_at,heartbeat_at,lease_expires_at)
    VALUES (?,?,?,?,?) ON CONFLICT(library_id) DO UPDATE SET owner=excluded.owner, acquired_at=excluded.acquired_at,
    heartbeat_at=excluded.heartbeat_at, lease_expires_at=excluded.lease_expires_at
    WHERE scan_locks.lease_expires_at<=?`).run(library.id, owner, at, at, at + 30, at);
  if (!locked.changes) throw new Error('媒体库正在扫描');
  let lost = false;
  const assertLease = () => {
    if (lost) throw new LeaseLost();
    const at = clock();
    const lock = db.prepare('SELECT 1 FROM scan_locks WHERE library_id=? AND owner=? AND lease_expires_at>?').get(library.id, owner, at);
    const job = !options.jobId || db.prepare("SELECT 1 FROM jobs WHERE id=? AND status='running' AND owner=? AND lease_expires_at>?").get(options.jobId, owner, at);
    if (!lock || !job) throw new LeaseLost();
  };
  const timer = setInterval(() => {
    try {
      const at = clock();
      const result = db.prepare('UPDATE scan_locks SET heartbeat_at=?,lease_expires_at=? WHERE library_id=? AND owner=? AND lease_expires_at>?')
        .run(at, at + 30, library.id, owner, at);
      if (!result.changes) lost = true;
    } catch { lost = true; }
  }, 5000);
  timer.unref();
  try { return await scanWithLock(db, library, options, assertLease); }
  finally {
    clearInterval(timer);
    db.prepare('DELETE FROM scan_locks WHERE library_id=? AND owner=?').run(library.id, owner);
  }
}

async function scanWithLock(db: Database.Database, library: { id: string; root: string }, options: Options, assertLease: () => void): Promise<ScanResult> {
  const signal = options.signal;
  signal?.throwIfAborted();
  const openDir = options.openDir ?? opendir;
  const batchSize = Math.max(1, Math.min(1000, options.batchSize ?? 256));
  const concurrency = Math.max(1, Math.min(32, options.statConcurrency ?? 8));
  const root = await realpath(library.root);
  const allowedRoots = await Promise.all(options.allowedRoots.map((allowed) => realpath(allowed)));
  if (!allowedRoots.some((allowed) => within(allowed, root))) throw new Error('扫描路径不在允许的挂载根目录内');
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
  const queue: string[] = [''];
  let batch: Candidate[] = [];
  let pending: Promise<void>[] = [];
  const existing = db.prepare('SELECT id FROM files WHERE id=?');
  const upsert = db.prepare(`INSERT INTO files
    (id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,scan_marker)
    VALUES (@id,@library_id,@relative_path,@folder,@name,@mime,@media_type,@size,@mtime,@mtime,'mtime',@marker)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, folder=excluded.folder, mime=excluded.mime, media_type=excluded.media_type,
      taken_at=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN excluded.modified_at ELSE files.taken_at END,
      taken_at_source=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN 'mtime' ELSE files.taken_at_source END,
      metadata_status=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN 'pending' ELSE files.metadata_status END,
      has_preview=CASE WHEN files.size != excluded.size OR files.modified_at != excluded.modified_at THEN 0 ELSE files.has_preview END,
      size=excluded.size, modified_at=excluded.modified_at, scan_marker=excluded.scan_marker`);
  const flush = () => {
    if (!batch.length) return;
    const current = batch; batch = [];
    db.transaction(() => {
      assertLease();
      for (const file of current) {
        const id = mediaId(library.id, file.relative);
        const kind = typeOf(file.relative)!;
        const dirname = path.posix.dirname(file.relative);
        if (!existing.get(id)) result.added++;
        upsert.run({ id, library_id: library.id, relative_path: file.relative, folder: virtualPath(library.id, dirname === '.' ? '' : dirname),
          name: path.posix.basename(file.relative), mime: lookup(file.relative) || 'application/octet-stream', media_type: kind,
          size: file.size, mtime: file.mtime, marker });
      }
      if (jobId) db.prepare('UPDATE scan_runs SET added=? WHERE job_id=?').run(result.added, jobId);
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
    try {
      const resolved = await realpath(dir);
      if (!within(root, resolved)) throw new Error('目录越出媒体库');
      for await (const entry of await openDir(resolved)) {
        signal?.throwIfAborted();
        const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) children.push(relative);
        else if (entry.isFile() && typeOf(relative)) {
          const full = path.join(root, relative);
          pending.push((async () => {
            try {
              const resolvedFile = await realpath(full);
              if (!within(root, resolvedFile)) throw new Error('文件越出媒体库');
              const info = await stat(resolvedFile);
              if (info.isFile()) batch.push({ relative, size: info.size, mtime: Math.floor(info.mtimeMs / 1000) });
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
      result.errors++;
    }
    await Promise.all(pending); pending = [];
    signal?.throwIfAborted();
    flush();
    if (jobId) {
      db.transaction(() => {
        assertLease();
        const insert = db.prepare('INSERT OR IGNORE INTO scan_directories(job_id,relative_path) VALUES (?,?)');
        for (const child of children) insert.run(jobId, child);
        db.prepare('UPDATE scan_directories SET done=1 WHERE job_id=? AND relative_path=?').run(jobId, relativeDir);
        db.prepare('UPDATE scan_runs SET errors=? WHERE job_id=?').run(result.errors, jobId);
      }).immediate();
    } else queue.push(...children);
  }
  if (result.errors === 0) {
    const remove = db.prepare(`DELETE FROM files WHERE rowid IN
      (SELECT rowid FROM files WHERE library_id=? AND (scan_marker IS NULL OR scan_marker<>?) LIMIT 256)`);
    let count: number;
    do {
      signal?.throwIfAborted();
      count = db.transaction(() => {
        assertLease();
        const changes = Number(remove.run(library.id, marker).changes);
        result.removed += changes;
        if (jobId) db.prepare('UPDATE scan_runs SET removed=? WHERE job_id=?').run(result.removed, jobId);
        return changes;
      }).immediate();
      if (count) await new Promise<void>((resolve) => setImmediate(resolve));
    } while (count);
  }
  if (jobId) db.transaction(() => {
    assertLease();
    db.prepare('UPDATE scan_runs SET complete=1 WHERE job_id=?').run(jobId);
  }).immediate();
  return result;
}
