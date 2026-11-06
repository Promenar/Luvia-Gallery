import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { rgbaToThumbHash, thumbHashToRGBA } from 'thumbhash';
import { openDatabase } from '../src/core/database.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { generateMediaCache } from '../src/worker/media-cache.ts';

test('缩略图占位图保留原图的颜色与旋转方向', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-thumbhash-source-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-thumbhash-cache-')); const db = openDatabase(':memory:');
  try {
    const width = 600, height = 400; const pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3; pixels[i] = Math.round(x * 255 / (width - 1)); pixels[i + 1] = Math.round(y * 255 / (height - 1)); pixels[i + 2] = 180;
    }
    const filename = path.join(root, 'oriented.jpg');
    await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toFile(filename);
    const reference = await sharp(filename).rotate().resize({ width: 100, height: 100, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const expected = rgbaToThumbHash(reference.info.width, reference.info.height, reference.data);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    await generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant: { kind: 'thumb', size: 's' } },
      { owner: 'worker', cacheDir: cache, allowedRoots: [root], assertLease: () => {} });
    const stored = (db.prepare('SELECT thumbhash FROM files WHERE id=?').get(row.id) as { thumbhash: string }).thumbhash;
    const decode = async (hash: Uint8Array) => {
      const image = thumbHashToRGBA(hash);
      return sharp(Buffer.from(image.rgba), { raw: { width: image.w, height: image.h, channels: 4 } }).resize(32, 32).removeAlpha().raw().toBuffer();
    };
    const before = await decode(expected); const after = await decode(Buffer.from(stored, 'base64'));
    const meanError = before.reduce((sum, value, i) => sum + Math.abs(value - after[i]!), 0) / before.length;
    // ThumbHash 本身是模糊占位，量化后每通道平均误差须低于 8/255。
    assert.ok(meanError < 8, `占位图平均色差过大：${meanError.toFixed(2)}`);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('透明长图的占位图保持原图的透明度和颜色', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-thumbhash-alpha-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-thumbhash-alpha-cache-')); const db = openDatabase(':memory:');
  try {
    const width = 400, height = 1200; const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4; pixels[i] = x < 133 ? 255 : 0; pixels[i + 1] = x >= 133 && x < 266 ? 255 : 0;
      pixels[i + 2] = x >= 266 ? 255 : 0; pixels[i + 3] = Math.round(y * 255 / (height - 1));
    }
    const filename = path.join(root, 'alpha.png');
    await sharp(pixels, { raw: { width, height, channels: 4 } }).png().toFile(filename);
    const original = await sharp(filename).rotate().resize({ width: 100, height: 100, fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const expected = Buffer.from(rgbaToThumbHash(original.info.width, original.info.height, original.data)).toString('base64');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    await generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant: { kind: 'thumb', size: 's' } },
      { owner: 'worker', cacheDir: cache, allowedRoots: [root], assertLease: () => {} });
    assert.equal((db.prepare('SELECT thumbhash FROM files WHERE id=?').get(row.id) as { thumbhash: string }).thumbhash, expected);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
