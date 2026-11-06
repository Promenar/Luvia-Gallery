import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { JobQueue } from '../src/core/jobs.ts';

test('作业租约只允许过期接管，并在接管后保留断点', async () => {
  const module = await import('../src/core/jobs.ts').catch(() => null);
  assert.ok(module, '作业租约模块尚未实现');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-jobs-'));
  const filename = path.join(dir, 'luvia.db');
  const first = openDatabase(filename);
  const second = openDatabase(filename);
  try {
    first.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('job','scan','扫描','queued','manual',100)").run();
    const a = new module.JobQueue(first, 'worker-a');
    const b = new module.JobQueue(second, 'worker-b');
    assert.equal(a.claim(100)?.id, 'job');
    assert.equal(a.saveCheckpoint('job', { directory: 'a/b' }, 101), true);
    assert.equal(b.claim(110), null);
    assert.equal(a.renew('job', 105), true);
    assert.equal(b.claim(131), null);
    const taken = b.claim(136);
    assert.equal(taken?.id, 'job');
    assert.deepEqual(JSON.parse(taken!.checkpoint!), { directory: 'a/b' });
    assert.equal(a.saveCheckpoint('job', { directory: 'lost' }, 137), false);
    assert.equal(a.finish('job', { added: 99 }, 137), false);
    assert.equal(b.finish('job', { added: 1 }, 137), true);
    const job = first.prepare("SELECT status,result FROM jobs WHERE id='job'").get() as { status: string; result: string };
    assert.equal(job.status, 'succeeded');
    assert.deepEqual(JSON.parse(job.result), { added: 1 });
  } finally { first.close(); second.close(); await rm(dir, { recursive: true, force: true }); }
});

test('两个实例竞争同一排队作业时最多一个实例领取', async () => {
  const module = await import('../src/core/jobs.ts').catch(() => null);
  assert.ok(module, '作业租约模块尚未实现');
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('job','scan','扫描','queued','manual',100)").run();
    const a = new module.JobQueue(db, 'worker-a');
    const b = new module.JobQueue(db, 'worker-b');
    const claims = await Promise.all([Promise.resolve().then(() => a.claim(100)), Promise.resolve().then(() => b.claim(100))]);
    assert.equal(claims.filter(Boolean).length, 1);
  } finally { db.close(); }
});

test('同一 worker 的暂停恢复与取消重试不会让旧执行继续写入', async () => {
  const { JobQueue } = await import('../src/core/jobs.ts'); const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('job','scan','扫描','queued','manual',100)").run();
    const previous = new JobQueue(db, 'same-worker'); const resumed = new JobQueue(db, 'same-worker');
    assert.equal(previous.claim(100)?.id, 'job');
    db.prepare("UPDATE jobs SET status='paused',owner=NULL,lease_expires_at=NULL WHERE id='job'").run();
    db.prepare("UPDATE jobs SET status='queued' WHERE id='job'").run();
    assert.equal(resumed.claim(101)?.id, 'job');
    assert.equal(previous.active('job', 102), false);
    assert.equal(previous.renew('job', 102), false);
    assert.equal(previous.saveCheckpoint('job', { stale: 1 }, 102), false);
    assert.equal(previous.finish('job', { stale: 1 }, 102), false);
    assert.equal(previous.fail('job', '失效', 102), false);
    assert.equal(resumed.active('job', 102), true);
    db.prepare("UPDATE jobs SET status='cancelled',owner=NULL,lease_expires_at=NULL WHERE id='job'").run();
    db.prepare("UPDATE jobs SET status='queued' WHERE id='job'").run();
    const retried = new JobQueue(db, 'same-worker'); assert.equal(retried.claim(103)?.id, 'job');
    assert.equal(resumed.active('job', 104), false);
    assert.equal(resumed.release('job', 104), false);
    assert.equal(retried.finish('job', { ok: 1 }, 104), true);
  } finally { db.close(); }
});

test('租约过期但未被接管时原持有者仍可续租与收尾', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('job','metadata','提取','queued','manual',100)").run();
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('other','metadata','提取','queued','manual',100)").run();
    const a = new JobQueue(db, 'worker-a'); const b = new JobQueue(db, 'worker-b');
    assert.equal(a.claim(100)?.id, 'job');
    // 主线程卡住超过租期（30 秒）后恢复：没有其它领取者接管
    assert.equal(a.active('job', 140), true);
    assert.equal(a.renew('job', 140), true);
    assert.equal(a.saveCheckpoint('job', { n: 1 }, 141), true);
    // 再次过期并被接管后，原持有者的续租、收尾都失效
    assert.equal(b.claim(200)?.id, 'job');
    assert.equal(a.active('job', 200), false);
    assert.equal(a.renew('job', 200), false);
    assert.equal(a.fail('job', '失败', 200), false);
    assert.equal(b.finish('job', { ok: 1 }, 201), true);
  } finally { db.close(); }
});

test('本进程仍在执行的作业租约过期后不被本进程其它槽位接管，结束后才可重新领取', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('job','scan','扫描','queued','manual',100)").run();
    const slotA = new JobQueue(db, 'live-worker'); const slotB = new JobQueue(db, 'live-worker');
    assert.equal(slotA.claim(100)?.id, 'job');
    // 主线程卡住 60 秒后恢复：同一进程的另一个槽位先领取，不应把仍在执行的作业放回队列
    assert.equal(slotB.claim(160), null);
    assert.equal(slotA.active('job'), true);
    assert.equal(slotA.renew('job', 160), true);
    // 其它进程在过期后仍可接管
    const other = new JobQueue(db, 'other-worker');
    assert.equal(other.claim(200)?.id, 'job');
    assert.equal(slotA.active('job'), false);
    slotA.settle('job');
    assert.equal(other.finish('job', { ok: 1 }, 201), true);
    // 执行结束（未能放回队列）后，本进程可以接手自己遗留的过期作业
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('left','scan','扫描','queued','manual',300)").run();
    const slotC = new JobQueue(db, 'live-worker');
    assert.equal(slotC.claim(300)?.id, 'left');
    slotC.settle('left');
    assert.equal(slotB.claim(400)?.id, 'left');
    slotB.settle('left');
  } finally { db.close(); }
});
