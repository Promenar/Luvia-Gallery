import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/core/database.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { runNextJob } from '../src/worker/runner.ts';

test('批量缩略图作业为媒体排队三种尺寸并可重复运行', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-batch-')); const cache = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-batch-cache-'));
  const db = openDatabase(':memory:');
  try {
    await sharp({ create: { width: 320, height: 240, channels: 3, background: '#789' } }).jpeg().toFile(path.join(root, 'photo.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('bulk','thumbnails','生成缩略图','queued','manual',?,1)").run(JSON.stringify({ libraryId: 'lib' }));
    const options = { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache };
    await runNextJob(db, options);
    const bulk = db.prepare("SELECT status,result FROM jobs WHERE id='bulk'").get() as { status: string; result: string };
    assert.equal(bulk.status, 'succeeded'); assert.equal(JSON.parse(bulk.result).queued, 3);
    for (let index = 0; index < 3; index++) await runNextJob(db, options);
    assert.equal((db.prepare("SELECT count(*) AS n FROM cache_entries WHERE variant='thumb'").get() as { n: number }).n, 3);
    assert.equal((db.prepare('SELECT thumb_ready FROM files').get() as { thumb_ready: number }).thumb_ready, 1);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('again','thumbnails','生成缩略图','queued','manual',?,2)").run(JSON.stringify({ libraryId: 'lib' }));
    await runNextJob(db, options);
    const again = db.prepare("SELECT result FROM jobs WHERE id='again'").get() as { result: string };
    assert.equal(JSON.parse(again.result).queued, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
