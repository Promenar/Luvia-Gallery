import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { runNextJob } from '../src/worker/runner.ts';
import { cancelUnobservedMediaTask, enqueueMediaTask, releaseMediaWaiter } from '../src/core/media-cache.ts';

test('多个客户端共享缩略图作业，最后一个断开时取消 FFmpeg', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-disconnect-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-disconnect-cache-'));
  const bin = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-disconnect-bin-'));
  const data = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-disconnect-data-'));
  const previousPath = process.env.PATH;
  const db = openDatabase(path.join(data, 'test.sqlite')); const workerDb = openDatabase(path.join(data, 'test.sqlite'));
  const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  const abort = new AbortController(); let work: Promise<boolean> | undefined;
  let first: http.ClientRequest | undefined; let second: http.ClientRequest | undefined;
  const wait = async (condition: () => boolean) => {
    for (let index = 0; index < 100; index++) { if (condition()) return; await delay(30); }
    throw new Error('等待缩略图状态超时');
  };
  try {
    await writeFile(path.join(root, 'video.mp4'), 'synthetic video');
    await writeFile(path.join(bin, 'ffmpeg'), '#!/bin/sh\nexec /bin/sleep 30\n');
    await chmod(path.join(bin, 'ffmpeg'), 0o755); process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ''}`;
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','视频',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const { id } = db.prepare('SELECT id FROM files').get() as { id: string };
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const request = () => { const client = http.get(`${address}/api/v2/media/${id}/thumb?size=s`, { headers: { cookie } }); client.on('error', () => {}); return client; };
    first = request(); second = request();
    await wait(() => (db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails'").get() as { n: number }).n === 1);
    await wait(() => (db.prepare('SELECT count(*) AS n FROM media_waiters').get() as { n: number }).n === 2);
    work = runNextJob(workerDb, { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache, signal: abort.signal });
    await wait(() => (db.prepare("SELECT count(*) AS n FROM ffmpeg_slots WHERE kind='ffmpeg'").get() as { n: number }).n === 1);
    first.destroy();
    await wait(() => (db.prepare('SELECT count(*) AS n FROM media_waiters').get() as { n: number }).n === 1);
    assert.equal((db.prepare("SELECT status FROM jobs WHERE type='thumbnails'").get() as { status: string }).status, 'running');
    second.destroy();
    await Promise.race([work, delay(3000, undefined, { ref: false }).then(() => { throw new Error('FFmpeg 未及时停止'); })]);
    assert.equal((db.prepare("SELECT status FROM jobs WHERE type='thumbnails'").get() as { status: string }).status, 'cancelled');
    assert.equal((db.prepare('SELECT count(*) AS n FROM ffmpeg_slots').get() as { n: number }).n, 0);
  } finally {
    first?.destroy(); second?.destroy(); abort.abort(); await work?.catch(() => {});
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    await app.close(); workerDb.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); await rm(bin, { recursive: true, force: true }); await rm(data, { recursive: true, force: true });
  }
});

test('等待租约全部过期的按需生成任务被取消', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/synthetic')").run();
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES ('photo','lib','a.jpg','lib','a.jpg','image/jpeg','image',1,1,1,'mtime')").run();
    const source = { id: 'photo', size: 1, modified_at: 1 };
    const lone = enqueueMediaTask(db, source, { kind: 'display' }, { waiter: 'lone' });
    db.prepare("UPDATE media_waiters SET lease_expires_at=0 WHERE id='lone'").run();
    assert.equal(cancelUnobservedMediaTask(db, lone), true);
    assert.equal((db.prepare('SELECT status FROM jobs WHERE id=?').get(lone) as { status: string }).status, 'cancelled');
  } finally { db.close(); }
});

test('同一缓存键的旧生成尚未退出时，新生成必须等待', async () => {
  const module = await import('../src/worker/media-lock.ts').catch(() => null);
  assert.ok(module, '媒体缓存键租约尚未实现');
  const data = await mkdtemp(path.join(tmpdir(), 'luvia-media-lock-'));
  const db = openDatabase(path.join(data, 'test.sqlite')); const otherDb = openDatabase(path.join(data, 'test.sqlite')); let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let enteredFirst!: () => void; const started = new Promise<void>((resolve) => { enteredFirst = resolve; });
  let active = 0; let peak = 0; let secondStarted = false; const abort = new AbortController();
  try {
    const first = module.withMediaGenerationLock(db, 'worker', 'media:same', async () => { active++; peak = Math.max(peak, active); enteredFirst(); await blocked; active--; }, { signal: abort.signal });
    const firstStopped = assert.rejects(first);
    await started; abort.abort();
    const second = module.withMediaGenerationLock(otherDb, 'worker', 'media:same', async () => { secondStarted = true; active++; peak = Math.max(peak, active); active--; });
    await module.withMediaGenerationLock(otherDb, 'other', 'media:different', async () => {});
    await delay(120); assert.equal(secondStarted, false);
    release(); await Promise.all([firstStopped, second]);
    assert.equal(secondStarted, true); assert.equal(peak, 1);
    db.prepare("INSERT INTO media_generation_locks(cache_key,owner,lease_token,lease_expires_at) VALUES ('stale','dead','old',0)").run();
    await module.withMediaGenerationLock(otherDb, 'worker', 'stale', async () => {});
    assert.equal((db.prepare('SELECT count(*) AS n FROM media_generation_locks').get() as { n: number }).n, 0);
  } finally { release(); otherDb.close(); db.close(); await rm(data, { recursive: true, force: true }); }
});

test('媒体生成锁到期后未被接管时，持有者可以续租并完成', async () => {
  const { withMediaGenerationLock } = await import('../src/worker/media-lock.ts');
  const db = openDatabase(':memory:');
  try {
    await withMediaGenerationLock(db, 'worker', 'media:one', async (signal) => {
      db.prepare("UPDATE media_generation_locks SET lease_expires_at=0 WHERE cache_key='media:one'").run();
      await delay(5200);
      assert.equal(signal.aborted, false, '未被接管的媒体锁不应中止正在执行的任务');
      assert.equal((db.prepare("SELECT lease_expires_at>unixepoch() AS renewed FROM media_generation_locks WHERE cache_key='media:one'").get() as { renewed: number }).renewed, 1);
    });
  } finally { db.close(); }
});

test('到期媒体锁被接管后，旧持有者中止且不会删除新令牌', async () => {
  const { withMediaGenerationLock } = await import('../src/worker/media-lock.ts');
  const db = openDatabase(':memory:');
  let releaseOld!: () => void; let releaseNew!: () => void; let startedOld!: () => void; let startedNew!: () => void;
  const oldWait = new Promise<void>((resolve) => { releaseOld = resolve; }); const newWait = new Promise<void>((resolve) => { releaseNew = resolve; });
  const oldStarted = new Promise<void>((resolve) => { startedOld = resolve; }); const newStarted = new Promise<void>((resolve) => { startedNew = resolve; });
  let oldSignal: AbortSignal | undefined; let oldWork: Promise<void> | undefined; let newWork: Promise<void> | undefined;
  try {
    oldWork = withMediaGenerationLock(db, 'old', 'media:one', async (signal) => { oldSignal = signal; startedOld(); await oldWait; });
    const rejected = assert.rejects(oldWork);
    await oldStarted; db.prepare("UPDATE media_generation_locks SET lease_expires_at=0 WHERE cache_key='media:one'").run();
    newWork = withMediaGenerationLock(db, 'new', 'media:one', async () => { startedNew(); await newWait; });
    await newStarted; await delay(5200);
    assert.equal(oldSignal?.aborted, true);
    releaseOld(); await rejected;
    assert.equal((db.prepare("SELECT count(*) AS n FROM media_generation_locks WHERE owner='new'").get() as { n: number }).n, 1);
    releaseNew(); await newWork;
  } finally { releaseOld(); releaseNew(); await Promise.allSettled([oldWork, newWork].filter(Boolean)); db.close(); }
});

test('媒体锁被接管后旧持有者立即完成也必须失败', async () => {
  const { withMediaGenerationLock } = await import('../src/worker/media-lock.ts'); const db = openDatabase(':memory:');
  let releaseOld!: () => void; let releaseNew!: () => void; let startedOld!: () => void; let startedNew!: () => void;
  const oldWait = new Promise<void>((r) => { releaseOld = r; }); const newWait = new Promise<void>((r) => { releaseNew = r; });
  const oldStarted = new Promise<void>((r) => { startedOld = r; }); const newStarted = new Promise<void>((r) => { startedNew = r; });
  let old: Promise<void> | undefined; let next: Promise<void> | undefined;
  try {
    old = withMediaGenerationLock(db, 'old', 'media:one', async () => { startedOld(); await oldWait; }); const rejected = assert.rejects(old);
    await oldStarted; db.prepare("UPDATE media_generation_locks SET lease_expires_at=0 WHERE cache_key='media:one'").run();
    next = withMediaGenerationLock(db, 'new', 'media:one', async () => { startedNew(); await newWait; }); await newStarted;
    releaseOld(); await rejected;
    assert.equal((db.prepare("SELECT count(*) AS n FROM media_generation_locks WHERE owner='new'").get() as { n: number }).n, 1);
  } finally { releaseOld(); releaseNew(); await Promise.allSettled([old, next].filter(Boolean)); db.close(); }
});
