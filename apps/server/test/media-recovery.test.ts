import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { openDatabase } from '../src/core/database.ts';
import { cacheKey, cachePath, enqueueMediaTask } from '../src/core/media-cache.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { generateMediaCache } from '../src/worker/media-cache.ts';
import { extractMetadataNow } from '../src/worker/metadata.ts';
import { runNextJob } from '../src/worker/runner.ts';
import { JobQueue } from '../src/core/jobs.ts';

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

test('已领取的普通作业合并定向恢复后不会覆盖新出现的缓存', async () => {
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
    const queued = enqueueMediaTask(db, row, variant);
    assert.equal(new JobQueue(db, 'worker').claim()?.id, queued);
    assert.equal(enqueueMediaTask(db, row, variant, { preserveUnindexed: true }), queued);
    let appeared = false;
    await assert.rejects(generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant },
      { owner: 'test', cacheDir: cache, allowedRoots: [root], assertLease: () => { if (db.inTransaction && !appeared) { writeFileSync(target, 'existing'); appeared = true; } } }), { code: 'EEXIST' });
    assert.equal(await readFile(target, 'utf8'), 'existing');
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('普通缩略图发布也保留未登记的既有缓存', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-orphan-normal-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-orphan-cache-'));
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
      { owner: 'test', cacheDir: cache, allowedRoots: [root], assertLease: () => { if (db.inTransaction && !appeared) { writeFileSync(target, 'existing'); appeared = true; } } }), { code: 'EEXIST' });
    assert.equal(await readFile(target, 'utf8'), 'existing');
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('浏览请求在生成期间登记旧缓存时仍保留旧缓存', async () => {
  const { createApp } = await import('../src/api/app.ts');
  const { writeSettings } = await import('../src/core/settings.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-orphan-browser-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-orphan-browser-cache-'));
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  try {
    await sharp({ create: { width: 16, height: 16, channels: 3, background: '#abc' } }).jpeg().toFile(path.join(root, 'photo.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    writeSettings(db, { workers: { thumbnailConcurrency: 1 } });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const variant = { kind: 'thumb', size: 's' } as const;
    const target = cachePath(cache, row, variant);
    await mkdir(path.dirname(target), { recursive: true });
    const existing = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#f00' } }).webp().toBuffer();
    await writeFile(target, existing);
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const headers = { cookie: (setup.headers['set-cookie'] as string).split(';')[0]! };
    const job = enqueueMediaTask(db, row, variant);
    db.prepare("INSERT INTO ffmpeg_slots(id,owner,lease_expires_at,kind) VALUES ('occupied','other',unixepoch()+30,'thumbnail')").run();
    const work = runNextJob(db, { owner: 'worker', cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
    const locked = db.prepare('SELECT 1 FROM media_generation_locks WHERE cache_key=?');
    for (let i = 0; i < 100 && !locked.get(`media:${cacheKey(row, variant)}`); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(locked.get(`media:${cacheKey(row, variant)}`));
    const response = await app.inject({ method: 'GET', url: `/api/v2/media/${row.id}/thumb?size=s`, headers });
    db.prepare("DELETE FROM ffmpeg_slots WHERE id='occupied'").run();
    await work;
    assert.equal(response.statusCode, 200);
    assert.deepEqual(await readFile(target), existing);
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 1);
    assert.deepEqual(db.prepare('SELECT status,result FROM jobs WHERE id=?').get(job), { status: 'succeeded', result: '{"generated":0}' });
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
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

test('PNG 校验错误可恢复时发布缩略图并记录质量提示', async () => {
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
    const result = await generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant: { kind: 'thumb', size: 's' } },
      { owner: 'test', cacheDir: cache, allowedRoots: [root], assertLease: () => {} });
    assert.equal(result.partialDecode, true);
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 1);
    assert.deepEqual(db.prepare('SELECT error_code,category FROM media_failures').get(), { error_code: 'PARTIAL_DECODE', category: 'decode' });
    assert.deepEqual(await readFile(path.join(root, 'broken.png')), png);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('部分解码的缓存发布后中断，重新浏览仍保留质量提示', async () => {
  const { createApp } = await import('../src/api/app.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-partial-crash-source-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-partial-crash-cache-'));
  const db = openDatabase(':memory:');
  try {
    const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#abc' } }).png().toBuffer();
    const idat = png.indexOf('IDAT'); const length = png.readUInt32BE(idat - 4);
    png[idat + 4 + length] = png[idat + 4 + length]! ^ 1;
    await writeFile(path.join(root, 'partial.png'), png);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const variant = { kind: 'thumb', size: 's' } as const;
    const interrupted = new Proxy(db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        if (sql.includes('INSERT INTO cache_entries')) throw new Error('模拟缓存发布后中断');
        return target.prepare(sql);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(generateMediaCache(interrupted, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant },
      { owner: 'test', cacheDir: cache, allowedRoots: [root], assertLease: () => {} }), /模拟缓存发布后中断/);
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
    assert.ok((await readFile(cachePath(cache, row, variant))).length > 0);
    assert.equal((db.prepare('SELECT error_code FROM media_failures WHERE media_id=?').get(row.id) as { error_code: string }).error_code, 'PARTIAL_DECODE');
    for (const preserveUnindexed of [true, false]) {
      const job = enqueueMediaTask(db, row, variant, { preserveUnindexed });
      await runNextJob(db, { owner: 'worker', cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
      assert.ok(['succeeded', 'failed'].includes((db.prepare('SELECT status FROM jobs WHERE id=?').get(job) as { status: string }).status));
      assert.deepEqual(db.prepare('SELECT error_code,failures FROM media_failures WHERE media_id=?').get(row.id), { error_code: 'PARTIAL_DECODE', failures: 0 });
    }
    const app = await createApp({ db, legacyPending: false, cacheDir: cache });
    try {
      const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
      const headers = { cookie: (setup.headers['set-cookie'] as string).split(';')[0]! };
      const response = await app.inject({ method: 'GET', url: `/api/v2/media/${row.id}/thumb?size=s`, headers });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(db.prepare('SELECT error_code,ignored FROM media_failures WHERE media_id=?').get(row.id), { error_code: 'PARTIAL_DECODE', ignored: 0 });
    } finally { await app.close(); }
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('扩展名为 PNG 的视频容器按实际内容解帧', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-content-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-cache-'));
  const db = openDatabase(':memory:');
  try {
    const original = path.join(root, 'original.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=32x32', '-frames:v', '1', '-c:v', 'libx265', '-x265-params', 'pools=1:frame-threads=1:log-level=error', '-f', 'mp4', original]);
    const bytes = await readFile(original);
    await rm(original);
    await writeFile(path.join(root, 'renamed.png'), bytes);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const variant = { kind: 'thumb', size: 's' } as const;
    await generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant },
      { owner: 'test', cacheDir: cache, allowedRoots: [root], assertLease: () => {} });
    assert.equal((await sharp(cachePath(cache, row, variant)).metadata()).format, 'webp');
    assert.deepEqual(await readFile(path.join(root, 'renamed.png')), bytes);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('视频流没有数据包时，预览任务报告可操作的失败原因', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-empty-video-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-cache-'));
  const db = openDatabase(':memory:');
  try {
    const filename = path.join(root, 'no-frames.avi');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=32x32', '-frames:v', '0', '-c:v', 'mpeg4', '-f', 'avi', filename]);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const id = enqueueMediaTask(db, row, { kind: 'preview' });
    await runNextJob(db, { owner: 'test', cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
    const job = db.prepare('SELECT status,error FROM jobs WHERE id=?').get(id) as { status: string; error: string };
    assert.equal(job.status, 'failed');
    assert.match(job.error, /未发现可读取的视频包/);
    const thumbJob = enqueueMediaTask(db, row, { kind: 'thumb', size: 's' });
    await runNextJob(db, { owner: 'test', cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
    const failure = db.prepare("SELECT reason,category FROM media_failures WHERE media_id=? AND operation='thumb:s'").get(row.id) as { reason: string; category: string };
    assert.equal((db.prepare('SELECT status FROM jobs WHERE id=?').get(thumbJob) as { status: string }).status, 'failed');
    assert.match(failure.reason, /未发现可读取的视频包/); assert.equal(failure.category, 'decode');
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('损坏的音轨不阻止读取视频拍摄时间，且不虚报音轨和时长', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-bad-audio-'));
  const db = openDatabase(':memory:');
  try {
    const filename = path.join(root, 'audio.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=64x64:r=10', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100',
      '-t', '1', '-metadata', 'creation_time=2020-01-02T03:04:05Z', '-c:v', 'libx264', '-c:a', 'aac', '-f', 'mp4', filename]);
    const bytes = await readFile(filename);
    const index = bytes.indexOf(Buffer.from('05808080051208', 'hex'));
    assert.ok(index >= 0, 'AAC 测试数据缺少预期配置');
    bytes[index + 5] = bytes[index + 5]! & 7;
    await writeFile(filename, bytes);
    await writeFile(path.join(root, 'audio-with-dimensions.mp4'), bytes);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare("SELECT id FROM files WHERE name='audio.mp4'").get() as { id: string };
    const prior = db.prepare("SELECT id FROM files WHERE name='audio-with-dimensions.mp4'").get() as { id: string };
    db.prepare('UPDATE files SET width=96,height=64 WHERE id=?').run(prior.id);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('repair','metadata','重试','queued','manual',?,1)")
      .run(JSON.stringify({ libraryId: 'lib', recovery: true, recoveryIds: [row.id, prior.id] }));
    const background = runNextJob(db, { owner: 'test', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: root });
    await extractMetadataNow(db, row.id);
    await background;
    const result = db.prepare('SELECT taken_at,taken_at_source,width,height,audio_codec,duration_sec,container,playability FROM files WHERE id=?').get(row.id);
    assert.deepEqual(result, { taken_at: Date.parse('2020-01-02T03:04:05Z') / 1000, taken_at_source: 'metadata', width: null, height: null, audio_codec: null, duration_sec: null, container: null, playability: 'unsupported' });
    assert.deepEqual(db.prepare('SELECT width,height FROM files WHERE id=?').get(prior.id), { width: 96, height: 64 });
    assert.deepEqual(await readFile(filename), bytes);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('损坏音轨且没有创建时间时保留失败状态', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-no-date-'));
  const db = openDatabase(':memory:');
  try {
    const filename = path.join(root, 'audio.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=blue:s=64x64:r=10', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=44100',
      '-t', '1', '-c:v', 'libx264', '-c:a', 'aac', '-f', 'mp4', filename]);
    const bytes = await readFile(filename);
    const index = bytes.indexOf(Buffer.from('05808080051208', 'hex'));
    assert.ok(index >= 0);
    bytes[index + 5] = bytes[index + 5]! & 7;
    await writeFile(filename, bytes);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id FROM files').get() as { id: string };
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('repair','metadata','重试','queued','manual',?,1)")
      .run(JSON.stringify({ libraryId: 'lib', recovery: true, recoveryIds: [row.id] }));
    await runNextJob(db, { owner: 'test', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: root });
    assert.equal((db.prepare('SELECT metadata_status FROM files WHERE id=?').get(row.id) as { metadata_status: string }).metadata_status, 'failed');
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
