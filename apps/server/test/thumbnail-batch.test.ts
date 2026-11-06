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

test('全库缩略图作业直接生成网格两种尺寸并记录宽高，可重复运行、修复丢失的缓存文件并单独补全宽高', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-batch-')); const cache = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-batch-cache-'));
  const db = openDatabase(':memory:');
  try {
    await sharp({ create: { width: 2400, height: 1800, channels: 3, background: '#789' } }).jpeg().toFile(path.join(root, 'photo.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const run = async (id: string, dimensionsOnly = false) => {
      db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES (?,'thumbnails','生成缩略图','queued','manual',?,1)").run(id, JSON.stringify({ libraryId: 'lib', dimensionsOnly }));
      await runNextJob(db, options);
      const job = db.prepare('SELECT status,result,progress_done,progress_total FROM jobs WHERE id=?').get(id) as { status: string; result: string; progress_done: number; progress_total: number };
      assert.equal(job.status, 'succeeded');
      return JSON.parse(job.result) as { generated: number; repaired: number; dimensions: number; failed: number };
    };
    const options = { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache };
    const size = () => db.prepare('SELECT width,height FROM files').get();
    assert.deepEqual(size(), { width: null, height: null });
    assert.deepEqual(await run('bulk'), { total: 1, done: 1, generated: 2, repaired: 0, dimensions: 0, failed: 0 });
    // 生成缩略图时顺带记录原始宽高
    assert.deepEqual(size(), { width: 2400, height: 1800 });
    // 不再为每个文件、每个尺寸单独排队作业
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails'").get() as { n: number }).n, 1);
    const source = db.prepare('SELECT id,size,modified_at FROM files').get() as { id: string; size: number; modified_at: number };
    for (const [size, dimension] of [['s', 256], ['m', 768]] as const) {
      const result = await sharp(cachePath(cache, source, { kind: 'thumb', size })).metadata();
      assert.equal(result.height, dimension); assert.ok(result.width! > result.height!);
    }
    assert.equal((db.prepare("SELECT count(*) AS n FROM cache_entries WHERE variant='thumb'").get() as { n: number }).n, 2);
    assert.equal((db.prepare('SELECT thumb_ready FROM files').get() as { thumb_ready: number }).thumb_ready, 1);
    assert.deepEqual(await run('again'), { total: 1, done: 1, generated: 0, repaired: 0, dimensions: 0, failed: 0 });
    await rm(cachePath(cache, source, { kind: 'thumb', size: 'm' }));
    assert.deepEqual(await run('repair'), { total: 1, done: 1, generated: 1, repaired: 1, dimensions: 0, failed: 0 });
    assert.ok((await sharp(cachePath(cache, source, { kind: 'thumb', size: 'm' })).metadata()).width);
    // 缩略图齐全但没有宽高（例如更早生成的）：全库作业与只补宽高作业都只读取宽高，不重新生成
    db.prepare("UPDATE files SET width=NULL,height=NULL,metadata_status='done'").run();
    assert.deepEqual(await run('fill'), { total: 1, done: 1, generated: 0, repaired: 0, dimensions: 1, failed: 0 });
    assert.deepEqual(size(), { width: 2400, height: 1800 });
    db.prepare('UPDATE files SET width=NULL,height=NULL').run();
    assert.deepEqual(await run('dims', true), { total: 1, done: 1, generated: 0, repaired: 0, dimensions: 1, failed: 0 });
    assert.deepEqual(size(), { width: 2400, height: 1800 });
    // 尚未读取拍摄信息的文件：后台拍摄信息作业正在读取时跳过，否则读取全部拍摄信息
    db.prepare("UPDATE files SET width=NULL,height=NULL,metadata_status='pending'").run();
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('meta','metadata','提取元数据','running','system','{}',1)").run();
    db.prepare("INSERT INTO metadata_claims(file_id,job_id,owner,lease_expires_at) VALUES (?,'meta','other',?)").run(source.id, Math.floor(Date.now() / 1000) + 60);
    assert.deepEqual(await run('claimed', true), { total: 1, done: 1, generated: 0, repaired: 0, dimensions: 0, failed: 0 });
    assert.deepEqual(size(), { width: null, height: null });
    db.prepare('DELETE FROM metadata_claims').run();
    assert.deepEqual(await run('pending', true), { total: 1, done: 1, generated: 0, repaired: 0, dimensions: 1, failed: 0 });
    assert.deepEqual(db.prepare('SELECT width,height,metadata_status FROM files').get(), { width: 2400, height: 1800, metadata_status: 'done' });
    assert.equal((db.prepare('SELECT count(*) AS n FROM metadata_claims').get() as { n: number }).n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('全库缩略图分轮查询沿 id 索引顺序读取，统计信息失真时也不对全表临时排序', async () => {
  const { backfillRowsSql } = await import('../src/worker/thumbnail-backfill.ts');
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/synthetic')").run();
    // 生产统计：媒体库只有 2 个时 library_id 被估为每值 2001 行，规划器改走媒体库索引再临时排序
    db.exec('ANALYZE'); db.exec("DELETE FROM sqlite_stat1 WHERE tbl IN ('files','libraries')");
    const stat = db.prepare('INSERT INTO sqlite_stat1(tbl,idx,stat) VALUES (?,?,?)');
    for (const [idx, value] of [['files_library_metadata_recent', '937858 2001 2001 1'], ['files_library', '937858 2001 2001'], ['files_type_taken', '937858 2001 2 1'], ['sqlite_autoindex_files_1', '937858 1']]) stat.run('files', idx, value);
    stat.run('libraries', 'sqlite_autoindex_libraries_1', '2 1');
    db.exec('ANALYZE sqlite_schema');
    for (const byLibrary of [false, true]) for (const dimensionsOnly of [false, true]) {
      const args = [...(byLibrary ? ['lib'] : []), '', 256];
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${backfillRowsSql(byLibrary, dimensionsOnly)}`).all(...args) as { detail: string }[]).map((row) => row.detail).join(' | ');
      assert.match(plan, /SEARCH f USING INDEX sqlite_autoindex_files_1 \(id>\?\)/, plan);
      assert.doesNotMatch(plan, /TEMP B-TREE/, plan);
    }
  } finally { db.close(); }
});

test('多个通道同时在 WAL 让路处等待时不会争抢到空任务，作业正常完成', async () => {
  const { setWalPressure } = await import('../src/worker/wal-checkpoint.ts');
  const { writeSettings } = await import('../src/core/settings.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-race-')); const cache = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-race-cache-'));
  const db = openDatabase(':memory:');
  try {
    for (const name of ['a', 'b', 'c']) await sharp({ create: { width: 64, height: 48, channels: 3, background: '#789' } }).jpeg().toFile(path.join(root, `${name}.jpg`));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    writeSettings(db, { workers: { metadataConcurrency: 2 } });
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('dims','thumbnails','补全照片宽高','queued','manual',?,1)").run(JSON.stringify({ libraryId: 'lib', dimensionsOnly: true }));
    // 两个通道先在让路处等待，放行后各取一个任务并立即再次进入积压：处理完后都会回到让路处等待，
    // 此时只剩一个任务，放行后若醒来才取任务，其中一个通道会取到空任务
    setWalPressure(true);
    setTimeout(() => { setWalPressure(false); setWalPressure(true); }, 50);
    setTimeout(() => setWalPressure(false), 1500);
    await runNextJob(db, { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache });
    const job = db.prepare("SELECT status,result FROM jobs WHERE id='dims'").get() as { status: string; result: string };
    assert.equal(job.status, 'succeeded');
    assert.equal(JSON.parse(job.result).failed, 0);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files WHERE width IS NULL').get() as { n: number }).n, 0);
  } finally { setWalPressure(false); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
