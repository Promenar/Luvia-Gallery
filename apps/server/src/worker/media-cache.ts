import { mkdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import sharp, { type Metadata } from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import { z } from 'zod';
import { cacheKey, cachePath } from '../core/media-cache.ts';
import { secureMediaPath } from '../core/paths.ts';
import { runFfmpeg } from './ffmpeg-slots.ts';
import { readSettings } from '../core/settings.ts';
import { noteThumbnail } from '../core/folder-covers.ts';

const Variant = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('thumb'), size: z.enum(['s', 'm', 'l']) }),
  z.object({ kind: z.literal('display') }),
  z.object({ kind: z.literal('dimensions') }),
  z.object({ kind: z.literal('preview') }),
  z.object({ kind: z.literal('tile'), level: z.number().int().nonnegative(), col: z.number().int().nonnegative(), row: z.number().int().nonnegative() }),
]);
const Task = z.object({ mediaId: z.string().min(1), sourceSize: z.number().int().nonnegative(), sourceModified: z.number().int(), sourceGeneration: z.number().int().nonnegative().default(0), variant: Variant });
const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
export async function generateMediaCache(db: Database.Database, payload: unknown, options: { owner: string; cacheDir: string; allowedRoots: string[]; assertLease: () => void; signal?: AbortSignal }): Promise<void> {
  const task = Task.parse(payload);
  const row = db.prepare(`SELECT f.id,f.size,f.modified_at,f.cache_generation,f.mtime_ms,f.relative_path,f.media_type,f.width,f.height,l.root FROM files f
    JOIN libraries l ON l.id=f.library_id WHERE f.id=? AND l.enabled=1 AND f.missing_at_ms IS NULL`).get(task.mediaId) as
    { id: string; size: number; modified_at: number; cache_generation: number; mtime_ms: number | null; relative_path: string; media_type: string; width: number | null; height: number | null; root: string } | undefined;
  if (!row || !(row.media_type === 'image' && task.variant.kind !== 'preview' || row.media_type === 'video' && (task.variant.kind === 'thumb' || task.variant.kind === 'preview')) || row.size !== task.sourceSize || row.modified_at !== task.sourceModified || row.cache_generation !== task.sourceGeneration) throw new Error('媒体已变化或不支持');
  const realRoot = await realpath(row.root);
  const allowed = await Promise.all(options.allowedRoots.map((root) => realpath(root)));
  if (!allowed.some((root) => within(root, realRoot))) throw new Error('媒体库不在挂载内');
  const filename = await secureMediaPath(realRoot, row.relative_path);
  const info = await stat(filename);
  if (info.size !== row.size || Math.floor(info.mtimeMs / 1000) !== row.modified_at || (row.mtime_ms !== null && info.mtimeMs !== row.mtime_ms)) throw new Error('媒体已变化');
  options.signal?.throwIfAborted(); options.assertLease();
  /** 记录显示方向下的宽高；onlyMissing 时只填补尚无尺寸的文件，不覆盖拍摄信息读取的结果。 */
  const recordDimensions = (metadata: Metadata, onlyMissing: boolean) => {
    if (!metadata.width || !metadata.height) return false;
    const rotated = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
    options.signal?.throwIfAborted();
    db.transaction(() => {
      options.assertLease();
      db.prepare(`UPDATE files SET width=?,height=?,orientation=COALESCE(?,orientation) WHERE id=? AND size=? AND modified_at=? AND cache_generation=?${onlyMissing ? ' AND (width IS NULL OR height IS NULL)' : ''}`)
        .run(rotated ? metadata.height : metadata.width, rotated ? metadata.width : metadata.height, metadata.orientation ?? null, row.id, row.size, row.modified_at, row.cache_generation);
    }).immediate();
    return true;
  };
  if (task.variant.kind === 'dimensions') {
    if (!recordDimensions(await sharp(filename).metadata(), false)) throw new Error('图片尺寸不可用');
    return;
  }
  const cacheRoot = path.resolve(options.cacheDir);
  const destination = cachePath(cacheRoot, row, task.variant);
  await mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.${randomUUID()}.tmp`;
  const frame = `${temp}.jpg`;
  const decoded = `${temp}.png`;
  let hash: string | null = null;
  try {
    let input = filename;
    if (row.media_type === 'image' && ['.heic', '.heif'].includes(path.extname(row.relative_path).toLowerCase())) {
      await runFfmpeg(db, options.owner, ['-n', '-i', filename, '-map', '0:v:0', '-frames:v', '1', '-threads', '1', '-f', 'image2', '-vcodec', 'png', decoded], options);
      input = decoded;
    }
    if (task.variant.kind === 'thumb') {
      if (row.media_type === 'video') {
        await runFfmpeg(db, options.owner, ['-n', '-i', filename, '-map', '0:v:0', '-frames:v', '1', '-threads', '1', '-f', 'image2', '-vcodec', 'mjpeg', frame], options);
        input = frame;
      }
      const dimension = { s: 256, m: 768, l: 1600 }[task.variant.size];
      await sharp(input).rotate().resize({ width: dimension, height: dimension, fit: 'outside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(temp);
      const placeholder = await sharp(input).rotate().resize({ width: 100, height: 100, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      hash = Buffer.from(rgbaToThumbHash(placeholder.info.width, placeholder.info.height, placeholder.data)).toString('base64');
      // 生成缩略图时顺带记录原始宽高，供网格按原始比例排布；视频帧已由 FFmpeg 按显示方向旋转
      if (!row.width || !row.height) recordDimensions(await sharp(input).metadata(), true);
    } else if (task.variant.kind === 'preview') {
      if (!readSettings(db).previews.enabled) throw new Error('视频预览已关闭');
      const setting = readSettings(db).transcode.hwaccel;
      const probe = db.prepare("SELECT value FROM settings WHERE key='worker.ffmpeg'").get() as { value: string } | undefined;
      let nvenc = false;
      try { nvenc = (setting === 'auto' || setting === 'nvenc') && !!probe && JSON.parse(probe.value).encoder === 'nvenc'; } catch { nvenc = false; }
      const common = ['-n', '-i', filename, '-map', '0:v:0', '-t', '5', '-an', '-vf', 'scale=640:-2', '-pix_fmt', 'yuv420p'];
      const encode = (hardware: boolean) => runFfmpeg(db, options.owner, [...common,
        ...(hardware ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '30'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30']),
        '-movflags', '+faststart', '-f', 'mp4', temp], options);
      if (nvenc) {
        try { await encode(true); }
        catch { options.signal?.throwIfAborted(); options.assertLease(); await unlink(temp).catch(() => {}); await encode(false); }
      } else await encode(false);
    } else if (task.variant.kind === 'display') {
      await sharp(input).rotate().webp({ quality: 90 }).toFile(temp);
    } else {
      if (!row.width || !row.height || Math.max(row.width, row.height) <= 8192) throw new Error('媒体不支持深度缩放');
      const maxLevel = Math.ceil(Math.log2(Math.max(row.width, row.height)));
      if (task.variant.level > maxLevel) throw new Error('瓦片层级无效');
      const scale = 2 ** (maxLevel - task.variant.level);
      const width = Math.ceil(row.width / scale); const height = Math.ceil(row.height / scale);
      const left = task.variant.col * 256; const top = task.variant.row * 256;
      if (left >= width || top >= height) throw new Error('瓦片位置无效');
      await sharp(input).rotate().resize(width, height, { fit: 'fill' }).extract({ left, top, width: Math.min(256, width - left), height: Math.min(256, height - top) }).webp({ quality: 82 }).toFile(temp);
    }
    options.signal?.throwIfAborted(); options.assertLease();
    const sourceAfter = await stat(filename);
    if (sourceAfter.size !== row.size || Math.floor(sourceAfter.mtimeMs / 1000) !== row.modified_at || (row.mtime_ms !== null && sourceAfter.mtimeMs !== row.mtime_ms)) throw new Error('媒体已变化');
    const current = db.prepare('SELECT size,modified_at,cache_generation FROM files WHERE id=? AND missing_at_ms IS NULL').get(row.id) as { size: number; modified_at: number; cache_generation: number } | undefined;
    if (!current || current.size !== row.size || current.modified_at !== row.modified_at || current.cache_generation !== row.cache_generation) throw new Error('媒体已变化');
    await rename(temp, destination);
    const output = await stat(destination);
    db.transaction(() => {
      options.assertLease();
      if (!db.prepare('SELECT 1 FROM files WHERE id=? AND size=? AND modified_at=? AND cache_generation=? AND missing_at_ms IS NULL').get(row.id, row.size, row.modified_at, row.cache_generation)) throw new Error('媒体已变化');
      db.prepare(`INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at,media_id,variant,source_size,source_modified) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(cache_key) DO UPDATE SET bytes=excluded.bytes,last_access_at=excluded.last_access_at,media_id=excluded.media_id,variant=excluded.variant,source_size=excluded.source_size,source_modified=excluded.source_modified`)
        .run(cacheKey(row, task.variant), path.relative(cacheRoot, destination), output.size, Date.now(), row.id, task.variant.kind, row.size, row.modified_at);
      if (hash) db.prepare('UPDATE files SET thumbhash=?,thumb_ready=1,thumb_version=CASE WHEN thumb_version=0 THEN 1 ELSE thumb_version END WHERE id=? AND size=? AND modified_at=? AND cache_generation=?')
        .run(hash, row.id, row.size, row.modified_at, row.cache_generation);
      if (hash) noteThumbnail(db, row.id);
      if (task.variant.kind === 'preview') db.prepare('UPDATE files SET has_preview=1 WHERE id=? AND size=? AND modified_at=? AND cache_generation=?').run(row.id, row.size, row.modified_at, row.cache_generation);
    }).immediate();
  } finally { await unlink(temp).catch(() => {}); await unlink(frame).catch(() => {}); await unlink(decoded).catch(() => {}); }
}
