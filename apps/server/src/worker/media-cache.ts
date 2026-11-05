import { mkdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import { z } from 'zod';
import { cacheKey, cachePath } from '../core/media-cache.ts';
import { secureMediaPath } from '../core/paths.ts';
import { runFfmpeg } from './ffmpeg-slots.ts';

const Variant = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('thumb'), size: z.enum(['s', 'm', 'l']) }),
  z.object({ kind: z.literal('display') }),
  z.object({ kind: z.literal('dimensions') }),
  z.object({ kind: z.literal('tile'), level: z.number().int().nonnegative(), col: z.number().int().nonnegative(), row: z.number().int().nonnegative() }),
]);
const Task = z.object({ mediaId: z.string().min(1), sourceSize: z.number().int().nonnegative(), sourceModified: z.number().int(), variant: Variant });
const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
export async function generateMediaCache(db: Database.Database, payload: unknown, options: { owner: string; cacheDir: string; allowedRoots: string[]; assertLease: () => void; signal?: AbortSignal }): Promise<void> {
  const task = Task.parse(payload);
  const row = db.prepare(`SELECT f.id,f.size,f.modified_at,f.relative_path,f.media_type,f.width,f.height,l.root FROM files f
    JOIN libraries l ON l.id=f.library_id WHERE f.id=? AND l.enabled=1`).get(task.mediaId) as
    { id: string; size: number; modified_at: number; relative_path: string; media_type: string; width: number | null; height: number | null; root: string } | undefined;
  if (!row || !(row.media_type === 'image' || row.media_type === 'video' && task.variant.kind === 'thumb') || row.size !== task.sourceSize || row.modified_at !== task.sourceModified) throw new Error('媒体已变化或不支持');
  const realRoot = await realpath(row.root);
  const allowed = await Promise.all(options.allowedRoots.map((root) => realpath(root)));
  if (!allowed.some((root) => within(root, realRoot))) throw new Error('媒体库不在挂载内');
  const filename = await secureMediaPath(realRoot, row.relative_path);
  const info = await stat(filename);
  if (info.size !== row.size || Math.floor(info.mtimeMs / 1000) !== row.modified_at) throw new Error('媒体已变化');
  options.signal?.throwIfAborted(); options.assertLease();
  if (task.variant.kind === 'dimensions') {
    const metadata = await sharp(filename).metadata();
    if (!metadata.width || !metadata.height) throw new Error('图片尺寸不可用');
    const rotated = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
    options.signal?.throwIfAborted();
    db.transaction(() => {
      options.assertLease();
      db.prepare('UPDATE files SET width=?,height=?,orientation=? WHERE id=? AND size=? AND modified_at=?')
        .run(rotated ? metadata.height : metadata.width, rotated ? metadata.width : metadata.height, metadata.orientation ?? null, row.id, row.size, row.modified_at);
    }).immediate();
    return;
  }
  const cacheRoot = path.resolve(options.cacheDir);
  const destination = cachePath(cacheRoot, row, task.variant);
  await mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.${randomUUID()}.tmp`;
  const frame = `${temp}.jpg`;
  let hash: string | null = null;
  try {
    if (task.variant.kind === 'thumb') {
      let input = filename;
      if (row.media_type === 'video') {
        await runFfmpeg(db, options.owner, ['-n', '-i', filename, '-map', '0:v:0', '-frames:v', '1', '-threads', '1', '-f', 'image2', '-vcodec', 'mjpeg', frame], options);
        input = frame;
      }
      const dimension = { s: 256, m: 768, l: 1600 }[task.variant.size];
      await sharp(input).rotate().resize({ width: dimension, height: dimension, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toFile(temp);
      const placeholder = await sharp(input).rotate().resize({ width: 100, height: 100, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      hash = Buffer.from(rgbaToThumbHash(placeholder.info.width, placeholder.info.height, placeholder.data)).toString('base64');
    } else if (task.variant.kind === 'display') {
      await sharp(filename).rotate().webp({ quality: 90 }).toFile(temp);
    } else {
      if (!row.width || !row.height || Math.max(row.width, row.height) <= 8192) throw new Error('媒体不支持深度缩放');
      const maxLevel = Math.ceil(Math.log2(Math.max(row.width, row.height)));
      if (task.variant.level > maxLevel) throw new Error('瓦片层级无效');
      const scale = 2 ** (maxLevel - task.variant.level);
      const width = Math.ceil(row.width / scale); const height = Math.ceil(row.height / scale);
      const left = task.variant.col * 256; const top = task.variant.row * 256;
      if (left >= width || top >= height) throw new Error('瓦片位置无效');
      await sharp(filename).rotate().resize(width, height, { fit: 'fill' }).extract({ left, top, width: Math.min(256, width - left), height: Math.min(256, height - top) }).webp({ quality: 82 }).toFile(temp);
    }
    options.signal?.throwIfAborted(); options.assertLease();
    const current = db.prepare('SELECT size,modified_at FROM files WHERE id=?').get(row.id) as { size: number; modified_at: number } | undefined;
    if (!current || current.size !== row.size || current.modified_at !== row.modified_at) throw new Error('媒体已变化');
    await rename(temp, destination);
    const output = await stat(destination);
    db.transaction(() => {
      options.assertLease();
      db.prepare(`INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at) VALUES (?,?,?,?)
        ON CONFLICT(cache_key) DO UPDATE SET bytes=excluded.bytes,last_access_at=excluded.last_access_at`)
        .run(cacheKey(row, task.variant), path.relative(cacheRoot, destination), output.size, Date.now());
      if (hash) db.prepare('UPDATE files SET thumbhash=?,thumb_version=CASE WHEN thumb_version=0 THEN 1 ELSE thumb_version END WHERE id=? AND size=? AND modified_at=?')
        .run(hash, row.id, row.size, row.modified_at);
    }).immediate();
  } finally { await unlink(temp).catch(() => {}); await unlink(frame).catch(() => {}); }
}
