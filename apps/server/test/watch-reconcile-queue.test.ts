import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';

test('监控对账请求跨扫描租约持久保存，锁释放后去重补排', async () => {
  const mod = await import('../src/worker/watch-reconcile-queue.ts').catch(() => null);
  assert.ok(mod, '监控对账队列尚未接入');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-queue-'));
  const db = openDatabase(path.join(dir, 'db.sqlite'));
  try {
    db.prepare("INSERT INTO libraries(id,name,root,enabled) VALUES ('lib','媒体库','/lib',1)").run();
    db.prepare("INSERT INTO scan_locks(library_id,owner,acquired_at,heartbeat_at,lease_expires_at) VALUES ('lib','other',1,1,9999999999)").run();
    mod.requestWatchReconcile(db, 'lib', 'overflow');
    mod.requestWatchReconcile(db, 'lib', 'poll');
    assert.equal(mod.flushWatchReconciles(db), 0);
    assert.equal((db.prepare("SELECT count(*) n FROM jobs WHERE type='scan'").get() as {n:number}).n, 0);
    db.close();
    const reopened = openDatabase(path.join(dir, 'db.sqlite'));
    try {
      reopened.prepare("DELETE FROM scan_locks WHERE library_id='lib'").run();
      assert.equal(mod.flushWatchReconciles(reopened), 1);
      assert.equal(mod.flushWatchReconciles(reopened), 0);
      const job = reopened.prepare("SELECT id,payload FROM jobs WHERE type='scan' AND status='queued'").get() as {id:string;payload:string};
      assert.deepEqual(JSON.parse(job.payload), { libraryId: 'lib' });
      reopened.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job.id);
      mod.requestWatchReconcile(reopened, 'lib', 'during-scan');
      assert.equal(mod.flushWatchReconciles(reopened), 0);
      reopened.prepare("UPDATE jobs SET status='succeeded' WHERE id=?").run(job.id);
      assert.equal(mod.flushWatchReconciles(reopened), 1);
    } finally { reopened.close(); }
  } finally { if (db.open) db.close(); await rm(dir, { recursive: true, force: true }); }
});
