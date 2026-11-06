import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { JobQueue } from '../src/core/jobs.ts';
import { writeSettings } from '../src/core/settings.ts';
import { runNextJob } from '../src/worker/runner.ts';
import { enqueueMediaTask, pruneMediaPriorities } from '../src/core/media-cache.ts';

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

test('预览作业达到视频并发上限时，其他作业仍可领取，释放后继续领取预览', () => {
  const db = openDatabase(':memory:');
  try {
    const insert = db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at,dedupe_key) VALUES (?,?,?,'queued','system',?,?)");
    for (let i = 1; i <= 3; i++) insert.run(`preview-${i}`, 'previews', '生成视频预览', i, `media:preview-${i}`);
    insert.run('scan', 'scan', '扫描媒体库', 4, null);
    insert.run('batch', 'previews', '生成视频预览', 5, 'previews:all');
    const one = new JobQueue(db, 'worker-a'); const two = new JobQueue(db, 'worker-b');
    const next = new JobQueue(db, 'worker-c'); const after = new JobQueue(db, 'worker-d');
    assert.equal(one.claim(100, { maxActivePreviews: 2 })?.id, 'preview-1');
    assert.equal(two.claim(100, { maxActivePreviews: 2 })?.id, 'preview-2');
    assert.equal(next.claim(100, { maxActivePreviews: 2 })?.id, 'scan');
    assert.equal(after.claim(100, { maxActivePreviews: 2 }), null);
    assert.equal(one.finish('preview-1', { generated: 1 }, 101), true);
    assert.equal(after.claim(101, { maxActivePreviews: 2 })?.id, 'preview-3');
    const dispatcher = new JobQueue(db, 'worker-e');
    assert.equal(dispatcher.claim(101, { maxActivePreviews: 2 })?.id, 'batch');
  } finally { db.close(); }
});

test('工作进程按当前视频并发设置限制领取，健康检查仍可执行', async () => {
  const db = openDatabase(':memory:');
  try {
    writeSettings(db, { workers: { ffmpegConcurrency: 2 } });
    const active = db.prepare(`INSERT INTO jobs(id,type,label,status,trigger,created_at,dedupe_key,owner,lease_token,lease_expires_at)
      VALUES (?,'previews','生成视频预览','running','system',1,?,'other','token',unixepoch()+30)`);
    active.run('active-1', 'media:active-1'); active.run('active-2', 'media:active-2');
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at,dedupe_key) VALUES ('waiting','previews','生成视频预览','queued','system',1,'media:waiting')").run();
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('health','health_check','健康检查','queued','system',2)").run();
    await runNextJob(db, { owner: 'worker', allowedRoots: [], legacyDir: '', systemRoots: [] });
    assert.equal((db.prepare("SELECT status FROM jobs WHERE id='health'").get() as { status: string }).status, 'succeeded');
    assert.equal((db.prepare("SELECT status FROM jobs WHERE id='waiting'").get() as { status: string }).status, 'queued');
  } finally { db.close(); }
});

test('预览并发设置在领取事务内读取', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('health','health_check','健康检查','queued','system',1)").run();
    const queue = new JobQueue(db, 'worker');
    assert.equal(queue.claim(100, { maxActivePreviews: () => { assert.equal(db.inTransaction, true); return 2; } })?.id, 'health');
  } finally { db.close(); }
});

test('浏览请求和播放任务优先于排队的后台媒体任务，过期等待者不提升优先级', () => {
  const db = openDatabase(':memory:');
  try {
    const insert = db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at,dedupe_key) VALUES (?,?,?,'queued','system',?,?)");
    insert.run('background', 'thumbnails', '后台缩略图', 1, 'media:background');
    insert.run('expired', 'thumbnails', '过期浏览', 2, 'media:expired');
    insert.run('foreground', 'thumbnails', '浏览缩略图', 3, 'media:foreground');
    insert.run('hls', 'previews', '播放', 95, 'hls:video');
    db.prepare("INSERT INTO media_waiters(id,job_id,lease_expires_at) VALUES ('expired-waiter','expired',100),('active-waiter','foreground',101)").run();
    const queue = new JobQueue(db, 'priority-worker');
    const first = queue.claim(100)?.id; assert.ok(first); assert.equal(queue.finish(first, { ok: 1 }, 100), true); queue.settle(first);
    const second = queue.claim(100)?.id; assert.ok(second); assert.equal(queue.finish(second, { ok: 1 }, 100), true); queue.settle(second);
    assert.deepEqual(new Set([first, second]), new Set(['foreground', 'hls']));
    for (const expected of ['background', 'expired']) {
      assert.equal(queue.claim(100)?.id, expected); assert.equal(queue.finish(expected, { ok: 1 }, 100), true); queue.settle(expected);
    }
  } finally { db.close(); }
});

test('持续到来的新浏览请求不会饿死较早排队的播放任务', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at,dedupe_key) VALUES ('hls','previews','播放','queued','system',90,'hls:video')").run();
    for (let i = 0; i < 12; i++) {
      db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at,dedupe_key) VALUES (?,'thumbnails','浏览','queued','system',?,?)").run(`thumb-${i}`, i, `media:${i}`);
      db.prepare('INSERT INTO media_waiters(id,job_id,lease_expires_at) VALUES (?,?,?)').run(`priority:thumb-${i}`, `thumb-${i}`, 110);
    }
    const first = new JobQueue(db, 'fairness-worker'); const second = new JobQueue(db, 'fairness-worker-2');
    const claims = [first.claim(100, { maxActivePreviews: 1 })?.id, second.claim(100, { maxActivePreviews: 1 })?.id];
    assert.ok(claims.includes('hls'), '浏览请求持续排队时，播放任务也必须在有限次数内领取');
    assert.ok(claims.some((id) => id?.startsWith('thumb-')), '播放任务排队时浏览请求也必须可领取');
    for (const id of claims) if (id) { first.settle(id); second.settle(id); }
  } finally { db.close(); }
});

test('浏览中的非等待任务提升已存在的后台作业，并保持共享作业不因请求结束而取消', () => {
  const db = openDatabase(':memory:');
  try {
    const a = { id: 'a', size: 1, modified_at: 1 }; const b = { id: 'b', size: 1, modified_at: 1 };
    const background = enqueueMediaTask(db, a, { kind: 'display' });
    const promoted = enqueueMediaTask(db, b, { kind: 'display' });
    assert.equal(enqueueMediaTask(db, b, { kind: 'display' }, { interactive: true }), promoted);
    const queue = new JobQueue(db, 'priority-worker');
    assert.equal(queue.claim()?.id, promoted);
    assert.equal((db.prepare('SELECT media_background FROM jobs WHERE id=?').get(promoted) as { media_background: number }).media_background, 1);
    assert.equal(queue.claim()?.id, background);
    queue.settle(promoted); queue.settle(background);
  } finally { db.close(); }
});

test('非等待浏览任务的优先权过期后，新的播放任务不被陈旧浏览请求阻塞', () => {
  const db = openDatabase(':memory:');
  try {
    const source = { id: 'a', size: 1, modified_at: 1 };
    const job = enqueueMediaTask(db, source, { kind: 'display' }, { interactive: true });
    db.prepare("UPDATE jobs SET created_at=1 WHERE id=?").run(job);
    db.prepare("UPDATE media_waiters SET lease_expires_at=100 WHERE job_id=?").run(job);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at,dedupe_key) VALUES ('hls','previews','播放','queued','system',2,'hls:video')").run();
    const queue = new JobQueue(db, 'expiry-worker');
    assert.equal(queue.claim(100)?.id, 'hls'); queue.settle('hls');
  } finally { db.close(); }
});

test('浏览优先标记数量有上限并可批量清理，真实等待者不受清理影响', () => {
  const db = openDatabase(':memory:');
  try {
    const insert = db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES (?,'thumbnails','缩略图','queued','system',1)");
    const mark = db.prepare("INSERT INTO media_waiters(id,job_id,lease_expires_at) VALUES (?,?,unixepoch()+10)");
    db.transaction(() => { for (let i = 0; i < 4096; i++) { const id = `old-${i}`; insert.run(id); mark.run(`priority:${id}`, id); } })();
    db.prepare("INSERT INTO media_waiters(id,job_id,lease_expires_at) VALUES ('real-waiter','old-0',1)").run();
    const source = { id: 'new', size: 1, modified_at: 1 };
    const job = enqueueMediaTask(db, source, { kind: 'display' }, { interactive: true });
    assert.equal(db.prepare('SELECT 1 FROM media_waiters WHERE id=?').get(`priority:${job}`), undefined);
    db.prepare("UPDATE media_waiters SET lease_expires_at=1 WHERE id GLOB 'priority:*'").run();
    assert.equal(enqueueMediaTask(db, source, { kind: 'display' }, { interactive: true }), job);
    assert.ok(db.prepare('SELECT 1 FROM media_waiters WHERE id=?').get(`priority:${job}`));
    assert.equal(pruneMediaPriorities(db, Math.floor(Date.now() / 1000) + 11), 4096);
    assert.ok(db.prepare("SELECT 1 FROM media_waiters WHERE id='real-waiter'").get());
    assert.equal(enqueueMediaTask(db, source, { kind: 'display' }, { interactive: true }), job);
    assert.ok(db.prepare('SELECT 1 FROM media_waiters WHERE id=?').get(`priority:${job}`));
  } finally { db.close(); }
});

test('HLS 与逐文件预览共用领取上限，播放排队不会占满所有 worker 槽位', () => {
  const db = openDatabase(':memory:');
  try {
    const insert = db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at,dedupe_key) VALUES (?,?,?,'queued','system',?,?)");
    for (let i = 0; i < 6; i++) insert.run(`hls-${i}`, 'previews', '播放', i, `hls:${i}`);
    insert.run('thumbnail', 'thumbnails', '缩略图', 10, 'media:thumb');
    insert.run('scan', 'scan', '扫描', 11, null);
    const first = new JobQueue(db, 'hls-first'); const second = new JobQueue(db, 'hls-second');
    assert.equal(first.claim(100, { maxActivePreviews: 1 })?.id, 'hls-0');
    assert.equal(second.claim(100, { maxActivePreviews: 1 })?.id, 'thumbnail');
    const third = new JobQueue(db, 'hls-third');
    assert.equal(third.claim(100, { maxActivePreviews: 1 })?.id, 'scan');
    const fourth = new JobQueue(db, 'hls-fourth');
    assert.equal(fourth.claim(100, { maxActivePreviews: 1 }), null);
    first.settle('hls-0'); second.settle('thumbnail'); third.settle('scan');
  } finally { db.close(); }
});
