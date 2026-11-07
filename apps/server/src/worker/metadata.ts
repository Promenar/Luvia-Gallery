import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runProcess } from './process-runner.ts';
import { waitForWalCapacity } from './wal-checkpoint.ts';
import { runLanes } from './lanes.ts';
import { renewLease } from '../core/sqlite-errors.ts';
import type Database from 'better-sqlite3';
import { publishLibraryEvent } from './watch-events.ts';
import exifr from 'exifr';
import sharp, { type Metadata as SharpMetadata } from 'sharp';
import { secureMediaPath } from '../core/paths.ts';
import { readSettings } from '../core/settings.ts';
import { isImageDecodeError } from './image-decoding.ts';
import type { JobRow } from '../core/jobs.ts';
import { clearMediaFailure, mediaIgnored, recordMediaFailure } from '../core/media-failures.ts';

type Source = { id: string; relative_path: string; folder: string; name: string; media_type: string; size: number; modified_at: number; cache_generation: number; root: string };
type Counts = { indexed: number; failed: number };
type Metadata = {
  takenAt: number; takenAtSource: 'metadata' | 'filename' | 'mtime'; width: number | null; height: number | null;
  orientation: number | null; duration: number | null; codec: string | null; audioCodec: string | null; container: string | null;
  fps: number | null; bitrate: number | null; make: string | null; model: string | null; lens: string | null;
  fNumber: number | null; exposure: number | null; iso: number | null; focalLength: number | null; focalLength35: number | null;
  software: string | null; latitude: number | null; longitude: number | null; altitude: number | null;
  playability: 'direct' | 'transcode' | 'unsupported' | null;
};
const now = () => Math.floor(Date.now() / 1000);
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
const string = (v: unknown): string | null => typeof v === 'string' && v.length > 0 ? v.slice(0, 500) : null;
const positive = (v: unknown): number | null => { const n = typeof v === 'string' ? Number(v) : number(v); return n !== null && Number.isFinite(n) && n > 0 ? n : null; };
function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function dateParts(year: number, month: number, day: number, hour: number, minute: number, second: number, offset?: string): number | null {
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  if (offset !== undefined) {
    const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
    if (!match || Number(match[2]) > 14 || Number(match[3]) > 59 || (Number(match[2]) === 14 && Number(match[3]) !== 0)) return null;
    const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1);
    return Math.floor(utc.getTime() / 1000) - minutes * 60;
  }
  const local = new Date(year, month - 1, day, hour, minute, second);
  return Math.floor(local.getTime() / 1000);
}
function exifDate(value: unknown, offset: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return dateParts(...(m.slice(1).map(Number) as [number, number, number, number, number, number]), typeof offset === 'string' ? offset : undefined);
}
function filenameDate(name: string): number | null {
  const m = /(?:^|\D)((?:19|20)\d{2})[-_:]?([01]\d)[-_:]?([0-3]\d)(?:[_ T-]?([0-2]\d)[-:]?([0-5]\d)[-:]?([0-5]\d))?(?!\d)/.exec(name);
  if (!m) return null;
  return dateParts(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
}
function base(source: Source): Metadata {
  const filename = filenameDate(source.name);
  return { takenAt: filename ?? source.modified_at, takenAtSource: filename === null ? 'mtime' : 'filename', width: null, height: null,
    orientation: null, duration: null, codec: null, audioCodec: null, container: null, fps: null, bitrate: null,
    make: null, model: null, lens: null, fNumber: null, exposure: null, iso: null, focalLength: null, focalLength35: null,
    software: null, latitude: null, longitude: null, altitude: null, playability: null };
}
async function readImage(filename: string, source: Source, signal: AbortSignal | undefined, transcode: boolean): Promise<Metadata> {
  const result = base(source);
  let image: SharpMetadata | undefined;
  try { image = await sharp(filename).metadata(); }
  catch (error) {
    if (!isImageDecodeError(error)) throw error;
    try { image = await sharp(filename, { failOn: 'none' }).metadata(); }
    catch (fallbackError) {
      if (!isImageDecodeError(fallbackError)) throw fallbackError;
      const probed = await readAv(filename, source, signal, transcode);
      if (!probed.width || !probed.height) throw new Error('图片尺寸不可用');
      result.width = probed.width; result.height = probed.height;
      if (probed.takenAtSource === 'metadata') { result.takenAt = probed.takenAt; result.takenAtSource = 'metadata'; }
    }
  }
  if (image) {
    if (!image.width || !image.height) throw new Error('图片尺寸不可用');
    const flipped = image.orientation !== undefined && image.orientation >= 5 && image.orientation <= 8;
    result.width = flipped ? image.height : image.width; result.height = flipped ? image.width : image.height;
    result.orientation = image.orientation ?? null;
  }
  if (!image) return result;
  const parseOptions = { gps: true, exif: true, reviveValues: false, translateValues: false };
  let tags = await exifr.parse(filename, parseOptions).catch(() => undefined) as Record<string, unknown> | undefined;
  // exifr 不能直接解析部分 WebP 容器，但 sharp 已提取出其中的 TIFF 格式 EXIF。
  if (!tags && image.exif) {
    const exif = image.exif.subarray(0, 6).equals(Buffer.from('Exif\0\0')) ? image.exif.subarray(6) : image.exif;
    tags = await exifr.parse(exif, parseOptions).catch(() => undefined) as Record<string, unknown> | undefined;
  }
  if (!tags) return result;
  const taken = exifDate(tags.DateTimeOriginal, tags.OffsetTimeOriginal);
  if (taken !== null) { result.takenAt = taken; result.takenAtSource = 'metadata'; }
  result.make = string(tags.Make); result.model = string(tags.Model); result.lens = string(tags.LensModel);
  result.fNumber = number(tags.FNumber); result.exposure = number(tags.ExposureTime); result.iso = number(tags.ISO);
  result.focalLength = number(tags.FocalLength); result.focalLength35 = number(tags.FocalLengthIn35mmFormat); result.software = string(tags.Software);
  const lat = number(tags.latitude); const lon = number(tags.longitude);
  if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { result.latitude = lat; result.longitude = lon; }
  const altitude = number(tags.GPSAltitude);
  result.altitude = altitude === null ? null : tags.GPSAltitudeRef === 1 ? -altitude : altitude;
  return result;
}
async function readAv(filename: string, source: Source, signal: AbortSignal | undefined, transcode: boolean): Promise<Metadata> {
  const probed = await runProcess('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', filename], { timeoutMs: 15000, maxBuffer: 2 * 1024 * 1024, capture: true, signal });
  signal?.throwIfAborted();
  if (probed.code !== 0 || probed.error) throw new Error('媒体信息读取失败');
  const { stdout } = probed;
  const probe = JSON.parse(stdout) as { streams?: Record<string, any>[]; format?: Record<string, any> };
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (source.media_type === 'video' && !video || source.media_type === 'audio' && !audio) throw new Error('媒体流不可用');
  const result = base(source);
  result.codec = string(video?.codec_name); result.audioCodec = string(audio?.codec_name); result.container = string(probe.format?.format_name);
  result.duration = positive(probe.format?.duration) ?? positive(video?.duration) ?? positive(audio?.duration);
  result.bitrate = positive(probe.format?.bit_rate);
  const frame = typeof video?.avg_frame_rate === 'string' ? /^(\d+)\/(\d+)$/.exec(video.avg_frame_rate) : null;
  if (frame && Number(frame[2]) > 0) result.fps = Number(frame[1]) / Number(frame[2]);
  const rotation = Number(video?.tags?.rotate ?? video?.side_data_list?.find((entry: Record<string, unknown>) => entry.rotation !== undefined)?.rotation ?? 0);
  const swapped = Math.abs(rotation) % 180 === 90;
  result.width = positive(swapped ? video?.height : video?.width); result.height = positive(swapped ? video?.width : video?.height);
  const date = probe.format?.tags?.creation_time ?? video?.tags?.creation_time ?? audio?.tags?.creation_time;
  const timestamp = typeof date === 'string' ? Date.parse(date) : NaN;
  if (Number.isFinite(timestamp)) { result.takenAt = Math.floor(timestamp / 1000); result.takenAtSource = 'metadata'; }
  if (source.media_type === 'video') {
    const containers = result.container?.split(',') ?? [];
    const direct = (containers.some((name) => name === 'mp4' || name === 'mov') && result.codec === 'h264' && (!result.audioCodec || result.audioCodec === 'aac')) ||
      (containers.includes('webm') && ['vp8', 'vp9', 'av1'].includes(result.codec ?? '') && (!result.audioCodec || ['opus', 'vorbis'].includes(result.audioCodec)));
    result.playability = direct ? 'direct' : transcode ? 'transcode' : 'unsupported';
  }
  return result;
}

function refreshDirtyFolders(db: Database.Database): boolean {
  const locked = new Set(db.prepare('SELECT library_id FROM scan_locks WHERE lease_expires_at>unixepoch()').pluck().all() as string[]);
  let dirty: { path: string; updated: number }[];
  if (!locked.size) dirty = db.prepare('SELECT path,updated FROM metadata_dirty_folders ORDER BY path LIMIT 64').all() as { path: string; updated: number }[];
  else {
    // 扫描中的媒体库先跳过。目录路径以媒体库 ID 开头，按未锁定媒体库的路径范围取，
    // 不逐条检查锁——扫描期间积压数千条时逐条跳过每次要 0.3 秒并卡住主线程
    dirty = [];
    const root = db.prepare('SELECT path,updated FROM metadata_dirty_folders WHERE path=?');
    const range = db.prepare('SELECT path,updated FROM metadata_dirty_folders WHERE path>=? AND path<? ORDER BY path LIMIT ?');
    for (const id of db.prepare('SELECT id FROM libraries ORDER BY id').pluck().all() as string[]) {
      if (locked.has(id)) continue;
      if (dirty.length >= 64) break;
      const own = root.get(id) as { path: string; updated: number } | undefined;
      if (own) dirty.push(own);
      dirty.push(...range.all(`${id}/`, `${id}0`, 64 - dirty.length) as { path: string; updated: number }[]);
    }
  }
  const ancestors = new Set<string>();
  const parent = db.prepare('SELECT parent FROM folders WHERE path=?');
  for (const entry of dirty) {
    let current: string | null = entry.path;
    while (current && !ancestors.has(current)) {
      ancestors.add(current);
      current = (parent.get(current) as { parent: string | null } | undefined)?.parent ?? null;
    }
  }
  const latestDirect = db.prepare('SELECT taken_at FROM files WHERE folder=? AND missing_at_ms IS NULL ORDER BY taken_at DESC,id ASC LIMIT 1');
  const latestChild = db.prepare('SELECT max(latest_at) AS latest FROM folders WHERE parent=? AND missing_at_ms IS NULL');
  const directCover = db.prepare('SELECT id,taken_at FROM files WHERE folder=? AND missing_at_ms IS NULL AND thumb_ready=1 ORDER BY taken_at DESC,id ASC LIMIT 1');
  const childCover = db.prepare(`SELECT f.id,f.taken_at FROM folders child JOIN files f ON f.id=child.cover_file_id
    WHERE child.parent=? AND child.missing_at_ms IS NULL AND f.missing_at_ms IS NULL AND f.thumb_ready=1 ORDER BY f.taken_at DESC,f.id ASC LIMIT 1`);
  const update = db.prepare('UPDATE folders SET latest_at=?,cover_file_id=? WHERE path=?');
  for (const folder of [...ancestors].sort((a, b) => b.length - a.length)) {
    const own = (latestDirect.get(folder) as { taken_at: number } | undefined)?.taken_at ?? null;
    const child = (latestChild.get(folder) as { latest: number | null }).latest;
    const latest = own === null ? child : child === null ? own : Math.max(own, child);
    const covers = [directCover.get(folder), childCover.get(folder)].filter(Boolean) as { id: string; taken_at: number }[];
    covers.sort((a, b) => b.taken_at - a.taken_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    update.run(latest, covers[0]?.id ?? null, folder);
  }
  const clear = db.prepare('DELETE FROM metadata_dirty_folders WHERE path=?');
  for (const entry of dirty) clear.run(entry.path);
  const grouped = new Map<string, { folders: string[]; updated: number }>();
  for (const entry of dirty) {
    const row = db.prepare('SELECT library_id FROM folders WHERE path=?').get(entry.path) as { library_id: string } | undefined;
    if (!row) continue;
    const value = grouped.get(row.library_id) ?? { folders: [], updated: 0 };
    value.folders.push(entry.path); value.updated += entry.updated; grouped.set(row.library_id, value);
  }
  for (const [libraryId, value] of grouped) publishLibraryEvent(db, { libraryId, source: 'scan', folders: value.folders, added: 0, removed: 0, updated: value.updated, moved: 0 });
  return !!db.prepare('SELECT 1 FROM metadata_dirty_folders LIMIT 1').get();
}

/**
 * 认领下一个待提取元数据的文件。固定沿 files_metadata(metadata_status,id)，按库认领时沿 files_library_metadata(library_id,metadata_status,id)，
 * 按 id 顺序取第一项：
 * 统计信息过期或抽样失真时，规划器会改由媒体库驱动、扫整库再排序，大库上每次认领都要数秒并占住写锁。
 */
/** 界面请求的优先读取项保留时长（秒）。 */
export const PRIORITY_TTL_SECONDS = 600;

/** 下一个待读文件：沿索引按修改时间倒序，最近的文件先读，与默认时间线顺序一致。 */
export function metadataClaimSql(byLibrary: boolean): string {
  return `SELECT f.id,f.relative_path,f.folder,f.name,f.media_type,f.size,f.modified_at,f.cache_generation,l.root FROM files f INDEXED BY ${byLibrary ? 'files_library_metadata_recent' : 'files_metadata_recent'}
    CROSS JOIN libraries l ON l.id=f.library_id AND l.enabled=1 LEFT JOIN metadata_claims c ON c.file_id=f.id
    WHERE f.metadata_status='pending' AND f.missing_at_ms IS NULL AND c.file_id IS NULL${byLibrary ? ' AND f.library_id=?' : ''} ORDER BY f.modified_at DESC LIMIT 1`;
}

/** 界面正在显示且缺少宽高的文件（metadata_priority），最近请求的先读。 */
export function metadataPriorityClaimSql(byLibrary: boolean): string {
  return `SELECT f.id,f.relative_path,f.folder,f.name,f.media_type,f.size,f.modified_at,f.cache_generation,l.root FROM metadata_priority p INDEXED BY metadata_priority_recent
    CROSS JOIN files f ON f.id=p.file_id CROSS JOIN libraries l ON l.id=f.library_id AND l.enabled=1 LEFT JOIN metadata_claims c ON c.file_id=f.id
    WHERE f.metadata_status='pending' AND f.missing_at_ms IS NULL AND c.file_id IS NULL${byLibrary ? ' AND f.library_id=?' : ''} ORDER BY p.requested_at DESC LIMIT 1`;
}

export function flushMetadataFolders(db: Database.Database, assertLease: () => void = () => {}): boolean {
  return db.transaction(() => { assertLease(); return refreshDirtyFolders(db); }).immediate();
}

/** 读取单个文件的元数据；文件在读取前后发生变化、损坏或不在允许的挂载内时返回 null。 */
async function extractSource(source: Source, allowed: string[], signal: AbortSignal | undefined, transcode: boolean): Promise<Metadata | null> {
  try {
    const root = await realpath(source.root);
    if (!allowed.some((candidate) => candidate && within(candidate, root))) throw new Error('媒体库不在挂载内');
    const filename = await secureMediaPath(root, source.relative_path);
    const before = await stat(filename);
    if (before.size !== source.size || Math.floor(before.mtimeMs / 1000) !== source.modified_at) throw new Error('媒体已变化');
    const metadata = source.media_type === 'image' ? await readImage(filename, source, signal, transcode) : await readAv(filename, source, signal, transcode);
    const after = await stat(filename);
    if (after.size !== source.size || Math.floor(after.mtimeMs / 1000) !== source.modified_at) throw new Error('媒体已变化');
    return metadata;
  } catch { return null; }
}

/** 在调用方的事务内保存读取结果；文件已不是待处理状态（已被其它途径读取、内容变化或缺失）时不写入。 */
function saveMetadata(db: Database.Database, source: Source, metadata: Metadata | null): 'indexed' | 'failed' | null {
  const current = db.prepare("SELECT 1 FROM files WHERE id=? AND size=? AND modified_at=? AND cache_generation=? AND metadata_status='pending' AND missing_at_ms IS NULL").get(source.id, source.size, source.modified_at, source.cache_generation);
  if (!current) return null;
  if (!metadata) {
    db.prepare("UPDATE files SET metadata_status='failed',playability=CASE WHEN media_type='video' THEN 'unsupported' ELSE NULL END WHERE id=?").run(source.id);
    recordMediaFailure(db, source, { kind: 'metadata' }, '拍摄信息读取失败，请检查文件和格式');
    return 'failed';
  }
  clearMediaFailure(db, source, { kind: 'metadata' });
  db.prepare(`UPDATE files SET taken_at=?,taken_at_source=?,width=?,height=?,orientation=?,duration_sec=?,codec=?,audio_codec=?,container=?,fps=?,bitrate=?,
    make=?,model=?,lens=?,f_number=?,exposure_time=?,iso=?,focal_length=?,focal_length35=?,software=?,latitude=?,longitude=?,altitude=?,playability=?,metadata_status='done' WHERE id=?`)
    .run(metadata.takenAt, metadata.takenAtSource, metadata.width, metadata.height, metadata.orientation, metadata.duration, metadata.codec, metadata.audioCodec,
      metadata.container, metadata.fps, metadata.bitrate, metadata.make, metadata.model, metadata.lens, metadata.fNumber, metadata.exposure, metadata.iso,
      metadata.focalLength, metadata.focalLength35, metadata.software, metadata.latitude, metadata.longitude, metadata.altitude, metadata.playability, source.id);
  db.prepare('INSERT INTO metadata_dirty_folders(path,updated) VALUES (?,1) ON CONFLICT(path) DO UPDATE SET updated=updated+1').run(source.folder);
  return 'indexed';
}

/**
 * 立即读取单个尚未读取元数据的文件（查看器打开时调用），信任边界与提供原文件相同：限定在该文件所属媒体库的根目录内。
 * 已读取、文件缺失或媒体库停用时不做任何事，返回 false。
 */
export async function extractMetadataNow(db: Database.Database, fileId: string, signal?: AbortSignal): Promise<boolean> {
  const source = db.prepare(`SELECT f.id,f.relative_path,f.folder,f.name,f.media_type,f.size,f.modified_at,f.cache_generation,l.root FROM files f
    JOIN libraries l ON l.id=f.library_id AND l.enabled=1 WHERE f.id=? AND f.metadata_status='pending' AND f.missing_at_ms IS NULL`).get(fileId) as Source | undefined;
  if (!source) return false;
  if (mediaIgnored(db, source, { kind: 'metadata' })) return false;
  const root = await realpath(source.root).catch(() => '');
  const metadata = await extractSource(source, [root], signal, readSettings(db).transcode.enabled);
  signal?.throwIfAborted();
  return db.transaction(() => saveMetadata(db, source, metadata) !== null).immediate();
}

export async function processMetadataBatch(db: Database.Database, job: JobRow, options: { owner: string; allowedRoots: string[]; libraryId?: string | null; recoveryIds?: string[]; assertLease: () => void; signal?: AbortSignal }): Promise<{ complete: boolean; counts: Counts }> {
  const previous = job.checkpoint ? JSON.parse(job.checkpoint) as Partial<Counts> : {};
  const counts: Counts = { indexed: previous.indexed ?? 0, failed: previous.failed ?? 0 };
  const libraryClause = options.libraryId ? ' AND f.library_id=?' : '';
  const libraryArgs = options.libraryId ? [options.libraryId] : [];
  const allowed = await Promise.all(options.allowedRoots.map((root) => realpath(root).catch(() => '')));
  const settings = readSettings(db);
  const concurrency = settings.workers.metadataConcurrency;
  // 每轮最多处理的文件数；一轮结束后释放作业，让排队的其它作业有机会被领取。
  const budget = Math.max(32, concurrency * 16);
  const stop = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
  let claimed = 0; let exhausted = false;
  const claim = () => db.transaction(() => {
    options.assertLease();
    db.prepare('DELETE FROM metadata_claims WHERE lease_expires_at<=?').run(now());
    // 界面请求超过 10 分钟的优先项已滚走，不再插队
    db.prepare('DELETE FROM metadata_priority WHERE requested_at<=?').run(now() - PRIORITY_TTL_SECONDS);
    const priority = options.recoveryIds ? undefined : db.prepare(metadataPriorityClaimSql(!!options.libraryId)).get(...libraryArgs) as Source | undefined;
    if (priority) db.prepare('DELETE FROM metadata_priority WHERE file_id=?').run(priority.id);
    const row = priority ?? (options.recoveryIds ? db.prepare(`SELECT f.id,f.relative_path,f.folder,f.name,f.media_type,f.size,f.modified_at,f.cache_generation,l.root
      FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1 LEFT JOIN metadata_claims c ON c.file_id=f.id
      WHERE f.id IN (SELECT value FROM json_each(?)) AND f.library_id=? AND f.metadata_status='pending' AND f.missing_at_ms IS NULL AND c.file_id IS NULL LIMIT 1`)
      .get(JSON.stringify(options.recoveryIds), options.libraryId) : db.prepare(metadataClaimSql(!!options.libraryId)).get(...libraryArgs)) as Source | undefined;
    if (row) db.prepare('INSERT INTO metadata_claims(file_id,job_id,owner,lease_expires_at) VALUES (?,?,?,?)').run(row.id, job.id, options.owner, now() + 30);
    return row;
  }).immediate();
  const lane = async () => {
    while (!exhausted && claimed < budget) {
      signal.throwIfAborted();
      await waitForWalCapacity(signal);
      const source = claim();
      if (!source) { exhausted = true; break; }
      claimed++;
      const local = new AbortController();
      const fileSignal = AbortSignal.any([signal, local.signal]);
      const timer = setInterval(() => renewLease(() => {
        options.assertLease();
        return db.prepare('UPDATE metadata_claims SET lease_expires_at=? WHERE file_id=? AND job_id=? AND owner=? AND lease_expires_at>?').run(now() + 30, source.id, job.id, options.owner, now()).changes > 0;
      }, () => local.abort()), 5000);
      timer.unref();
      let metadata: Metadata | null = null;
      try { metadata = await extractSource(source, allowed, fileSignal, settings.transcode.enabled); }
      catch (error) { if (!local.signal.aborted || signal.aborted) throw error; }
      finally { clearInterval(timer); }
      signal.throwIfAborted();
      // 单个文件的认领失效（例如磁盘繁忙时续租连续跳过）只放弃这个文件，认领过期后再被领取；作业租约失效仍向上抛出
      if (local.signal.aborted) { options.assertLease(); continue; }
      db.transaction(() => {
        options.assertLease();
        if (!db.prepare('SELECT 1 FROM metadata_claims WHERE file_id=? AND job_id=? AND owner=? AND lease_expires_at>?').get(source.id, job.id, options.owner, now())) return;
        const result = saveMetadata(db, source, metadata);
        if (result) {
          counts[result]++;
          db.prepare('UPDATE jobs SET checkpoint=?,progress_done=? WHERE id=?').run(JSON.stringify(counts), counts.indexed + counts.failed, job.id);
        }
        db.prepare('DELETE FROM metadata_claims WHERE file_id=? AND job_id=? AND owner=?').run(source.id, job.id, options.owner);
      }).immediate();
      // 让出事件循环，避免多路并发连续占用主线程
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  };
  await runLanes(concurrency, stop, lane);
  const dirtyRemaining = flushMetadataFolders(db, options.assertLease);
  const pending = options.recoveryIds ? db.prepare("SELECT 1 FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1 WHERE f.id IN (SELECT value FROM json_each(?)) AND f.library_id=? AND f.metadata_status='pending' AND f.missing_at_ms IS NULL LIMIT 1").get(JSON.stringify(options.recoveryIds), options.libraryId)
    : db.prepare(`SELECT 1 FROM files f INDEXED BY ${options.libraryId ? 'files_library_metadata' : 'files_metadata'} CROSS JOIN libraries l ON l.id=f.library_id AND l.enabled=1 WHERE f.metadata_status='pending' AND f.missing_at_ms IS NULL${libraryClause} LIMIT 1`).get(...libraryArgs);
  if (pending || dirtyRemaining) await delay(50, undefined, { signal: options.signal });
  return { complete: !pending && !dirtyRemaining, counts };
}
