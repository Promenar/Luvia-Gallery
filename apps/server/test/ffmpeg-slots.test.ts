import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/core/database.ts';
import { writeSettings } from '../src/core/settings.ts';

test('有空余槽位时不回收其他类型或同类型的到期槽位', async () => {
  const { withFfmpegSlot, withThumbnailSlot } = await import('../src/worker/ffmpeg-slots.ts');
  const db = openDatabase(':memory:'); let release!: () => void; let started!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; }); const entered = new Promise<void>((resolve) => { started = resolve; });
  let old: Promise<void> | undefined;
  try {
    writeSettings(db, { workers: { ffmpegConcurrency: 2, thumbnailConcurrency: 1 } });
    old = withFfmpegSlot(db, 'old', async () => { started(); await wait; });
    await entered; db.prepare("UPDATE ffmpeg_slots SET lease_expires_at=0 WHERE owner='old'").run();
    await withThumbnailSlot(db, 'thumb', async () => {});
    assert.equal((db.prepare("SELECT count(*) AS n FROM ffmpeg_slots WHERE owner='old'").get() as { n: number }).n, 1);
    await withFfmpegSlot(db, 'new', async () => {});
    assert.equal((db.prepare("SELECT count(*) AS n FROM ffmpeg_slots WHERE owner='old'").get() as { n: number }).n, 1);
  } finally { release(); await Promise.allSettled([old].filter(Boolean)); db.close(); }
});

test('槽位被接管后旧持有者立即完成也必须失败', async () => {
  const { withFfmpegSlot } = await import('../src/worker/ffmpeg-slots.ts'); const db = openDatabase(':memory:');
  let releaseOld!: () => void; let releaseNew!: () => void; let startedOld!: () => void; let startedNew!: () => void;
  const oldWait = new Promise<void>((r) => { releaseOld = r; }); const newWait = new Promise<void>((r) => { releaseNew = r; });
  const oldStarted = new Promise<void>((r) => { startedOld = r; }); const newStarted = new Promise<void>((r) => { startedNew = r; });
  let old: Promise<void> | undefined; let next: Promise<void> | undefined;
  try {
    writeSettings(db, { workers: { ffmpegConcurrency: 1 } });
    old = withFfmpegSlot(db, 'old', async () => { startedOld(); await oldWait; }); const rejected = assert.rejects(old);
    await oldStarted; db.prepare("UPDATE ffmpeg_slots SET lease_expires_at=0 WHERE owner='old'").run();
    next = withFfmpegSlot(db, 'new', async () => { startedNew(); await newWait; }); await newStarted;
    releaseOld(); await rejected;
    assert.equal((db.prepare("SELECT count(*) AS n FROM ffmpeg_slots WHERE owner='new'").get() as { n: number }).n, 1);
  } finally { releaseOld(); releaseNew(); await Promise.allSettled([old, next].filter(Boolean)); db.close(); }
});

test('缩略图槽位被接管后，持有者可在写入前检查槽位所有权', async () => {
  const { withThumbnailSlot } = await import('../src/worker/ffmpeg-slots.ts'); const db = openDatabase(':memory:');
  let releaseOld!: () => void; let releaseNew!: () => void; let startedOld!: () => void; let startedNew!: () => void;
  const oldWait = new Promise<void>((r) => { releaseOld = r; }); const newWait = new Promise<void>((r) => { releaseNew = r; });
  const oldStarted = new Promise<void>((r) => { startedOld = r; }); const newStarted = new Promise<void>((r) => { startedNew = r; });
  let guard: (() => void) | undefined; let old: Promise<void> | undefined; let next: Promise<void> | undefined; let wrote = false;
  try {
    writeSettings(db, { workers: { thumbnailConcurrency: 1 } });
    old = withThumbnailSlot(db, 'old', async (_signal, assertSlot) => { guard = assertSlot; startedOld(); await oldWait; assertSlot(); wrote = true; });
    const rejected = assert.rejects(old);
    await oldStarted; assert.equal(typeof guard, 'function');
    db.prepare("UPDATE ffmpeg_slots SET lease_expires_at=0 WHERE owner='old'").run();
    next = withThumbnailSlot(db, 'new', async () => { startedNew(); await newWait; }); await newStarted;
    releaseOld(); await rejected; assert.equal(wrote, false);
  } finally { releaseOld(); releaseNew(); await Promise.allSettled([old, next].filter(Boolean)); db.close(); }
});

test('多个 worker 共享 FFmpeg 槽位上限，等待可取消且不会抢占有效租约', async () => {
  const module = await import('../src/worker/ffmpeg-slots.ts').catch(() => null);
  assert.ok(module, 'FFmpeg 全局槽位尚未实现');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-ffmpeg-slots-'));
  const first = openDatabase(path.join(dir, 'db.sqlite')); const second = openDatabase(path.join(dir, 'db.sqlite'));
  try {
    writeSettings(first, { workers: { thumbnailConcurrency: 4, ffmpegConcurrency: 1 } });
    let active = 0; let maximum = 0; let started = 0;
    const operation = async () => { active++; started++; maximum = Math.max(maximum, active); await delay(150); active--; };
    const a = module.withFfmpegSlot(first, 'a', operation);
    await delay(20);
    const b = module.withFfmpegSlot(second, 'b', operation);
    await delay(50);
    assert.equal(started, 1); assert.equal((second.prepare('SELECT count(*) AS n FROM ffmpeg_slots').get() as { n: number }).n, 1);
    const abort = new AbortController();
    const waiting = module.withFfmpegSlot(second, 'c', operation, { signal: abort.signal });
    abort.abort(); await assert.rejects(waiting);
    await Promise.all([a, b]);
    assert.equal(maximum, 1); assert.equal(started, 2);
    assert.equal((first.prepare('SELECT count(*) AS n FROM ffmpeg_slots').get() as { n: number }).n, 0);
    first.prepare("INSERT INTO ffmpeg_slots(id,owner,lease_expires_at) VALUES ('stale','crashed',0)").run();
    await module.withFfmpegSlot(second, 'recovered', async () => { assert.equal((second.prepare("SELECT count(*) AS n FROM ffmpeg_slots WHERE id='stale'").get() as { n: number }).n, 0); });
  } finally { first.close(); second.close(); await rm(dir, { recursive: true, force: true }); }
});

test('取消 FFmpeg 执行会停止进程并释放共享槽位', async () => {
  const { runFfmpeg } = await import('../src/worker/ffmpeg-slots.ts');
  const db = openDatabase(':memory:'); const abort = new AbortController();
  try {
    const running = runFfmpeg(db, 'worker', ['-re', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10', '-t', '30', '-f', 'null', '-'], { signal: abort.signal, timeoutMs: 5000 });
    await delay(100); abort.abort();
    await assert.rejects(running);
    assert.equal((db.prepare('SELECT count(*) AS n FROM ffmpeg_slots').get() as { n: number }).n, 0);
  } finally { db.close(); }
});

test('缩略图槽位按设置限制多个 worker 的并发', async () => {
  const { withThumbnailSlot } = await import('../src/worker/ffmpeg-slots.ts');
  const db = openDatabase(':memory:');
  try {
    writeSettings(db, { workers: { thumbnailConcurrency: 1, ffmpegConcurrency: 2 } });
    let active = 0; let peak = 0;
    const run = () => withThumbnailSlot(db, 'worker', async () => { active++; peak = Math.max(peak, active); await delay(60); active--; });
    await Promise.all([run(), run(), run()]);
    assert.equal(peak, 1);
    assert.equal((db.prepare("SELECT count(*) AS n FROM ffmpeg_slots WHERE kind='thumbnail'").get() as { n: number }).n, 0);
  } finally { db.close(); }
});

test('FFmpeg 槽位到期后未被接管时，持有者可以续租并完成', async () => {
  const { withFfmpegSlot } = await import('../src/worker/ffmpeg-slots.ts');
  const db = openDatabase(':memory:');
  try {
    await withFfmpegSlot(db, 'worker', async (signal) => {
      db.prepare("UPDATE ffmpeg_slots SET lease_expires_at=0 WHERE owner='worker'").run();
      await delay(5200);
      assert.equal(signal.aborted, false, '未被接管的槽位不应中止正在执行的任务');
      assert.equal((db.prepare("SELECT lease_expires_at>unixepoch() AS renewed FROM ffmpeg_slots WHERE owner='worker'").get() as { renewed: number }).renewed, 1);
    });
  } finally { db.close(); }
});

test('FFmpeg 已满时等待者不反复执行槽位清理写事务', async () => {
  const { withFfmpegSlot } = await import('../src/worker/ffmpeg-slots.ts');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-slot-poll-'));
  const filename = path.join(dir, 'db.sqlite'); const first = openDatabase(filename);
  let cleanupWrites = 0;
  const second = new Database(filename, { verbose: (sql) => { if (typeof sql === 'string' && sql.startsWith('DELETE FROM ffmpeg_slots')) cleanupWrites++; } });
  let release!: () => void; let entered!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  let holder: Promise<void> | undefined; let waiter: Promise<void> | undefined;
  try {
    writeSettings(first, { workers: { ffmpegConcurrency: 1 } });
    holder = withFfmpegSlot(first, 'first', async () => { entered(); await blocked; });
    await started;
    waiter = withFfmpegSlot(second, 'second', async () => {});
    await delay(320);
    assert.equal(cleanupWrites, 0, '槽位未释放时不应反复申请写锁清理槽位');
    release(); await Promise.all([holder, waiter]);
  } finally { release(); await Promise.allSettled([holder, waiter].filter(Boolean)); second.close(); first.close(); await rm(dir, { recursive: true, force: true }); }
});

test('到期槽位被其它 worker 接管后，旧持有者中止且不会删除新槽位', async () => {
  const { withFfmpegSlot } = await import('../src/worker/ffmpeg-slots.ts');
  const db = openDatabase(':memory:');
  let releaseOld!: () => void; let releaseNew!: () => void; let startedOld!: () => void; let startedNew!: () => void;
  const oldWait = new Promise<void>((resolve) => { releaseOld = resolve; }); const newWait = new Promise<void>((resolve) => { releaseNew = resolve; });
  const oldStarted = new Promise<void>((resolve) => { startedOld = resolve; }); const newStarted = new Promise<void>((resolve) => { startedNew = resolve; });
  let oldSignal: AbortSignal | undefined; let oldWork: Promise<void> | undefined; let newWork: Promise<void> | undefined;
  try {
    writeSettings(db, { workers: { ffmpegConcurrency: 1 } });
    oldWork = withFfmpegSlot(db, 'old', async (signal) => { oldSignal = signal; startedOld(); await oldWait; });
    const rejected = assert.rejects(oldWork);
    await oldStarted; db.prepare("UPDATE ffmpeg_slots SET lease_expires_at=0 WHERE owner='old'").run();
    newWork = withFfmpegSlot(db, 'new', async () => { startedNew(); await newWait; });
    await newStarted; await delay(5200);
    assert.equal(oldSignal?.aborted, true);
    releaseOld(); await rejected;
    assert.equal((db.prepare("SELECT count(*) AS n FROM ffmpeg_slots WHERE owner='new'").get() as { n: number }).n, 1);
    releaseNew(); await newWork;
  } finally { releaseOld(); releaseNew(); await Promise.allSettled([oldWork, newWork].filter(Boolean)); db.close(); }
});
