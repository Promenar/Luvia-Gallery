import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/core/database.ts';
import { cachePath, enqueueMediaTask } from '../src/core/media-cache.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { generateMediaCache } from '../src/worker/media-cache.ts';
import { extractMetadataNow } from '../src/worker/metadata.ts';
import { runNextJob } from '../src/worker/runner.ts';

/** 生成 2×2 的 24 位 BMP，无需依赖外部测试素材。 */
function bmp(): Buffer {
  const bytes = Buffer.alloc(70);
  bytes.write('BM'); bytes.writeUInt32LE(bytes.length, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(2, 18); bytes.writeInt32LE(2, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(16, 34);
  for (const offset of [54, 57, 62, 65]) { bytes[offset] = 23; bytes[offset + 1] = 80; bytes[offset + 2] = 210; }
  return bytes;
}

test('BMP 和扩展名不符的 BMP 能生成缩略图并读取原始尺寸', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-source-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-cache-'));
  const db = openDatabase(':memory:');
  try {
    for (const name of ['actual.bmp', 'renamed.png']) await writeFile(path.join(root, name), bmp());
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const rows = db.prepare('SELECT id,name,size,modified_at,cache_generation FROM files ORDER BY name').all() as { id: string; name: string; size: number; modified_at: number; cache_generation: number }[];
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(await extractMetadataNow(db, row.id), true);
      assert.deepEqual(db.prepare('SELECT metadata_status,width,height FROM files WHERE id=?').get(row.id), { metadata_status: 'done', width: 2, height: 2 });
      const variant = { kind: 'thumb', size: 's' } as const;
      await generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant },
        { owner: 'test', cacheDir: cache, allowedRoots: [root], assertLease: () => {} });
      const info = await sharp(cachePath(cache, row, variant)).metadata();
      assert.equal(info.format, 'webp'); assert.deepEqual([info.width, info.height], [2, 2]);
      const display = { kind: 'display' } as const;
      await generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant: display },
        { owner: 'test', cacheDir: cache, allowedRoots: [root], assertLease: () => {} });
      assert.equal((await sharp(cachePath(cache, row, display)).metadata()).format, 'webp');
      assert.deepEqual(await readFile(path.join(root, row.name)), bmp());
    }
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('定向恢复发布期间出现已有文件时绝不覆盖', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-race-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-cache-'));
  const db = openDatabase(':memory:');
  try {
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#abc' } }).jpeg().toFile(path.join(root, 'photo.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare('UPDATE files SET width=8,height=8').run();
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const variant = { kind: 'thumb', size: 's' } as const;
    const target = cachePath(cache, row, variant);
    let appeared = false;
    await assert.rejects(generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant },
      { owner: 'test', cacheDir: cache, allowedRoots: [root], preserveExisting: true, assertLease: () => { if (db.inTransaction && !appeared) { writeFileSync(target, 'existing'); appeared = true; } } }), { code: 'EEXIST' });
    assert.equal(await readFile(target, 'utf8'), 'existing');
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('可宽松解码的截断 JPEG 能生成缩略图，原文件保持不变', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-jpeg-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-cache-'));
  const db = openDatabase(':memory:');
  try {
    const full = await sharp({ create: { width: 512, height: 384, channels: 3, background: '#8456ba' } }).jpeg().toBuffer();
    const truncated = full.subarray(0, full.length - 2);
    await assert.rejects(sharp(truncated).resize(256).webp().toBuffer(), /premature/i);
    await writeFile(path.join(root, 'partial.jpg'), truncated);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const variant = { kind: 'thumb', size: 's' } as const;
    await generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant },
      { owner: 'test', cacheDir: cache, allowedRoots: [root], assertLease: () => {} });
    assert.equal((await sharp(cachePath(cache, row, variant)).metadata()).format, 'webp');
    assert.deepEqual(await readFile(path.join(root, 'partial.jpg')), truncated);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('多个截断 JPEG 并发恢复时保留原图并发布缩略图', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-parallel-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-cache-'));
  const db = openDatabase(':memory:');
  try {
    const full = await sharp({ create: { width: 512, height: 384, channels: 3, background: '#8456ba' } }).jpeg().toBuffer();
    const truncated = full.subarray(0, full.length - 2);
    await Promise.all(Array.from({ length: 24 }, (_, i) => writeFile(path.join(root, `${i}.jpg`), truncated)));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const rows = db.prepare('SELECT id,name,size,modified_at,cache_generation FROM files').all() as { id: string; name: string; size: number; modified_at: number; cache_generation: number }[];
    const variant = { kind: 'thumb', size: 's' } as const;
    await Promise.all(rows.map((row) => generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant },
      { owner: 'test', cacheDir: cache, allowedRoots: [root], assertLease: () => {} })));
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 24);
    assert.deepEqual(await readFile(path.join(root, rows[0]!.name)), truncated);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('无法解码的图片报告可理解的失败原因，且不发布缓存', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-empty-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-cache-'));
  const db = openDatabase(':memory:');
  try {
    await writeFile(path.join(root, 'empty.jpg'), '');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const id = enqueueMediaTask(db, row, { kind: 'thumb', size: 's' });
    await runNextJob(db, { owner: 'test', cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
    const job = db.prepare('SELECT status,error FROM jobs WHERE id=?').get(id) as { status: string; error: string };
    assert.equal(job.status, 'failed');
    assert.match(job.error, /媒体处理失败/);
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
    assert.equal((await readFile(path.join(root, 'empty.jpg'))).length, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('损坏的 PNG 不进入 JPEG 宽松恢复', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-png-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-cache-'));
  const db = openDatabase(':memory:');
  try {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#abc' } }).png().toBuffer();
    const idat = png.indexOf('IDAT'); const length = png.readUInt32BE(idat - 4);
    png[idat + 4 + length] = png[idat + 4 + length]! ^ 1;
    await writeFile(path.join(root, 'broken.png'), png);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    await assert.rejects(generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant: { kind: 'thumb', size: 's' } },
      { owner: 'test', cacheDir: cache, allowedRoots: [root], assertLease: () => {} }));
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
