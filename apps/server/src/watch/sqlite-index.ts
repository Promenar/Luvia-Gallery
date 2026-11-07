import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { lookup } from 'mime-types';
import type { LibraryChangedEvent } from '@luvia/contracts';
import { mediaId, virtualPath } from '../core/paths.ts';
import { appendLibraryChange } from '../core/library-changes.ts';
import { moveDirectoryPaths } from '../core/directory-move.ts';
import type { IndexedRecord, LibraryIndexPort, WatchLibraryChange } from './coordinator.ts';
import type { MoveCandidate } from './move-matcher.ts';
import { statFields } from './file-info.ts';
import { ScanLockedError } from './scan-lock-error.ts';

type Options = {
  libraryId: string;
  requestFullReconcile: (reason: string) => Promise<void>;
  publishEvent: (event: LibraryChangedEvent, channel?: 'folder-time') => Promise<void>;
  now?: () => number;
  assertLease?: () => void;
};
type FileRow = { id: string; relative_path: string; size: number; modified_at: number; mtime_ms: number | null; dev: string | null; ino: string | null; head_hash: string | null; missing_at_ms: number | null };
type FolderRow = { path: string; mtime_ms: number | null; dev: string | null; ino: string | null; missing_at_ms: number | null };
type Pending = { kinds: WatchLibraryChange['kind'][]; oldPath: string | null; path: string; isDir: boolean; mediaId: string | null };
const fileExt = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.heic','.heif','.tif','.tiff','.bmp']);
const videoExt = new Set(['.mp4','.m4v','.mkv','.mov','.webm','.avi','.wmv','.mpeg','.mpg']);
function mediaType(relative: string): 'image' | 'video' | 'audio' {
  const ext = path.posix.extname(relative).toLowerCase();
  return fileExt.has(ext) ? 'image' : videoExt.has(ext) ? 'video' : 'audio';
}

function parentOf(relative: string): string { const parent = path.posix.dirname(relative); return parent === '.' ? '' : parent; }
function identity(value: string | number | null): string | null { return value === null ? null : String(value); }
function contentChanged(old: IndexedRecord, entry: MoveCandidate): boolean {
  return old.size !== entry.size || old.mtimeMs !== entry.mtimeMs || !!(old.headHash && entry.headHash && old.headHash !== entry.headHash);
}
function fileRecord(row: FileRow): IndexedRecord {
  return { path: row.relative_path, isDir: false, mediaId: row.id, size: row.size, mtimeMs: row.mtime_ms ?? row.modified_at * 1000,
    dev: row.dev, ino: row.ino, headHash: row.head_hash, missingAt: row.missing_at_ms };
}

/** 每个端口独占一个数据库连接；write 与紧随其后的 appendChange 共享事务。 */
export class SqliteLibraryIndex implements LibraryIndexPort {
  private pending: Pending | null = null;
  private duplicate: WatchLibraryChange | null = null;
  private readonly libraryId: string;
  private readonly sidecar: boolean;
  private readonly db: Database.Database;
  private readonly options: Options;
  constructor(db: Database.Database, options: Options) {
    this.db = db; this.options = options;
    this.libraryId = options.libraryId;
    virtualPath(this.libraryId, '');
    if (db.inTransaction) throw new Error('索引端口需要独占的数据库连接');
    this.sidecar = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_watch_index'").get();
  }
  private file(row: FileRow): IndexedRecord { return fileRecord(row); }
  private folder(row: FolderRow): IndexedRecord {
    const value = row.path === this.libraryId ? '' : row.path.slice(this.libraryId.length + 1);
    return { path: value, isDir: true, mediaId: null, size: 0, mtimeMs: row.mtime_ms ?? 0,
      dev: row.dev, ino: row.ino, headHash: null, missingAt: row.missing_at_ms };
  }
  async readDirectory(directory: string): Promise<IndexedRecord[]> {
    const parent = virtualPath(this.libraryId, directory);
    const folders = this.db.prepare('SELECT path,dev,ino,mtime_ms,missing_at_ms FROM folders WHERE library_id=? AND parent=?').all(this.libraryId, parent) as FolderRow[];
    const files = this.db.prepare('SELECT id,relative_path,size,modified_at,mtime_ms,dev,ino,head_hash,missing_at_ms FROM files WHERE library_id=? AND folder=?').all(this.libraryId, parent) as FileRow[];
    return [...folders.map((row) => this.folder(row)), ...files.map((row) => this.file(row))];
  }
  async readSubdirectories(directory: string): Promise<string[]> {
    const virtual = virtualPath(this.libraryId, directory);
    return (this.db.prepare('SELECT path FROM folders WHERE library_id=? AND path>=? AND path<?').all(this.libraryId, `${virtual}/`, `${virtual}0`) as {path:string}[])
      .map((row) => row.path.slice(this.libraryId.length + 1));
  }
  async writeDirectoryMtime(entry: MoveCandidate): Promise<boolean> {
    if (!entry.isDir) throw new Error('目录时间更新目标无效');
    if (this.pending || this.db.inTransaction) throw new Error('索引端口已有未提交事务');
    const folderPath = virtualPath(this.libraryId, entry.path);
    const current = this.db.prepare('SELECT mtime_ms,dev,ino FROM folders WHERE path=? AND library_id=? AND missing_at_ms IS NULL')
      .get(folderPath, this.libraryId) as { mtime_ms: number | null; dev: string | null; ino: string | null } | undefined;
    if (!current || current.mtime_ms === entry.mtimeMs || (current.dev !== null && current.dev !== identity(entry.dev)) || (current.ino !== null && current.ino !== identity(entry.ino))) return false;
    return this.db.transaction(() => {
      this.options.assertLease?.();
      if (this.db.prepare('SELECT 1 FROM scan_locks WHERE library_id=? AND lease_expires_at>unixepoch()').get(this.libraryId)) throw new ScanLockedError();
      return this.db.prepare(`UPDATE folders SET mtime_ms=?,dev=COALESCE(dev,?),ino=COALESCE(ino,?)
        WHERE path=? AND library_id=? AND missing_at_ms IS NULL AND (mtime_ms IS NULL OR mtime_ms<>?)
        AND (dev IS NULL OR dev=?) AND (ino IS NULL OR ino=?)`)
        .run(entry.mtimeMs, identity(entry.dev), identity(entry.ino), folderPath, this.libraryId,
          entry.mtimeMs, identity(entry.dev), identity(entry.ino)).changes > 0;
    }).immediate();
  }
  async findMissingCandidates(candidate: MoveCandidate): Promise<IndexedRecord[]> {
    const values = new Map<string, IndexedRecord>();
    const dev = identity(candidate.dev); const ino = identity(candidate.ino);
    if (candidate.isDir) {
      if (dev && ino && dev !== '0' && ino !== '0') {
        const query = this.sidecar
          ? `SELECT f.path,f.dev,f.ino,f.mtime_ms,f.missing_at_ms FROM folder_watch_index w JOIN folders f ON f.path=w.folder_path
              WHERE w.library_id=? AND w.dev=? AND w.ino=? AND f.missing_at_ms IS NOT NULL`
          : `SELECT path,dev,ino,mtime_ms,missing_at_ms FROM folders WHERE library_id=? AND dev=? AND ino=? AND missing_at_ms IS NOT NULL`;
        for (const row of this.db.prepare(query).all(this.libraryId, dev, ino) as FolderRow[]) { const item = this.folder(row); values.set(item.path, item); }
      }
    } else {
      const columns = 'f.id,f.relative_path,f.size,f.modified_at,f.mtime_ms,f.dev,f.ino,f.head_hash,f.missing_at_ms';
      if (dev && ino && dev !== '0' && ino !== '0') {
        const query = this.sidecar
          ? `SELECT ${columns} FROM file_watch_index w JOIN files f ON f.id=w.file_id WHERE w.library_id=? AND w.dev=? AND w.ino=? AND f.missing_at_ms IS NOT NULL`
          : `SELECT ${columns} FROM files f WHERE f.library_id=? AND f.dev=? AND f.ino=? AND f.missing_at_ms IS NOT NULL`;
        for (const row of this.db.prepare(query).all(this.libraryId, dev, ino) as FileRow[]) { const item = this.file(row); values.set(item.path, item); }
      }
      if (candidate.headHash) {
        const query = this.sidecar
          ? `SELECT ${columns} FROM file_watch_index w JOIN files f ON f.id=w.file_id WHERE w.library_id=? AND w.size=? AND w.mtime_ms=? AND w.head_hash=? AND f.missing_at_ms IS NOT NULL`
          : `SELECT ${columns} FROM files f WHERE f.library_id=? AND f.size=? AND f.mtime_ms=? AND f.head_hash=? AND f.missing_at_ms IS NOT NULL`;
        for (const row of this.db.prepare(query).all(this.libraryId, candidate.size, candidate.mtimeMs, candidate.headHash) as FileRow[]) { const item = this.file(row); values.set(item.path, item); }
      }
    }
    return [...values.values()];
  }
  private begin(pending: Pending, work: () => void): void {
    if (this.pending || this.db.inTransaction) throw new Error('索引端口已有未提交事务');
    this.duplicate = null;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.options.assertLease?.();
      if (this.db.prepare('SELECT 1 FROM scan_locks WHERE library_id=? AND lease_expires_at>unixepoch()').get(this.libraryId)) throw new ScanLockedError();
      work(); this.pending = pending;
    }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private verify(old: IndexedRecord): void {
    const row = old.isDir
      ? this.db.prepare('SELECT path,dev,ino,mtime_ms,missing_at_ms FROM folders WHERE library_id=? AND path=?').get(this.libraryId, virtualPath(this.libraryId, old.path)) as FolderRow | undefined
      : this.db.prepare('SELECT id,relative_path,size,modified_at,mtime_ms,dev,ino,head_hash,missing_at_ms FROM files WHERE library_id=? AND id=? AND relative_path=?').get(this.libraryId, old.mediaId, old.path) as FileRow | undefined;
    if (!row) throw new Error('索引已变化');
    const current = old.isDir ? this.folder(row as FolderRow) : this.file(row as FileRow);
    if (current.path !== old.path || current.mediaId !== old.mediaId || current.missingAt !== old.missingAt || current.mtimeMs !== old.mtimeMs ||
      identity(current.dev) !== identity(old.dev) || identity(current.ino) !== identity(old.ino) ||
      (!old.isDir && (current.size !== old.size || current.headHash !== old.headHash))) throw new Error('索引已变化');
  }
  private refresh(paths: string[]): void {
    const work = new Set<string>();
    for (const initial of paths) {
      let current: string | null = initial;
      while (current) {
        work.add(current);
        current = (this.db.prepare('SELECT parent FROM folders WHERE path=?').get(current) as { parent: string | null } | undefined)?.parent ?? null;
      }
    }
    const own = this.db.prepare('SELECT count(*) AS n,max(taken_at) AS latest FROM files WHERE folder=? AND missing_at_ms IS NULL');
    const child = this.db.prepare('SELECT count(*) AS n,COALESCE(sum(media_count),0) AS total,max(latest_at) AS latest FROM folders WHERE parent=? AND missing_at_ms IS NULL');
    const cover = this.db.prepare(`SELECT id,taken_at FROM files WHERE folder=? AND missing_at_ms IS NULL AND thumb_ready=1
      UNION ALL SELECT f.id,f.taken_at FROM folders d JOIN files f ON f.id=d.cover_file_id WHERE d.parent=? AND d.missing_at_ms IS NULL AND f.missing_at_ms IS NULL AND f.thumb_ready=1
      ORDER BY taken_at DESC,id ASC LIMIT 1`);
    const update = this.db.prepare('UPDATE folders SET direct_media_count=?,media_count=?,child_count=?,latest_at=?,cover_file_id=? WHERE path=?');
    for (const folder of [...work].sort((a, b) => b.length - a.length)) {
      const a = own.get(folder) as { n: number; latest: number | null };
      const b = child.get(folder) as { n: number; total: number; latest: number | null };
      const latest = a.latest === null ? b.latest : b.latest === null ? a.latest : Math.max(a.latest, b.latest);
      const selected = cover.get(folder, folder) as { id: string } | undefined;
      update.run(a.n, a.n + b.total, b.n, latest, selected?.id ?? null, folder);
    }
  }
  async writeAdded(entry: MoveCandidate): Promise<string | null> {
    const virtual = virtualPath(this.libraryId, entry.path); const parent = virtualPath(this.libraryId, parentOf(entry.path));
    const missingParents: { relative: string; dev: string; ino: string; mtimeMs: number }[] = [];
    if (!entry.isDir) {
      const root = (this.db.prepare('SELECT root FROM libraries WHERE id=?').get(this.libraryId) as { root: string }).root;
      let relative = parentOf(entry.path);
      while (relative && !this.db.prepare('SELECT 1 FROM folders WHERE path=?').get(virtualPath(this.libraryId, relative))) {
        const info = await lstat(path.join(root, relative), { bigint: true });
        if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('媒体父目录不可用');
        const fields = statFields(info); missingParents.push({ relative, dev: fields.dev, ino: fields.ino, mtimeMs: fields.mtimeMs });
        relative = parentOf(relative);
      }
    }
    const preferred = entry.isDir ? null : mediaId(this.libraryId, entry.path);
    let id = preferred;
    const pending: Pending = { kinds: ['added'], oldPath: null, path: entry.path, isDir: entry.isDir, mediaId: id };
    this.begin(pending, () => {
      for (const directory of missingParents.reverse()) {
        this.db.prepare('INSERT OR IGNORE INTO folders(path,library_id,parent,name,dev,ino,mtime_ms) VALUES (?,?,?,?,?,?,?)')
          .run(virtualPath(this.libraryId, directory.relative), this.libraryId, virtualPath(this.libraryId, parentOf(directory.relative)),
            path.posix.basename(directory.relative), directory.dev, directory.ino, directory.mtimeMs);
      }
      while (id && this.db.prepare('SELECT 1 FROM files WHERE id=?').get(id)) id = randomUUID();
      pending.mediaId = id;
      if (entry.isDir) {
        this.db.prepare('DELETE FROM scan_expiry_logged WHERE library_id=? AND path=?').run(this.libraryId, entry.path);
        this.db.prepare('INSERT INTO folders(path,library_id,parent,name,dev,ino,mtime_ms) VALUES (?,?,?,?,?,?,?)')
          .run(virtual, this.libraryId, parent, path.posix.basename(entry.path), identity(entry.dev), identity(entry.ino), entry.mtimeMs);
      } else {
        const kind = mediaType(entry.path); const seconds = Math.floor(entry.mtimeMs / 1000);
        this.db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,dev,ino,mtime_ms,head_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,'mtime',?,?,?,?)`).run(id, this.libraryId, entry.path, parent, path.posix.basename(entry.path), lookup(entry.path) || 'application/octet-stream', kind,
          entry.size, seconds, seconds, identity(entry.dev), identity(entry.ino), entry.mtimeMs, entry.headHash);
      }
      this.refresh([parent]);
    });
    return id;
  }
  async writeUpdated(old: IndexedRecord, entry: MoveCandidate): Promise<void> {
    if (old.isDir || !old.mediaId || entry.path !== old.path) throw new Error('无效的媒体更新');
    const parent = virtualPath(this.libraryId, parentOf(entry.path));
    this.begin({ kinds: ['updated'], oldPath: null, path: entry.path, isDir: false, mediaId: old.mediaId }, () => {
      this.verify(old);
      const seconds = Math.floor(entry.mtimeMs / 1000);
      if (!contentChanged(old, entry)) {
        this.db.prepare('UPDATE files SET dev=?,ino=?,mtime_ms=?,head_hash=? WHERE id=? AND library_id=?').run(identity(entry.dev), identity(entry.ino), entry.mtimeMs, entry.headHash, old.mediaId, this.libraryId);
        this.refresh([parent]); return;
      }
      const updated = this.db.prepare(`UPDATE files SET size=?,modified_at=?,taken_at=?,taken_at_source='mtime',metadata_status='pending',
        cache_generation=cache_generation+1,thumb_version=CASE WHEN thumb_version>0 THEN thumb_version+1 ELSE 0 END,thumb_ready=0,thumbhash=NULL,has_preview=0,
        width=NULL,height=NULL,orientation=NULL,duration_sec=NULL,codec=NULL,audio_codec=NULL,container=NULL,fps=NULL,bitrate=NULL,
        make=NULL,model=NULL,lens=NULL,f_number=NULL,exposure_time=NULL,iso=NULL,focal_length=NULL,focal_length35=NULL,software=NULL,
        latitude=NULL,longitude=NULL,altitude=NULL,playability=NULL,dev=?,ino=?,mtime_ms=?,head_hash=? WHERE id=? AND library_id=? AND relative_path=?`)
        .run(entry.size, seconds, seconds, identity(entry.dev), identity(entry.ino), entry.mtimeMs, entry.headHash, old.mediaId, this.libraryId, old.path);
      if (!updated.changes) throw new Error('媒体索引已变化'); this.refresh([parent]);
    });
  }
  private relocate(old: IndexedRecord, entry: MoveCandidate): number {
    const target = virtualPath(this.libraryId, entry.path);
    const fromParent = virtualPath(this.libraryId, parentOf(old.path)); const toParent = virtualPath(this.libraryId, parentOf(entry.path));
    let removedProvisional = 0;
    if (old.isDir) {
      if (old.path !== entry.path) {
        removedProvisional = this.mergeProvisionalDirectory(old.path, entry.path);
        moveDirectoryPaths(this.db, this.libraryId, old.path, entry.path, toParent);
      }
      if (!this.db.prepare('UPDATE folders SET name=?,parent=?,missing_at_ms=NULL,dev=?,ino=?,mtime_ms=? WHERE path=? AND library_id=?')
        .run(path.posix.basename(entry.path), toParent, identity(entry.dev), identity(entry.ino), entry.mtimeMs, target, this.libraryId).changes) throw new Error('目录索引已变化');
      const descendants = this.db.prepare('SELECT path FROM folders WHERE library_id=? AND path>=? AND path<?').all(this.libraryId, `${target}/`, `${target}0`) as { path: string }[];
      this.refresh([target, fromParent, toParent, ...descendants.map((folder) => folder.path)]);
    } else {
      if (!old.mediaId) throw new Error('媒体缺少 ID');
      const changed = this.db.prepare(`UPDATE files SET relative_path=?,folder=?,name=?,mime=?,media_type=?,missing_at_ms=NULL,dev=?,ino=?,mtime_ms=?,head_hash=?,size=?,modified_at=?
        WHERE id=? AND library_id=? AND relative_path=?`).run(entry.path, toParent, path.posix.basename(entry.path), lookup(entry.path) || 'application/octet-stream', mediaType(entry.path), identity(entry.dev), identity(entry.ino), entry.mtimeMs,
          entry.headHash, entry.size, Math.floor(entry.mtimeMs / 1000), old.mediaId, this.libraryId, old.path);
      if (!changed.changes) throw new Error('媒体索引已变化');
      if (contentChanged(old, entry)) this.db.prepare(`UPDATE files SET taken_at=?,taken_at_source='mtime',metadata_status='pending',
        cache_generation=cache_generation+1,thumb_version=CASE WHEN thumb_version>0 THEN thumb_version+1 ELSE 0 END,thumb_ready=0,thumbhash=NULL,has_preview=0,
        width=NULL,height=NULL,orientation=NULL,duration_sec=NULL,codec=NULL,audio_codec=NULL,container=NULL,fps=NULL,bitrate=NULL,
        make=NULL,model=NULL,lens=NULL,f_number=NULL,exposure_time=NULL,iso=NULL,focal_length=NULL,focal_length35=NULL,software=NULL,
        latitude=NULL,longitude=NULL,altitude=NULL,playability=NULL WHERE id=?`).run(Math.floor(entry.mtimeMs / 1000), old.mediaId);
      this.refresh([fromParent, toParent]);
    }
    return removedProvisional;
  }
  private mergeProvisionalDirectory(from: string, to: string): number {
    const source = virtualPath(this.libraryId, from); const target = virtualPath(this.libraryId, to);
    let removed = 0;
    const files = this.db.prepare(`SELECT id,relative_path,dev,ino FROM files WHERE library_id=? AND (folder=? OR (folder>=? AND folder<?))`)
      .all(this.libraryId, source, `${source}/`, `${source}0`) as { id: string; relative_path: string; dev: string | null; ino: string | null }[];
    for (const file of files) {
      const relative = to + file.relative_path.slice(from.length);
      const provisional = this.db.prepare('SELECT id,dev,ino,missing_at_ms FROM files WHERE library_id=? AND relative_path=?').get(this.libraryId, relative) as { id: string; dev: string | null; ino: string | null; missing_at_ms: number | null } | undefined;
      if (!provisional) continue;
      if (!file.dev || !file.ino || file.dev !== provisional.dev || file.ino !== provisional.ino) throw new Error('目录移动的目标媒体身份冲突');
      this.db.prepare("INSERT OR IGNORE INTO favorites(user_id,item_id,item_type,created_at) SELECT user_id,?,'file',created_at FROM favorites WHERE item_type='file' AND item_id=?").run(file.id, provisional.id);
      this.db.prepare('INSERT OR IGNORE INTO album_items(album_id,file_id,created_at) SELECT album_id,?,created_at FROM album_items WHERE file_id=?').run(file.id, provisional.id);
      this.db.prepare('UPDATE albums SET cover_id=? WHERE cover_id=?').run(file.id, provisional.id);
      if (provisional.missing_at_ms === null) removed++;
      this.removeFile(provisional.id);
    }
    const folders = this.db.prepare('SELECT path,dev,ino FROM folders WHERE library_id=? AND (path=? OR (path>=? AND path<?)) ORDER BY length(path) DESC')
      .all(this.libraryId, source, `${source}/`, `${source}0`) as { path: string; dev: string | null; ino: string | null }[];
    for (const folder of folders) {
      const destination = target + folder.path.slice(source.length);
      const provisional = this.db.prepare('SELECT dev,ino FROM folders WHERE library_id=? AND path=?').get(this.libraryId, destination) as { dev: string | null; ino: string | null } | undefined;
      if (provisional && (!folder.dev || !folder.ino || folder.dev !== provisional.dev || folder.ino !== provisional.ino)) throw new Error('目录移动的目标目录身份冲突');
      this.db.prepare('DELETE FROM folders WHERE library_id=? AND path=?').run(this.libraryId, destination);
    }
    return removed;
  }
  async writeMoved(old: IndexedRecord, entry: MoveCandidate): Promise<number> {
    let removed = 0;
    this.begin({ kinds: ['moved'], oldPath: old.path, path: entry.path, isDir: old.isDir, mediaId: old.mediaId }, () => {
      this.verify(old);
      this.removeProvisional(old, entry);
      removed = this.relocate(old, entry);
    });
    return removed;
  }
  private removeProvisional(old: IndexedRecord, entry: MoveCandidate): void {
      if (entry.mediaId !== null && entry.mediaId !== old.mediaId) {
        if (old.isDir || !old.mediaId) throw new Error('临时媒体身份无效');
        const provisional = this.db.prepare('SELECT id,relative_path,size,modified_at,mtime_ms,dev,ino,head_hash,missing_at_ms FROM files WHERE id=? AND library_id=? AND relative_path=?')
          .get(entry.mediaId, this.libraryId, entry.path) as FileRow | undefined;
        if (!provisional || provisional.missing_at_ms !== null || provisional.size !== entry.size || provisional.mtime_ms !== entry.mtimeMs ||
          identity(provisional.dev) !== identity(entry.dev) || identity(provisional.ino) !== identity(entry.ino) || provisional.head_hash !== entry.headHash) throw new Error('临时媒体索引已变化');
        this.db.prepare("INSERT OR IGNORE INTO favorites(user_id,item_id,item_type,created_at) SELECT user_id,?,'file',created_at FROM favorites WHERE item_type='file' AND item_id=?").run(old.mediaId, entry.mediaId);
        this.db.prepare('INSERT OR IGNORE INTO album_items(album_id,file_id,created_at) SELECT album_id,?,created_at FROM album_items WHERE file_id=?').run(old.mediaId, entry.mediaId);
        this.db.prepare('UPDATE albums SET cover_id=? WHERE cover_id=?').run(old.mediaId, entry.mediaId);
        this.removeFile(entry.mediaId);
      }
  }
  async writeRestored(old: IndexedRecord, entry: MoveCandidate): Promise<number> {
    let removed = 0;
    this.begin({ kinds: ['restored', 'moved'], oldPath: old.path, path: entry.path, isDir: old.isDir, mediaId: old.mediaId }, () => { this.verify(old); this.removeProvisional(old, entry); removed = this.relocate(old, entry); });
    return removed;
  }
  async writeMissing(old: IndexedRecord, at: number): Promise<number> {
    const virtual = virtualPath(this.libraryId, old.path); const parent = virtualPath(this.libraryId, parentOf(old.path));
    let missingMedia = 0;
    this.begin({ kinds: ['missing'], oldPath: null, path: old.path, isDir: old.isDir, mediaId: old.mediaId }, () => {
      this.verify(old);
      if (old.isDir) {
        missingMedia = this.db.prepare('UPDATE files SET missing_at_ms=? WHERE library_id=? AND missing_at_ms IS NULL AND (folder=? OR (folder>=? AND folder<?))')
          .run(at, this.libraryId, virtual, `${virtual}/`, `${virtual}0`).changes;
        const changed = this.db.prepare('UPDATE folders SET missing_at_ms=COALESCE(missing_at_ms,?) WHERE library_id=? AND (path=? OR (path>=? AND path<?))')
          .run(at, this.libraryId, virtual, `${virtual}/`, `${virtual}0`);
        if (!changed.changes) throw new Error('目录索引已变化');
      } else {
        missingMedia = this.db.prepare('UPDATE files SET missing_at_ms=COALESCE(missing_at_ms,?) WHERE id=? AND library_id=? AND relative_path=?')
          .run(at, old.mediaId, this.libraryId, old.path).changes;
        if (!missingMedia) throw new Error('媒体索引已变化');
      }
      this.refresh([parent]);
    });
    return missingMedia;
  }
  private removeFile(id: string): void {
    this.db.prepare("DELETE FROM favorites WHERE item_type='file' AND item_id=?").run(id);
    this.db.prepare('UPDATE albums SET cover_id=NULL WHERE cover_id=?').run(id);
    this.db.prepare("INSERT OR REPLACE INTO cache_gc(cache_key,relative_path) SELECT cache_key,relative_path FROM cache_entries WHERE media_id=? AND (variant IS NULL OR variant<>'hls')").run(id);
    this.db.prepare('DELETE FROM cache_entries WHERE media_id=? OR hls_session_id IN (SELECT id FROM hls_sessions WHERE media_id=?)').run(id, id);
    this.db.prepare('DELETE FROM files WHERE id=?').run(id);
  }
  async writeRemoved(old: IndexedRecord): Promise<void> {
    const virtual = virtualPath(this.libraryId, old.path); const parent = virtualPath(this.libraryId, parentOf(old.path));
    this.begin({ kinds: ['removed'], oldPath: null, path: old.path, isDir: old.isDir, mediaId: old.mediaId }, () => {
      this.verify(old);
      if (old.missingAt === null) throw new Error('索引已变化');
      if (old.isDir) {
        const liveFile = this.db.prepare('SELECT 1 FROM files WHERE library_id=? AND missing_at_ms IS NULL AND (folder=? OR (folder>=? AND folder<?)) LIMIT 1')
          .get(this.libraryId, virtual, `${virtual}/`, `${virtual}0`);
        const liveFolder = this.db.prepare('SELECT 1 FROM folders WHERE library_id=? AND missing_at_ms IS NULL AND path>=? AND path<? LIMIT 1')
          .get(this.libraryId, `${virtual}/`, `${virtual}0`);
        if (liveFile || liveFolder) throw new Error('索引已变化');
        const files = this.db.prepare('SELECT id FROM files WHERE library_id=? AND missing_at_ms IS NOT NULL AND (folder=? OR (folder>=? AND folder<?))').all(this.libraryId, virtual, `${virtual}/`, `${virtual}0`) as { id: string }[];
        for (const row of files) this.removeFile(row.id);
        const folders = this.db.prepare('SELECT path FROM folders WHERE library_id=? AND missing_at_ms IS NOT NULL AND (path=? OR (path>=? AND path<?)) ORDER BY length(path) DESC').all(this.libraryId, virtual, `${virtual}/`, `${virtual}0`) as { path: string }[];
        for (const row of folders) { this.db.prepare("DELETE FROM favorites WHERE item_type='folder' AND item_id=?").run(row.path); this.db.prepare('DELETE FROM folders WHERE path=?').run(row.path); }
      } else if (old.mediaId) this.removeFile(old.mediaId);
      this.refresh([parent]);
    });
  }
  async appendChange(change: WatchLibraryChange): Promise<void> {
    if (!this.pending) {
      if (this.duplicate && change.kind === this.duplicate.kind && change.path === this.duplicate.path && change.fromPath === this.duplicate.fromPath && change.source === this.duplicate.source) { this.duplicate = null; return; }
      this.duplicate = null;
      this.db.transaction(() => { this.options.assertLease?.(); appendLibraryChange(this.db, this.libraryId, change, this.options.now?.() ?? Date.now()); }).immediate();
      return;
    }
    const pending = this.pending;
    try {
      if (!pending.kinds.includes(change.kind) || change.path !== pending.path || change.isDir !== pending.isDir || change.mediaId !== pending.mediaId ||
        (change.kind === 'moved' ? change.fromPath !== pending.oldPath : change.fromPath !== null)) throw new Error('变更记录与索引写入不匹配');
      appendLibraryChange(this.db, this.libraryId, change, this.options.now?.() ?? Date.now());
      if (change.kind === 'restored' && pending.oldPath !== null && pending.oldPath !== pending.path) {
        const moved = { ...change, kind: 'moved' as const, fromPath: pending.oldPath };
        appendLibraryChange(this.db, this.libraryId, moved, this.options.now?.() ?? Date.now()); this.duplicate = moved;
      }
      this.db.exec('COMMIT'); this.pending = null;
    } catch (error) { this.db.exec('ROLLBACK'); this.pending = null; this.duplicate = null; throw error; }
  }
  async requestFullReconcile(reason: string): Promise<void> {
    if (this.pending) { this.db.exec('ROLLBACK'); this.pending = null; this.duplicate = null; }
    await this.options.requestFullReconcile(reason);
  }
  async publishEvent(event: LibraryChangedEvent, channel?: 'folder-time'): Promise<void> { await this.options.publishEvent(event, channel); }
  close(): void { if (this.pending) { this.db.exec('ROLLBACK'); this.pending = null; } }
}
