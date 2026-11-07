import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/core/database.ts';
import { cachePath } from '../src/core/media-cache.ts';
import { enqueueMetadata, runNextJob } from '../src/worker/runner.ts';
import { recoverMissingMedia } from '../src/worker/media-recovery.ts';

test('定向恢复只领取非空失败项，不覆盖已有缓存且重复执行不重复排队', async () => {
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-queue-'));
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试','/synthetic')").run();
    const add = db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,thumb_ready,metadata_status)
      VALUES (?,'lib',?,'lib',?,'image/jpeg','image',?,10,10,'mtime',?,?)`);
    add.run('recover', 'recover.jpg', 'recover.jpg', 10, 0, 'failed');
    add.run('ready', 'ready.jpg', 'ready.jpg', 10, 1, 'done');
    add.run('orphan', 'orphan.jpg', 'orphan.jpg', 10, 0, 'done');
    add.run('empty', 'empty.jpg', 'empty.jpg', 0, 0, 'failed');
    const orphan = { id: 'orphan', size: 10, modified_at: 10, cache_generation: 0 };
    const existing = cachePath(cache, orphan, { kind: 'thumb', size: 's' });
    await mkdir(path.dirname(existing), { recursive: true }); await writeFile(existing, 'existing cache');
    const preview = await recoverMissingMedia(db, cache, { apply: false });
    assert.equal(preview.metadataCandidates, 1); assert.equal(preview.thumbnailCandidates, 1);
    assert.equal(preview.skippedExisting, 1); assert.equal(preview.skippedEmpty, 1);
    assert.equal((db.prepare('SELECT count(*) AS n FROM jobs').get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT metadata_status FROM files WHERE id='recover'").get() as { metadata_status: string }).metadata_status, 'failed');
    const applied = await recoverMissingMedia(db, cache, { apply: true });
    assert.equal(applied.metadataReset, 1); assert.equal(applied.thumbnailQueued, 1);
    assert.equal((db.prepare("SELECT metadata_status FROM files WHERE id='recover'").get() as { metadata_status: string }).metadata_status, 'pending');
    assert.equal((db.prepare("SELECT metadata_status FROM files WHERE id='empty'").get() as { metadata_status: string }).metadata_status, 'failed');
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails' AND status='queued'").get() as { n: number }).n, 1);
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='metadata' AND status='queued'").get() as { n: number }).n, 1);
    const again = await recoverMissingMedia(db, cache, { apply: true });
    assert.equal(again.metadataReset, 0); assert.equal(again.thumbnailQueued, 0);
    assert.equal(await readFile(existing, 'utf8'), 'existing cache');
    // 排队之后出现未登记的同名文件时，领取者也不能覆盖它。
    const late = cachePath(cache, { id: 'recover', size: 10, modified_at: 10, cache_generation: 0 }, { kind: 'thumb', size: 's' });
    await mkdir(path.dirname(late), { recursive: true }); await writeFile(late, 'late cache');
    await runNextJob(db, { owner: 'test', cacheDir: cache, allowedRoots: ['/synthetic'], legacyDir: '/synthetic', systemRoots: [] });
    assert.equal(await readFile(late, 'utf8'), 'late cache');
    assert.equal((db.prepare("SELECT status FROM jobs WHERE type='thumbnails'").get() as { status: string }).status, 'succeeded');
  } finally { db.close(); await rm(cache, { recursive: true, force: true }); }
});

test('定向元数据恢复结束后不触发全库视频预览生成', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-no-preview-'));
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('repair','metadata','重试失败元数据','queued','manual',?,1)")
      .run(JSON.stringify({ libraryId: 'lib', recovery: true }));
    await runNextJob(db, { owner: 'test', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: root });
    assert.equal((db.prepare("SELECT status FROM jobs WHERE id='repair'").get() as { status: string }).status, 'succeeded');
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='previews'").get() as { n: number }).n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('定向元数据作业只读取指定文件', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-target-'));
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    for (const id of ['target', 'unrelated']) {
      const file = path.join(root, `${id}.jpg`);
      await sharp({ create: { width: 8, height: 8, channels: 3, background: '#abc' } }).jpeg().toFile(file);
      const info = await stat(file);
      db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,metadata_status)
        VALUES (?,'lib',?,'lib',?,'image/jpeg','image',?,?,1,'mtime','pending')`).run(id, `${id}.jpg`, `${id}.jpg`, info.size, Math.floor(info.mtimeMs / 1000));
    }
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('repair','metadata','重试','queued','manual',?,1)")
      .run(JSON.stringify({ libraryId: 'lib', recovery: true, recoveryIds: ['target'] }));
    await runNextJob(db, { owner: 'test', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: root });
    assert.deepEqual(db.prepare('SELECT id,metadata_status FROM files ORDER BY id').all(), [{ id: 'target', metadata_status: 'done' }, { id: 'unrelated', metadata_status: 'pending' }]);
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='metadata' AND status='queued'").get() as { n: number }).n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('扫描在恢复期间完成时保留后续普通元数据作业', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-deferred-'));
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES ('repair','metadata','重试','queued','manual',?,1,'metadata:lib')")
      .run(JSON.stringify({ libraryId: 'lib', recovery: true, recoveryIds: [] }));
    enqueueMetadata(db, 'lib');
    assert.equal((db.prepare("SELECT json_extract(payload,'$.deferredScan') AS deferred FROM jobs WHERE id='repair'").get() as { deferred: number }).deferred, 1);
    await runNextJob(db, { owner: 'test', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: root });
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='metadata' AND status='queued' AND dedupe_key='metadata:lib'").get() as { n: number }).n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('同库元数据作业运行时不增加并发或重置失败项', async () => {
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-busy-'));
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试','/synthetic')").run();
    db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,thumb_ready,metadata_status)
      VALUES ('a','lib','a.jpg','lib','a.jpg','image/jpeg','image',10,10,10,'mtime',1,'failed')`).run();
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('normal','metadata','读取','queued','manual',?,1)").run(JSON.stringify({ libraryId: 'lib' }));
    const result = await recoverMissingMedia(db, cache, { apply: true });
    assert.equal(result.metadataSkippedBusy, 1); assert.equal(result.metadataReset, 0);
    assert.equal((db.prepare('SELECT metadata_status FROM files').get() as { metadata_status: string }).metadata_status, 'failed');
    assert.equal((db.prepare('SELECT count(*) AS n FROM jobs').get() as { n: number }).n, 1);
  } finally { db.close(); await rm(cache, { recursive: true, force: true }); }
});

test('未登记的既有缩略图被保留供后续核验', async () => {
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-orphan-'));
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试','/synthetic')").run();
    db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,thumb_ready,metadata_status)
      VALUES ('orphan','lib','orphan.jpg','lib','orphan.jpg','image/jpeg','image',10,10,10,'mtime',0,'done')`).run();
    const source = { id: 'orphan', size: 10, modified_at: 10, cache_generation: 0 };
    const filename = cachePath(cache, source, { kind: 'thumb', size: 's' });
    await mkdir(path.dirname(filename), { recursive: true });
    const original = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#abc' } }).webp().toBuffer();
    await writeFile(filename, original);
    const plan = await recoverMissingMedia(db, cache, { apply: false });
    assert.equal(plan.skippedExisting, 1);
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
    const result = await recoverMissingMedia(db, cache, { apply: true });
    assert.equal(result.skippedExisting, 1); assert.equal(result.thumbnailQueued, 0);
    assert.deepEqual(await readFile(filename), original);
    assert.deepEqual(db.prepare("SELECT thumb_ready FROM files WHERE id='orphan'").get(), { thumb_ready: 0 });
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
  } finally { db.close(); await rm(cache, { recursive: true, force: true }); }
});

test('跳过的文件不会使后续批次永久饥饿', async () => {
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-recovery-pages-'));
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试','/synthetic')").run();
    const add = db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,thumb_ready,metadata_status)
      VALUES (?,'lib',?,'lib',?,'image/jpeg','image',?,10,10,'mtime',0,'failed')`);
    for (const [id, size] of [['a', 0], ['b', 0], ['c', 10]] as const) add.run(id, `${id}.jpg`, `${id}.jpg`, size);
    const first = await recoverMissingMedia(db, cache, { apply: true, limit: 2 });
    assert.equal(first.skippedEmpty, 2); assert.equal(first.nextCursor, 'b');
    const second = await recoverMissingMedia(db, cache, { apply: true, limit: 2, after: first.nextCursor! });
    assert.equal(second.metadataReset, 1); assert.equal(second.thumbnailQueued, 1); assert.equal(second.nextCursor, null);
  } finally { db.close(); await rm(cache, { recursive: true, force: true }); }
});
