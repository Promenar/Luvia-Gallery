import type Database from 'better-sqlite3';
import { opendir, stat, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { lookup } from 'mime-types';
import { mediaId, virtualPath } from '../core/paths.ts';
import { statFields } from '../watch/file-info.ts';
import { readSettings } from '../core/settings.ts';
import { cleanupDeletedMediaCache } from './cache-prune.ts';
import { moveDirectoryPaths } from '../core/directory-move.ts';
import { confirmLibraryMount } from '../watch/root-guard.ts';

type Options = {
  allowedRoots: string[]; openDir?: typeof opendir; signal?: AbortSignal;
  batchSize?: number; statConcurrency?: number; owner?: string; jobId?: string; jobLeaseToken?: string; clock?: () => number; cacheDir?: string;
  mount?: (root: string) => Promise<string | null>;
};
type Candidate = { relative: string; size: number; mtime: number; mtimeMs: number; dev: string; ino: string; movedId: string | null; fromPath?: string };
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
function parentOfDirectory(relative: string): string { const parent = path.posix.dirname(relative); return parent === '.' ? '' : parent; }
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
  const initialMount = await confirmLibraryMount(db, library, { ...options, assertLease });
  if (!initialMount.available) {
    db.prepare('INSERT OR IGNORE INTO library_watch_state(library_id) VALUES (?)').run(library.id);
    db.prepare("UPDATE library_watch_state SET state='degraded',degraded_reason=? WHERE library_id=?").run(initialMount.reason, library.id);
    throw new Error(initialMount.reason ?? '媒体库挂载身份未确认');
  }
  const checkMount = async () => {
    const current = await confirmLibraryMount(db, library, { ...options, allowChange: false });
    return current.available && current.identity === initialMount.identity;
  };
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
      let previous = db.prepare('SELECT * FROM scan_runs WHERE job_id=?').get(jobId) as ScanRun | undefined;
      const active = db.prepare('SELECT marker FROM scan_current_markers WHERE library_id=?').get(library.id) as { marker: string } | undefined;
      if (previous && (!active || previous.marker !== active.marker) && !previous.complete) {
        db.prepare('DELETE FROM scan_event_restored WHERE job_id=?').run(jobId);
        db.prepare('DELETE FROM scan_event_counts WHERE job_id=?').run(jobId);
        db.prepare('DELETE FROM scan_event_folders WHERE job_id=?').run(jobId);
        db.prepare('DELETE FROM scan_runs WHERE job_id=?').run(jobId); previous = undefined;
      }
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
    db.prepare('INSERT INTO scan_current_markers(library_id,marker) VALUES (?,?) ON CONFLICT(library_id) DO UPDATE SET marker=excluded.marker').run(library.id, marker);
    db.prepare('DELETE FROM scan_conflicts WHERE library_id=? AND marker<>?').run(library.id, marker);
    db.prepare('DELETE FROM scan_change_directories WHERE library_id=? AND marker<>?').run(library.id, marker);
    db.prepare('DELETE FROM library_changes WHERE ts<?').run((options.clock ? options.clock() * 1000 : Date.now()) - 30 * 86_400_000);
  }).immediate();
  const queue: string[] = [''];
  let batch: Candidate[] = [];
  let pending: Promise<void>[] = [];
  const existing = db.prepare('SELECT id FROM files WHERE id=?');
  const existingPath = db.prepare('SELECT id,dev,ino,missing_at_ms FROM files WHERE library_id=? AND relative_path=?');
  const sidecar = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_watch_index'").get();
  const identity = db.prepare(sidecar
    ? 'SELECT f.id,f.relative_path FROM file_watch_index w JOIN files f ON f.id=w.file_id WHERE w.library_id=? AND w.dev=? AND w.ino=? LIMIT 2'
    : 'SELECT id,relative_path FROM files WHERE library_id=? AND dev=? AND ino=? LIMIT 2');
  const folderIdentity = db.prepare(sidecar
    ? 'SELECT f.path,f.missing_at_ms FROM folder_watch_index w JOIN folders f ON f.path=w.folder_path WHERE w.library_id=? AND w.dev=? AND w.ino=? LIMIT 2'
    : 'SELECT path,missing_at_ms FROM folders WHERE library_id=? AND dev=? AND ino=? LIMIT 2');
  const grace = readSettings(db).libraries.missingGraceDays * 86_400_000;
  const scanNow = () => options.clock ? options.clock() * 1000 : Date.now();
  const insertChange = db.prepare('INSERT INTO library_changes(library_id,ts,kind,path,from_path,is_dir,media_id,source) VALUES (?,?,?,?,?,?,?,\'scan\')');
  const eventCount = jobId ? db.prepare(`INSERT INTO scan_event_counts(job_id,added,removed,updated,moved) VALUES (?,?,?,?,?)
    ON CONFLICT(job_id) DO UPDATE SET added=added+excluded.added,removed=removed+excluded.removed,updated=updated+excluded.updated,moved=moved+excluded.moved`) : null;
  const eventFolder = jobId ? db.prepare('INSERT OR IGNORE INTO scan_event_folders(job_id,path) VALUES (?,?)') : null;
  const countChange = (kind: 'added' | 'updated' | 'moved' | 'missing' | 'restored' | 'removed', relative: string, from: string | null, isDir: boolean) => {
    if (!jobId) return;
    eventFolder!.run(jobId, virtualPath(library.id, isDir ? relative : parentOfDirectory(relative)));
    if (from !== null) eventFolder!.run(jobId, virtualPath(library.id, isDir ? from : parentOfDirectory(from)));
    if (isDir) return;
    eventCount!.run(jobId, Number(kind === 'added' || kind === 'restored'), Number(kind === 'missing'), Number(kind === 'updated'), Number(kind === 'moved'));
  };
  const logChange = (kind: 'added' | 'updated' | 'moved' | 'missing' | 'restored' | 'removed', relative: string, from: string | null, isDir: boolean, id: string | null) => {
    insertChange.run(library.id, scanNow(), kind, relative, from, isDir ? 1 : 0, id);
    countChange(kind, relative, from, isDir);
  };
  const changedDirectory = db.prepare('SELECT 1 FROM scan_change_directories WHERE library_id=? AND marker=? AND relative_path=?');
  const hasChangedAncestor = (relative: string): boolean => {
    let current = relative;
    while (current) {
      if (changedDirectory.get(library.id, marker, current)) return true;
      current = parentOfDirectory(current);
    }
    return false;
  };
  const missingFolder = db.prepare('SELECT 1 FROM folders WHERE path=? AND missing_at_ms IS NOT NULL');
  const removeFile = (id: string) => {
    db.prepare("DELETE FROM favorites WHERE item_type='file' AND item_id=?").run(id);
    db.prepare('UPDATE albums SET cover_id=NULL WHERE cover_id=?').run(id);
    db.prepare(`INSERT OR REPLACE INTO cache_gc(cache_key,relative_path) SELECT cache_key,relative_path FROM cache_entries
      WHERE media_id=? AND (variant IS NULL OR variant<>'hls')`).run(id);
    db.prepare('DELETE FROM cache_entries WHERE media_id=? OR hls_session_id IN (SELECT id FROM hls_sessions WHERE media_id=?)').run(id, id);
    db.prepare('DELETE FROM files WHERE id=?').run(id);
  };
  const isExpired = (at: number | null) => at !== null && (grace === 0 || scanNow() > at + grace);
  const expiryChange = (relative: string, isDir: boolean, id: string | null) => {
    let folder = isDir ? relative : parentOfDirectory(relative); let ancestor: string | null = null;
    while (folder) {
      const row = db.prepare('SELECT missing_at_ms,scan_marker FROM folders WHERE library_id=? AND path=?').get(library.id, virtualPath(library.id, folder)) as { missing_at_ms: number | null; scan_marker: string | null } | undefined;
      if (!row || row.scan_marker === marker || !isExpired(row.missing_at_ms)) break;
      ancestor = folder; folder = parentOfDirectory(folder);
    }
    if (!ancestor) { logChange('removed', relative, null, isDir, id); return; }
    if (db.prepare('INSERT OR IGNORE INTO scan_expiry_logged(library_id,path) VALUES (?,?)').run(library.id, ancestor).changes) logChange('removed', ancestor, null, true, null);
  };
  const changedContent = '(files.size != excluded.size OR files.modified_at != excluded.modified_at OR (files.mtime_ms IS NOT NULL AND files.mtime_ms != excluded.mtime_ms))';
  const resetMetadata = ['orientation','duration_sec','codec','audio_codec','container','fps','bitrate','make','model','lens','f_number','exposure_time','iso','focal_length','focal_length35','software','latitude','longitude','altitude','playability']
    .map((column) => `${column}=CASE WHEN ${changedContent} THEN NULL ELSE files.${column} END`).join(',');
  const upsert = db.prepare(`INSERT INTO files
    (id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,scan_marker,dev,ino,mtime_ms)
    VALUES (@id,@library_id,@relative_path,@folder,@name,@mime,@media_type,@size,@mtime,@mtime,'mtime',@marker,@dev,@ino,@mtime_ms)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, relative_path=excluded.relative_path, folder=excluded.folder, mime=excluded.mime, media_type=excluded.media_type,
      taken_at=CASE WHEN ${changedContent} THEN excluded.modified_at ELSE files.taken_at END,
      taken_at_source=CASE WHEN ${changedContent} THEN 'mtime' ELSE files.taken_at_source END,
      metadata_status=CASE WHEN ${changedContent} THEN 'pending' ELSE files.metadata_status END,
      thumb_version=CASE WHEN ${changedContent} AND files.thumb_version>0 THEN files.thumb_version + 1 ELSE files.thumb_version END,
      cache_generation=CASE WHEN ${changedContent} THEN files.cache_generation+1 ELSE files.cache_generation END,
      thumb_ready=CASE WHEN ${changedContent} THEN 0 ELSE files.thumb_ready END,
      thumbhash=CASE WHEN ${changedContent} THEN NULL ELSE files.thumbhash END,
      width=CASE WHEN ${changedContent} THEN NULL ELSE files.width END,
      height=CASE WHEN ${changedContent} THEN NULL ELSE files.height END,
      ${resetMetadata},
      has_preview=CASE WHEN ${changedContent} THEN 0 ELSE files.has_preview END,
      head_hash=CASE WHEN ${changedContent} THEN NULL ELSE files.head_hash END,
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
        if (!allowDefer && byPath && isExpired(byPath.missing_at_ms)) {
          expiryChange(file.relative, false, byPath.id);
          removeFile(byPath.id); result.removed++; if (moved?.id === byPath.id) moved = undefined; byPath = undefined;
        }
        if (!allowDefer && moved && isExpired(moved.missing_at_ms)) {
          const old = db.prepare('SELECT relative_path FROM files WHERE id=?').get(moved.id) as { relative_path: string };
          expiryChange(file.fromPath ?? old.relative_path, false, moved.id);
          removeFile(moved.id); result.removed++; moved = undefined;
        }
        const preferred = mediaId(library.id, file.relative);
        const id = byPath?.id ?? moved?.id ?? (existing.get(preferred) ? randomUUID() : preferred);
        const kind = typeOf(file.relative)!;
        const dirname = path.posix.dirname(file.relative);
        const before = db.prepare('SELECT relative_path,size,modified_at,mtime_ms,missing_at_ms FROM files WHERE id=?').get(id) as { relative_path: string; size: number; modified_at: number; mtime_ms: number | null; missing_at_ms: number | null } | undefined;
        if (!before) result.added++;
        upsert.run({ id, library_id: library.id, relative_path: file.relative, folder: virtualPath(library.id, dirname === '.' ? '' : dirname),
          name: path.posix.basename(file.relative), mime: lookup(file.relative) || 'application/octet-stream', media_type: kind,
          size: file.size, mtime: file.mtime, marker, dev: file.dev, ino: file.ino, mtime_ms: file.mtimeMs });
        {
          const suppressed = hasChangedAncestor(parentOfDirectory(file.relative));
          const emit = (kind: 'added' | 'updated' | 'moved' | 'restored', from: string | null) => {
            if (suppressed) countChange(kind, file.relative, from, false);
            else logChange(kind, file.relative, from, false, id);
          };
          const oldPath = file.fromPath ?? before?.relative_path;
          if (!before) emit('added', null);
          else {
            if (before.missing_at_ms !== null) emit('restored', null);
            if (oldPath !== file.relative) emit('moved', oldPath ?? null);
            else if (before.missing_at_ms === null && (before.size !== file.size || before.modified_at !== file.mtime || before.mtime_ms !== null && before.mtime_ms !== file.mtimeMs)) emit('updated', null);
          }
        }
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
    let dirMoved = false;
    try {
      const resolved = await realpath(dir);
      if (!within(root, resolved)) throw new Error('目录越出媒体库');
      dirInfo = statFields(await stat(resolved, { bigint: true }));
      if (relativeDir) {
        const target = virtualPath(library.id, relativeDir);
        const present = db.prepare('SELECT dev,ino FROM folders WHERE path=? AND library_id=?').get(target, library.id) as { dev: string | null; ino: string | null } | undefined;
        if (present?.dev && present.ino && (present.dev !== dirInfo.dev || present.ino !== dirInfo.ino)) throw new Error('目录身份发生冲突');
        const candidates = folderIdentity.all(library.id, dirInfo.dev, dirInfo.ino) as { path: string; missing_at_ms: number | null }[];
        if (!present && candidates.length === 1 && candidates[0]!.path !== target && !isExpired(candidates[0]!.missing_at_ms)) {
          const previous = candidates[0]!; const oldRelative = previous.path.slice(library.id.length + 1);
          let oldStillPresent = false;
          try { const old = await lstat(path.join(root, oldRelative), { bigint: true }); oldStillPresent = old.dev.toString() === dirInfo.dev && old.ino.toString() === dirInfo.ino; }
          catch (error) { if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
          if (!oldStillPresent) db.transaction(() => {
            assertLease();
            const current = db.prepare('SELECT dev,ino,missing_at_ms FROM folders WHERE path=? AND library_id=?').get(previous.path, library.id) as { dev: string | null; ino: string | null; missing_at_ms: number | null } | undefined;
            if (!current || current.dev !== dirInfo!.dev || current.ino !== dirInfo!.ino || current.missing_at_ms !== previous.missing_at_ms || db.prepare('SELECT 1 FROM folders WHERE path=?').get(target)) throw new Error('目录索引已变化');
            if (jobId) {
              db.prepare(`INSERT OR IGNORE INTO scan_event_folders(job_id,path) SELECT ?,path FROM folders
                WHERE library_id=? AND (path=? OR (path>=? AND path<?))`).run(jobId, library.id, previous.path, `${previous.path}/`, `${previous.path}0`);
              db.prepare(`INSERT OR IGNORE INTO scan_event_folders(job_id,path) SELECT ?,? || substr(path,length(?)+1) FROM folders
                WHERE library_id=? AND (path=? OR (path>=? AND path<?))`).run(jobId, target, previous.path, library.id, previous.path, `${previous.path}/`, `${previous.path}0`);
            }
            moveDirectoryPaths(db, library.id, oldRelative, relativeDir, virtualPath(library.id, parentOfDirectory(relativeDir)));
            if (!hasChangedAncestor(parentOfDirectory(relativeDir))) {
              if (previous.missing_at_ms !== null) logChange('restored', relativeDir, null, true, null);
              logChange('moved', relativeDir, oldRelative, true, null);
              db.prepare('INSERT OR IGNORE INTO scan_change_directories(library_id,marker,relative_path) VALUES (?,?,?)').run(library.id, marker, relativeDir);
            }
            dirMoved = true;
          }).immediate();
        }
      }
      const opened = await openDir(resolved);
      try { db.transaction(() => {
        assertLease();
        const folderPath = virtualPath(library.id, relativeDir);
        const parent = relativeDir ? virtualPath(library.id, parentOfDirectory(relativeDir)) : null;
        const previous = db.prepare('SELECT missing_at_ms FROM folders WHERE path=?').get(folderPath) as { missing_at_ms: number | null } | undefined;
        if (!previous || previous.missing_at_ms !== null) db.prepare('DELETE FROM scan_expiry_logged WHERE library_id=? AND path=?').run(library.id, relativeDir);
        db.prepare(`INSERT INTO folders(path,library_id,parent,name,scan_marker,dev,ino,mtime_ms) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(path) DO UPDATE SET parent=excluded.parent,name=excluded.name,scan_marker=excluded.scan_marker,
            dev=excluded.dev,ino=excluded.ino,mtime_ms=excluded.mtime_ms,missing_at_ms=NULL`)
          .run(folderPath, library.id, parent, relativeDir ? path.posix.basename(relativeDir) : libraryRow.name, marker, dirInfo!.dev, dirInfo!.ino, dirInfo!.mtimeMs);
        if (relativeDir && !dirMoved && (!previous || previous.missing_at_ms !== null) && !changedDirectory.get(library.id, marker, relativeDir) && !hasChangedAncestor(parentOfDirectory(relativeDir))) {
          logChange(previous ? 'restored' : 'added', relativeDir, null, true, null);
          db.prepare('INSERT OR IGNORE INTO scan_change_directories(library_id,marker,relative_path) VALUES (?,?,?)').run(library.id, marker, relativeDir);
        }
      }).immediate(); } catch (error) { if ('close' in opened && typeof opened.close === 'function') await opened.close().catch(() => {}); throw error; }
      for await (const entry of opened) {
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
      return finalRoot === root && finalIdentity.dev === rootIdentity.dev && finalIdentity.ino === rootIdentity.ino && await checkMount();
    } catch { return false; }
  };
  if (result.errors === 0 && !(await rootAvailable())) result.errors++;
  while (result.errors === 0) {
    signal?.throwIfAborted();
    const conflicts = db.prepare(`SELECT relative_path AS relative,size,mtime,mtime_ms AS mtimeMs,dev,ino,moved_id AS movedId
      FROM scan_conflicts WHERE library_id=? AND marker=? ORDER BY relative_path LIMIT ?`).all(library.id, marker, batchSize) as Candidate[];
    if (!conflicts.length) break;
    if (!(await rootAvailable())) { result.errors++; break; }
    const first = conflicts[0]!;
    const occupant = existingPath.get(library.id, first.relative) as { id: string; dev: string | null; ino: string | null } | undefined;
    if (first.movedId) {
      const component: Candidate[] = []; const visited = new Set<string>(); let current: Candidate | undefined = first;
      while (current?.movedId && !visited.has(current.movedId)) {
        visited.add(current.movedId); component.push(current);
        const destination = existingPath.get(library.id, current.relative) as { id: string } | undefined;
        if (!destination || destination.id === current.movedId) break;
        const next = db.prepare(`SELECT relative_path AS relative,size,mtime,mtime_ms AS mtimeMs,dev,ino,moved_id AS movedId
          FROM scan_conflicts WHERE library_id=? AND marker=? AND moved_id=? LIMIT 2`).all(library.id, marker, destination.id) as Candidate[];
        if (next.length !== 1) { result.errors++; break; }
        current = next[0];
      }
      if (result.errors) break;
      const staged = `__luvia_scan_${randomUUID()}`;
      db.transaction(() => {
        assertLease();
        for (const [index, item] of component.entries()) {
          item.fromPath = (db.prepare('SELECT relative_path FROM files WHERE id=? AND library_id=?').get(item.movedId, library.id) as { relative_path: string } | undefined)?.relative_path;
          const changed = db.prepare('UPDATE files SET relative_path=? WHERE id=? AND library_id=? AND dev=? AND ino=? AND (scan_marker IS NULL OR scan_marker<>?)')
            .run(`${staged}/${index}`, item.movedId, library.id, item.dev, item.ino, marker);
          if (!changed.changes) throw new Error('扫描期间媒体身份发生变化');
        }
        for (const item of component) { batch = [item]; flush(false); }
      }).immediate();
    } else {
      if (occupant?.dev && occupant.ino && (occupant.dev !== first.dev || occupant.ino !== first.ino)) { result.errors++; break; }
      batch = [first]; flush(false);
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  if (result.errors === 0) {
    const nowMs = scanNow();
    const expired = db.prepare(`SELECT id,relative_path,folder FROM files WHERE library_id=? AND (scan_marker IS NULL OR scan_marker<>?)
      AND missing_at_ms IS NOT NULL AND ${grace === 0 ? 'missing_at_ms<=?' : 'missing_at_ms<?'} LIMIT 256`);
    let count: number;
    do {
      signal?.throwIfAborted();
      if (!(await rootAvailable())) { result.errors++; break; }
      count = db.transaction(() => {
        assertLease();
        const rows = expired.all(library.id, marker, nowMs - grace) as { id: string; relative_path: string; folder: string }[];
        for (const row of rows) { expiryChange(row.relative_path, false, row.id); removeFile(row.id); }
        result.removed += rows.length;
        if (jobId) db.prepare('UPDATE scan_runs SET removed=? WHERE job_id=?').run(result.removed, jobId);
        return rows.length;
      }).immediate();
      if (count) await new Promise<void>((resolve) => setImmediate(resolve));
    } while (count);
    const expiredFolders = db.prepare(`SELECT path,parent FROM folders WHERE library_id=? AND (scan_marker IS NULL OR scan_marker<>?)
      AND missing_at_ms IS NOT NULL AND ${grace === 0 ? 'missing_at_ms<=?' : 'missing_at_ms<?'}
      AND NOT EXISTS (SELECT 1 FROM files child_file WHERE child_file.folder=folders.path)
      AND NOT EXISTS (SELECT 1 FROM folders child_folder WHERE child_folder.parent=folders.path) ORDER BY length(path) DESC LIMIT 256`);
    while (result.errors === 0) {
      signal?.throwIfAborted(); if (!(await rootAvailable())) { result.errors++; break; }
      count = db.transaction(() => {
        assertLease(); const stale = expiredFolders.all(library.id, marker, nowMs - grace) as { path: string; parent: string | null }[];
        for (const { path: folder, parent } of stale) {
          expiryChange(folder.slice(library.id.length + 1), true, null);
          db.prepare("DELETE FROM favorites WHERE item_type='folder' AND item_id=?").run(folder);
          db.prepare('DELETE FROM folders WHERE path=?').run(folder);
          db.prepare('DELETE FROM scan_expiry_logged WHERE library_id=? AND path=?').run(library.id, folder.slice(library.id.length + 1));
        }
        return stale.length;
      }).immediate();
      if (!count) break; await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const markFolders = db.prepare(`SELECT path,parent FROM folders WHERE library_id=? AND (scan_marker IS NULL OR scan_marker<>?)
      AND missing_at_ms IS NULL ORDER BY length(path),path LIMIT 256`);
    while (result.errors === 0) {
      signal?.throwIfAborted(); if (!(await rootAvailable())) { result.errors++; break; }
      count = db.transaction(() => {
        assertLease(); const rows = markFolders.all(library.id, marker) as { path: string; parent: string | null }[];
        for (const row of rows) {
          if (!row.parent || !missingFolder.get(row.parent)) logChange('missing', row.path.slice(library.id.length + 1), null, true, null);
          db.prepare('UPDATE folders SET missing_at_ms=? WHERE path=? AND missing_at_ms IS NULL').run(nowMs, row.path);
        }
        return rows.length;
      }).immediate();
      if (!count) break; await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const markFiles = db.prepare(`SELECT id,relative_path,folder FROM files WHERE library_id=?
      AND (scan_marker IS NULL OR scan_marker<>?) AND missing_at_ms IS NULL LIMIT 256`);
    while (result.errors === 0) {
      signal?.throwIfAborted(); if (!(await rootAvailable())) { result.errors++; break; }
      count = db.transaction(() => {
        assertLease(); const rows = markFiles.all(library.id, marker) as { id: string; relative_path: string; folder: string }[];
        for (const row of rows) {
          if (!missingFolder.get(row.folder)) logChange('missing', row.relative_path, null, false, row.id);
          else countChange('missing', row.relative_path, null, false);
          db.prepare('UPDATE files SET missing_at_ms=? WHERE id=? AND missing_at_ms IS NULL').run(nowMs, row.id);
        }
        return rows.length;
      }).immediate();
      if (!count) break; await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  await materializeFolders(db, library.id, assertLease, signal);
  if (options.cacheDir) await cleanupDeletedMediaCache(db, options.cacheDir, { owner: options.owner ?? 'scan-cache-cleanup', signal, assertLease });
  if (jobId) db.transaction(() => {
    assertLease();
    db.prepare('UPDATE scan_runs SET complete=1 WHERE job_id=?').run(jobId);
  }).immediate();
  db.prepare('DELETE FROM scan_change_directories WHERE library_id=? AND marker=?').run(library.id, marker);
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
    if (folder.coverAt !== null && (parent.coverAt === null || folder.coverAt > parent.coverAt ||
      (folder.coverAt === parent.coverAt && folder.cover !== null && (parent.cover === null || folder.cover < parent.cover)))) {
      parent.cover = folder.cover; parent.coverAt = folder.coverAt;
    }
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
