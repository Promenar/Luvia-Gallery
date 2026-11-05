import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { requestWatchReconcile, flushWatchReconciles, finishWatchReconcile } from '../src/worker/watch-reconcile-queue.ts';
import { runNextJob } from '../src/worker/runner.ts';
import { WatchCoordinator } from '../src/watch/coordinator.ts';
import { FakeWatcher } from '../src/watch/watcher.ts';
import { sqliteHarness } from './watch-sqlite-harness.ts';

class TestClock {
  time = 0; next = 0; timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.time;
  setTimeout = (fn: () => void, ms: number) => { const id = ++this.next; this.timers.set(id, { at: this.time + ms, fn }); return id; };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  async advance(ms: number, idle: () => Promise<void>) {
    const target = this.time + ms;
    while (true) {
      const first = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!first || first[1].at > target) break;
      this.time = first[1].at; this.timers.delete(first[0]); first[1].fn();
      for (let i = 0; i < 12; i++) await Promise.resolve(); await idle();
    }
    this.time = target; for (let i = 0; i < 12; i++) await Promise.resolve(); await idle();
  }
}

test('监控扫描失败保留请求并按退避重试，记录中文诊断', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-retry-')); const root = path.join(dir, 'media');
  const db = openDatabase(path.join(dir, 'db.sqlite')); const logs: string[] = [];
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    requestWatchReconcile(db, 'lib', 'overflow'); assert.equal(flushWatchReconciles(db), 1);
    await runNextJob(db, { owner: 'worker', allowedRoots: [dir], legacyDir: dir, systemRoots: [], log: (_level, message) => logs.push(message) });
    const failed = db.prepare("SELECT status,error FROM jobs WHERE type='scan'").get() as {status:string;error:string};
    assert.equal(failed.status, 'failed'); assert.match(failed.error, /根目录|挂载/);
    assert.ok(logs.some((value) => /根目录|挂载/.test(value)));
    const request = db.prepare("SELECT next_attempt_at FROM watch_reconcile_requests WHERE library_id='lib'").get() as {next_attempt_at:number} | undefined;
    assert.ok(request); assert.equal(flushWatchReconciles(db, request.next_attempt_at - 1), 0);
    await mkdir(root); assert.equal(flushWatchReconciles(db, request.next_attempt_at), 1);
    await runNextJob(db, { owner: 'worker', allowedRoots: [dir], legacyDir: dir, systemRoots: [] });
    assert.equal(db.prepare("SELECT 1 FROM watch_reconcile_requests WHERE library_id='lib'").get(), undefined);
    assert.ok(db.prepare("SELECT 1 FROM jobs WHERE type='scan' AND status='succeeded'").get());
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('扫描锁拒绝实时写入后只重试脏目录，不排队全量扫描', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-watch-dirty-')); const clock = new TestClock(); const port = sqliteHarness(root, clock);
  const coordinator = new WatchCoordinator({ libraryId: 'lib', root, exclude: [], port, clock, watcher: new FakeWatcher(), missingGraceDays: 7 });
  try {
    await coordinator.start(); port.requests.length = 0;
    port.testDb.prepare("INSERT INTO scan_locks(library_id,owner,acquired_at,lease_expires_at) VALUES ('lib','scanner',unixepoch(),unixepoch()+30)").run();
    await writeFile(path.join(root, 'a.jpg'), 'photo'); await coordinator.reconcileDirectory(''); await clock.advance(3000, () => coordinator.idle());
    assert.deepEqual(port.requests, []); assert.equal(port.records.has('a.jpg'), false);
    port.testDb.prepare("DELETE FROM scan_locks WHERE library_id='lib'").run();
    await clock.advance(6000, () => coordinator.idle());
    assert.ok(port.records.get('a.jpg')?.mediaId); assert.deepEqual(port.requests, []);
  } finally { await coordinator.stop(); port.close(); await rm(root, { recursive: true, force: true }); }
});

test('监控对账失败退避持久化并在一小时封顶', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-backoff-')); const filename = path.join(dir, 'db.sqlite'); let db = openDatabase(filename);
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/media')").run(); requestWatchReconcile(db, 'lib', 'overflow');
    let at = 1000;
    for (const delay of [60, 300, 900, 3600, 3600]) {
      assert.equal(flushWatchReconciles(db, at), 1);
      const job = db.prepare("SELECT id FROM jobs WHERE type='scan' AND status='queued'").get() as {id:string};
      db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(job.id); finishWatchReconcile(db, job.id, false, at);
      db.close(); db = openDatabase(filename);
      assert.equal(flushWatchReconciles(db, at + delay - 1), 0);
      assert.equal((db.prepare('SELECT next_attempt_at FROM watch_reconcile_requests').get() as {next_attempt_at:number}).next_attempt_at, at + delay);
      at += delay;
    }
    assert.equal(flushWatchReconciles(db, at), 1);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});
