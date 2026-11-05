import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';

test('worker 领取扫描作业，保存结果并发出库变化事件', async () => {
  const module = await import('../src/worker/runner.ts').catch(() => null);
  assert.ok(module, 'worker 执行器尚未实现');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-worker-'));
  const db = openDatabase(':memory:');
  try {
    await writeFile(path.join(root, 'a.jpg'), 'image');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('job','scan','扫描','queued','manual',?,1)").run(JSON.stringify({ libraryId: 'lib' }));
    assert.equal(await module.runNextJob(db, { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [] }), true);
    const job = db.prepare("SELECT status,result FROM jobs WHERE id='job'").get() as { status: string; result: string };
    assert.equal(job.status, 'succeeded');
    assert.deepEqual(JSON.parse(job.result), { added: 1, removed: 0, errors: 0 });
    const library = db.prepare("SELECT last_scan_at,status FROM libraries WHERE id='lib'").get() as { last_scan_at: number | null; status: string };
    assert.ok(library.last_scan_at); assert.equal(library.status, 'ok');
    const events = db.prepare("SELECT event_type FROM job_events ORDER BY id").all() as { event_type: string }[];
    assert.ok(events.some((item) => item.event_type === 'library'));
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('只在设置允许时把新挂载建库并排队扫描', async () => {
  const module = await import('../src/worker/discover.ts').catch(() => null);
  assert.ok(module, '挂载发现模块尚未实现');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-discovery-'));
  const db = openDatabase(':memory:');
  const mount = { containerPath: root, hostPath: '/volume/photos', kind: 'candidate' as const, libraryId: null, readOnly: true, mediaEstimate: null };
  try {
    assert.equal(await module.discoverNewMounts(db, [mount], []), 0);
    db.prepare("INSERT INTO settings(key,value) VALUES('admin.settings',?)").run(JSON.stringify({ libraries: { autoEnableNewMounts: true } }));
    assert.equal(await module.discoverNewMounts(db, [mount], []), 1);
    assert.equal(await module.discoverNewMounts(db, [mount], []), 0);
    const library = db.prepare('SELECT root,host_root,host_root_source FROM libraries').get() as { root: string; host_root: string; host_root_source: string };
    assert.deepEqual(library, { root, host_root: '/volume/photos', host_root_source: 'auto' });
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='scan' AND status='queued'").get() as { n: number }).n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('扫描读取错误后重试会重新检查目录并更新媒体库状态', async () => {
  const { runNextJob } = await import('../src/worker/runner.ts');
  const { createApp } = await import('../src/api/app.ts');
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-retry-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    await writeFile(path.join(root, 'a.jpg'), 'fixture');
    await promisify(execFile)('mkfifo', [path.join(root, 'unknown')]);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('job','scan','扫描','queued','manual',?,1)").run(JSON.stringify({ libraryId: 'lib' }));
    const options = { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [] };
    await runNextJob(db, options);
    assert.equal((db.prepare("SELECT status FROM jobs WHERE id='job'").get() as { status: string }).status, 'failed');
    assert.equal((db.prepare("SELECT status FROM libraries WHERE id='lib'").get() as { status: string }).status, 'unavailable');
    await unlink(path.join(root, 'unknown'));
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    assert.equal((await app.inject({ method: 'POST', url: '/api/v2/admin/jobs/job/retry', headers: { cookie, 'x-luvia-request': '1' } })).statusCode, 200);
    await runNextJob(db, options);
    assert.equal((db.prepare("SELECT status FROM jobs WHERE id='job'").get() as { status: string }).status, 'succeeded');
    const library = db.prepare("SELECT status,last_scan_at FROM libraries WHERE id='lib'").get() as { status: string; last_scan_at: number | null };
    assert.equal(library.status, 'ok'); assert.ok(library.last_scan_at);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('媒体任务参数不完整时返回失败状态', async () => {
  const module = await import('../src/worker/runner.ts').catch(() => null);
  assert.ok(module, 'worker 执行器尚未实现');
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('job','thumbnails','缩略图','queued','manual',?,1)").run(JSON.stringify({ mediaId: 'missing' }));
    await module.runNextJob(db, { owner: 'worker-a', allowedRoots: [], legacyDir: '/nonexistent', systemRoots: [] });
    const row = db.prepare("SELECT status,error FROM jobs WHERE id='job'").get() as { status: string; error: string };
    assert.equal(row.status, 'failed');
    assert.ok(row.error);
  } finally { db.close(); }
});

test('全量扫描事件准确反映修改、移动和进入缺失的媒体', async () => {
  const { runNextJob } = await import('../src/worker/runner.ts');
  const { flushLibraryEvents } = await import('../src/worker/watch-events.ts');
  const { rename } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-event-counts-')); const db = openDatabase(':memory:');
  try {
    for (const file of ['move.jpg', 'change.jpg', 'gone.jpg']) await writeFile(path.join(root, file), 'old');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    const scan = async (id: string) => {
      db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES (?,'scan','扫描','queued','manual',?,unixepoch())").run(id, JSON.stringify({libraryId:'lib'}));
      await runNextJob(db, { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [] });
      db.prepare("UPDATE jobs SET status='succeeded' WHERE type='metadata'").run();
    };
    await scan('first');
    await rename(path.join(root, 'move.jpg'), path.join(root, 'moved.jpg'));
    await writeFile(path.join(root, 'change.jpg'), 'updated data'); await unlink(path.join(root, 'gone.jpg'));
    await scan('second'); flushLibraryEvents(db, Date.now() + 3000);
    const row = db.prepare("SELECT payload FROM job_events WHERE event_type='library' ORDER BY id DESC LIMIT 1").get() as {payload:string};
    const event = JSON.parse(row.payload);
    assert.equal(event.source, 'scan'); assert.equal(event.updated, 1); assert.equal(event.moved, 1); assert.equal(event.removed, 1); assert.equal(event.added, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('扫描新目录和缺失目录时事件只统计实际媒体', async () => {
  const { runNextJob } = await import('../src/worker/runner.ts');
  const { flushLibraryEvents } = await import('../src/worker/watch-events.ts');
  const { mkdir } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-directory-events-')); const db = openDatabase(':memory:');
  try {
    await mkdir(path.join(root, 'trip')); await mkdir(path.join(root, 'empty')); await writeFile(path.join(root, 'trip/a.jpg'), 'photo');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    const scan = async (id: string) => {
      db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES (?,'scan','扫描','queued','manual',?,unixepoch())").run(id, JSON.stringify({ libraryId: 'lib' }));
      await runNextJob(db, { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [] });
      db.prepare("UPDATE jobs SET status='succeeded' WHERE type='metadata'").run();
    };
    await scan('first');
    const first = JSON.parse((db.prepare("SELECT payload FROM job_events WHERE event_type='library' ORDER BY id DESC LIMIT 1").get() as {payload:string}).payload);
    assert.equal(first.added, 1); assert.equal(first.removed, 0); assert.ok(first.folders.includes('lib/trip'));
    await rm(path.join(root, 'trip'), { recursive: true }); await rm(path.join(root, 'empty'), { recursive: true });
    await scan('second'); flushLibraryEvents(db, Date.now() + 3000);
    const second = JSON.parse((db.prepare("SELECT payload FROM job_events WHERE event_type='library' ORDER BY id DESC LIMIT 1").get() as {payload:string}).payload);
    assert.equal(second.added, 0); assert.equal(second.removed, 1); assert.ok(second.folders.includes('lib/trip'));
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('扫描缺失媒体以新路径恢复时累计计数匹配可见媒体变化', async () => {
  const { runNextJob } = await import('../src/worker/runner.ts'); const { flushLibraryEvents } = await import('../src/worker/watch-events.ts');
  const { mkdir, rename } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-scan-restore-events-')); const root = path.join(dir, 'media'); await mkdir(root);
  const db = openDatabase(':memory:');
  try {
    await writeFile(path.join(root, 'old.jpg'), 'photo');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    const scan = async (id: string, offset: number) => {
      db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES (?,'scan','扫描','queued','manual',?,unixepoch())").run(id, JSON.stringify({ libraryId: 'lib' }));
      await runNextJob(db, { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [] });
      db.prepare("UPDATE jobs SET status='succeeded' WHERE type='metadata'").run(); flushLibraryEvents(db, Date.now() + offset);
    };
    await scan('first', 0); await rename(path.join(root, 'old.jpg'), path.join(dir, 'parked.jpg')); await scan('missing', 3000);
    await rename(path.join(dir, 'parked.jpg'), path.join(root, 'new.jpg')); await scan('restored', 6000);
    const events = (db.prepare("SELECT payload FROM job_events WHERE event_type='library' ORDER BY id").all() as {payload:string}[]).map((row) => JSON.parse(row.payload));
    const added = events.reduce((sum, event) => sum + event.added, 0); const removed = events.reduce((sum, event) => sum + event.removed, 0);
    assert.equal(added - removed, (db.prepare('SELECT count(*) n FROM files WHERE missing_at_ms IS NULL').get() as {n:number}).n);
    assert.equal(events.at(-1).moved, 1); assert.equal(events.at(-1).added, 1);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('扫描目录移动事件保留新旧深层目录供权限过滤', async () => {
  const { runNextJob } = await import('../src/worker/runner.ts'); const { flushLibraryEvents } = await import('../src/worker/watch-events.ts');
  const { mkdir, rename } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-move-folders-')); const db = openDatabase(':memory:');
  try {
    await mkdir(path.join(root, 'old/nested'), { recursive: true }); await writeFile(path.join(root, 'old/nested/a.jpg'), 'photo');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    const scan = async (id: string) => {
      db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES (?,'scan','扫描','queued','manual',?,unixepoch())").run(id, JSON.stringify({ libraryId: 'lib' }));
      await runNextJob(db, { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [] });
      db.prepare("UPDATE jobs SET status='succeeded' WHERE type='metadata'").run();
    };
    await scan('first'); await rename(path.join(root, 'old'), path.join(root, 'new')); await scan('second'); flushLibraryEvents(db, Date.now() + 3000);
    const event = JSON.parse((db.prepare("SELECT payload FROM job_events WHERE event_type='library' ORDER BY id DESC LIMIT 1").get() as {payload:string}).payload);
    assert.ok(event.folders.includes('lib/old/nested')); assert.ok(event.folders.includes('lib/new/nested'));
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
