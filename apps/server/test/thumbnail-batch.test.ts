import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/core/database.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { runNextJob } from '../src/worker/runner.ts';
import { cachePath } from '../src/core/media-cache.ts';

test('全库缩略图作业直接生成网格两种尺寸，可重复运行并修复丢失的缓存文件', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-batch-')); const cache = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-batch-cache-'));
  const db = openDatabase(':memory:');
  try {
    await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#789' } }).jpeg().toFile(path.join(root, 'photo.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const run = async (id: string) => {
      db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES (?,'thumbnails','生成缩略图','queued','manual',?,1)").run(id, JSON.stringify({ libraryId: 'lib' }));
      await runNextJob(db, options);
      const job = db.prepare('SELECT status,result,progress_done,progress_total FROM jobs WHERE id=?').get(id) as { status: string; result: string; progress_done: number; progress_total: number };
      assert.equal(job.status, 'succeeded'); assert.equal(job.progress_done, 1); assert.equal(job.progress_total, 1);
      return JSON.parse(job.result) as { generated: number; repaired: number; failed: number };
    };
    const options = { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache };
    assert.deepEqual(await run('bulk'), { total: 1, done: 1, generated: 2, repaired: 0, failed: 0 });
    // 不再为每个文件、每个尺寸单独排队作业
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails'").get() as { n: number }).n, 1);
    const source = db.prepare('SELECT id,size,modified_at FROM files').get() as { id: string; size: number; modified_at: number };
    for (const [size, dimension] of [['s', 256], ['m', 768]] as const) {
      const result = await sharp(cachePath(cache, source, { kind: 'thumb', size })).metadata();
      assert.equal(result.height, dimension); assert.ok(result.width! > result.height!);
    }
    assert.equal((db.prepare("SELECT count(*) AS n FROM cache_entries WHERE variant='thumb'").get() as { n: number }).n, 2);
    assert.equal((db.prepare('SELECT thumb_ready FROM files').get() as { thumb_ready: number }).thumb_ready, 1);
    assert.deepEqual(await run('again'), { total: 1, done: 1, generated: 0, repaired: 0, failed: 0 });
    await rm(cachePath(cache, source, { kind: 'thumb', size: 'm' }));
    assert.deepEqual(await run('repair'), { total: 1, done: 1, generated: 1, repaired: 1, failed: 0 });
    assert.ok((await sharp(cachePath(cache, source, { kind: 'thumb', size: 'm' })).metadata()).width);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
