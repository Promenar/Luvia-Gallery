import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { FakeWatcher } from '../src/watch/watcher.ts';

test('多 worker 为每库只启动一个协调器，配置变化重建，退出后可接管', async () => {
  const mod = await import('../src/worker/watch-runtime.ts').catch(() => null);
  assert.ok(mod, '监控运行时尚未接入');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-runtime-'));
  const media = path.join(dir, 'media'); await mkdir(media);
  const db = openDatabase(path.join(dir, 'db.sqlite'));
  const otherDb = openDatabase(path.join(dir, 'db.sqlite'));
  db.prepare("INSERT INTO libraries(id,name,root,enabled) VALUES ('lib','照片',?,1)").run(media);
  const started: string[] = []; const stopped: string[] = [];
  const makeWatcher = (owner: string) => () => {
    const watcher = new FakeWatcher(); const start = watcher.start.bind(watcher); const stop = watcher.stop.bind(watcher);
    watcher.start = (handlers) => { started.push(owner); start(handlers); };
    watcher.stop = () => { stopped.push(owner); stop(); };
    return watcher;
  };
  const one = new mod.WatchRuntime(db, { owner: 'one', watcher: makeWatcher('one') });
  const two = new mod.WatchRuntime(otherDb, { owner: 'two', watcher: makeWatcher('two') });
  try {
    await one.tick(); await two.tick(); assert.deepEqual(started, ['one']);
    db.prepare("UPDATE libraries SET exclude='[\"private\"]' WHERE id='lib'").run();
    await one.tick(); assert.deepEqual(started, ['one', 'one']); assert.ok(stopped.includes('one'));
    db.prepare("UPDATE watch_leases SET lease_expires_at=0 WHERE library_id='lib'").run();
    await two.tick(); assert.deepEqual(started, ['one', 'one', 'two']);
    await one.tick(); assert.equal((db.prepare("SELECT owner FROM watch_leases WHERE library_id='lib'").get() as {owner:string}).owner, 'two');
    db.prepare("UPDATE libraries SET enabled=0 WHERE id='lib'").run();
    await two.tick(); assert.ok(stopped.includes('two'));
  } finally { await one.stop(); await two.stop(); otherDb.close(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('挂载身份改变时监控降级并保护索引，恢复后持久排队全量扫描', async () => {
  const { WatchRuntime } = await import('../src/worker/watch-runtime.ts');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-mount-')); const media = path.join(dir, 'media'); await mkdir(media);
  const db = openDatabase(path.join(dir, 'db.sqlite')); let identity = 'mount-a';
  db.prepare("INSERT INTO libraries(id,name,root,enabled) VALUES ('lib','照片',?,1)").run(media);
  const runtime = new WatchRuntime(db, { owner: 'one', watcher: () => new FakeWatcher(), mount: async () => identity });
  try {
    const { writeFile } = await import('node:fs/promises');
    const { scanLibrary } = await import('../src/worker/scan.ts');
    await writeFile(path.join(media, 'old.jpg'), 'photo');
    await scanLibrary(db, { id: 'lib', root: media }, { allowedRoots: [media], mount: async () => identity });
    await runtime.tick();
    const first = db.prepare("SELECT mount_identity FROM library_watch_state WHERE library_id='lib'").get() as { mount_identity: string };
    assert.equal(first.mount_identity, 'mount-a');
    await rm(path.join(media, 'old.jpg')); identity = 'mount-b'; await runtime.tick();
    const unavailable = db.prepare("SELECT state,degraded_reason FROM library_watch_state WHERE library_id='lib'").get() as { state: string; degraded_reason: string };
    assert.equal(unavailable.state, 'degraded'); assert.match(unavailable.degraded_reason, /根目录|挂载/);
    db.prepare("UPDATE jobs SET status='succeeded' WHERE type='scan'").run();
    identity = 'mount-a'; await runtime.tick();
    assert.ok(db.prepare("SELECT 1 FROM jobs WHERE type='scan' AND status='queued'").get());
    assert.equal((db.prepare("SELECT state FROM library_watch_state WHERE library_id='lib'").get() as {state:string}).state, 'watching');
  } finally { await runtime.stop(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('不同 worker 租约过期接管后旧端口不能写入', async () => {
  const { SqliteLibraryIndex } = await import('../src/watch/sqlite-index.ts');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-fence-')); const db = openDatabase(path.join(dir, 'db.sqlite'));
  db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/media')").run();
  db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片')").run();
  db.prepare("INSERT INTO watch_leases VALUES ('lib','old','token-old',unixepoch()+30)").run();
  const port = new SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {},
    assertLease: () => { if (!db.prepare("SELECT 1 FROM watch_leases WHERE library_id='lib' AND token='token-old' AND lease_expires_at>unixepoch()").get()) throw new Error('监控租约已失效'); } });
  try {
    db.prepare("UPDATE watch_leases SET owner='new',token='token-new' WHERE library_id='lib'").run();
    await assert.rejects(port.writeAdded({ path: 'x.jpg', isDir: false, mediaId: null, size: 1, mtimeMs: 1000, dev: '1', ino: '1', headHash: null }), /租约已失效/);
    await assert.rejects(port.appendChange({ ts: '2026-01-01T00:00:00.000Z', kind: 'added', path: 'x.jpg', fromPath: null, isDir: false, mediaId: 'x', source: 'watch' }), /租约已失效/);
    assert.equal((db.prepare('SELECT count(*) n FROM files').get() as {n:number}).n, 0);
  } finally { port.close(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('全量扫描发现挂载身份改变时保留既有媒体且不标记缺失', async () => {
  const { scanLibrary } = await import('../src/worker/scan.ts');
  const { writeFile } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-scan-mount-')); const media = path.join(dir, 'media'); await mkdir(media);
  const db = openDatabase(path.join(dir, 'db.sqlite'));
  try {
    await writeFile(path.join(media, 'old.jpg'), 'photo');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(media);
    await scanLibrary(db, { id: 'lib', root: media }, { allowedRoots: [media] });
    db.prepare("UPDATE library_watch_state SET mount_root=?,mount_identity='mount-a' WHERE library_id='lib'").run(media);
    await rm(path.join(media, 'old.jpg'));
    await assert.rejects(scanLibrary(db, { id: 'lib', root: media }, { allowedRoots: [media], mount: async () => 'mount-b' }), /挂载/);
    assert.equal((db.prepare("SELECT missing_at_ms FROM files WHERE library_id='lib'").get() as {missing_at_ms:number|null}).missing_at_ms, null);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('修改监控模式后重建协调器，off 释放租约，poll 周期对账', async () => {
  const { WatchRuntime } = await import('../src/worker/watch-runtime.ts');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-mode-')); const media = path.join(dir, 'media'); await mkdir(media);
  const db = openDatabase(path.join(dir, 'db.sqlite')); let starts = 0; let stops = 0;
  db.prepare("INSERT INTO libraries(id,name,root,enabled) VALUES ('lib','照片',?,1)").run(media);
  const runtime = new WatchRuntime(db, { owner: 'one', watcher: () => { const watcher = new FakeWatcher();
    const start = watcher.start.bind(watcher); const stop = watcher.stop.bind(watcher);
    watcher.start = (handlers) => { starts++; start(handlers); }; watcher.stop = () => { stops++; stop(); }; return watcher; } });
  try {
    await runtime.tick(); assert.equal(starts, 1);
    db.prepare("UPDATE libraries SET watch_mode='poll',watch_poll_interval_sec=60 WHERE id='lib'").run();
    await runtime.tick(); assert.equal(starts, 1); assert.ok(stops > 0);
    assert.equal((db.prepare("SELECT state FROM library_watch_state WHERE library_id='lib'").get() as {state:string}).state, 'polling');
    db.prepare("UPDATE libraries SET watch_mode='off' WHERE id='lib'").run(); await runtime.tick();
    assert.equal(db.prepare("SELECT 1 FROM watch_leases WHERE library_id='lib'").get(), undefined);
  } finally { await runtime.stop(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('worker 监控主循环启动并在停止时释放独占租约', async () => {
  const runtimeModule = await import('../src/worker/watch-runtime.ts');
  const loopModule = await import('../src/worker/watch-loop.ts').catch(() => null);
  assert.ok(loopModule, 'worker 监控主循环尚未接入');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-loop-')); const media = path.join(dir, 'media'); await mkdir(media);
  const db = openDatabase(path.join(dir, 'db.sqlite'));
  db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(media);
  const runtime = new runtimeModule.WatchRuntime(db, { owner: 'worker', watcher: () => new FakeWatcher() });
  const loop = loopModule.startWatchLoop(runtime, { intervalMs: 20 });
  try {
    await loop.ready; assert.ok(db.prepare("SELECT 1 FROM watch_leases WHERE library_id='lib'").get());
    await loop.stop(); assert.equal(db.prepare("SELECT 1 FROM watch_leases WHERE library_id='lib'").get(), undefined);
  } finally { await loop.stop(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Linux 系统信息汇总未过期 worker 监视数', { skip: process.platform !== 'linux' }, async () => {
  const { createApp } = await import('../src/api/app.ts');
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    db.prepare("INSERT INTO watch_worker_usage(owner,watched_count,lease_expires_at) VALUES ('a',4,unixepoch()+30),('b',7,unixepoch()+30),('expired',99,0)").run();
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const response = await app.inject({ method: 'GET', url: '/api/v2/admin/system', headers: { cookie } });
    assert.equal(response.statusCode, 200); assert.equal(response.json().inotify.used, 11);
    assert.ok(response.json().inotify.maxUserWatches > 0);
  } finally { await app.close(); db.close(); }
});

test('监视数统计只累加未过期 worker，避免同一进程多个媒体库重复计数', async () => {
  const { serviceWatchUsage } = await import('../src/worker/watch-runtime.ts');
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO watch_worker_usage(owner,watched_count,lease_expires_at) VALUES ('a',4,200),('b',7,200),('expired',99,100)").run();
    assert.equal(serviceWatchUsage(db, 100), 11);
  } finally { db.close(); }
});

test('启动时根目录缺失，恢复后记录首次挂载身份并排队扫描', async () => {
  const { WatchRuntime } = await import('../src/worker/watch-runtime.ts');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-start-missing-')); const media = path.join(dir, 'media');
  const db = openDatabase(path.join(dir, 'db.sqlite'));
  db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(media);
  const runtime = new WatchRuntime(db, { owner: 'one', watcher: () => new FakeWatcher(), mount: async () => 'mount-a' });
  try {
    await runtime.tick();
    assert.equal((db.prepare("SELECT state FROM library_watch_state WHERE library_id='lib'").get() as {state:string}).state, 'degraded');
    await mkdir(media); await runtime.tick();
    const state = db.prepare("SELECT state,mount_root,mount_identity FROM library_watch_state WHERE library_id='lib'").get() as {state:string;mount_root:string;mount_identity:string};
    assert.deepEqual(state, { state: 'watching', mount_root: media, mount_identity: 'mount-a' });
    assert.ok(db.prepare("SELECT 1 FROM jobs WHERE type='scan' AND status='queued'").get());
  } finally { await runtime.stop(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('媒体库根目录在允许范围外时不认领或监视', async () => {
  const { WatchRuntime } = await import('../src/worker/watch-runtime.ts');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-outside-')); const allowed = path.join(dir, 'allowed'); const outside = path.join(dir, 'outside');
  await mkdir(allowed); await mkdir(outside); const db = openDatabase(path.join(dir, 'db.sqlite')); let started = false;
  db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(outside);
  const runtime = new WatchRuntime(db, { owner: 'worker', allowedRoots: [allowed], watcher: () => { started = true; return new FakeWatcher(); } });
  try {
    await runtime.tick(); assert.equal(started, false);
    assert.equal(db.prepare("SELECT 1 FROM watch_leases WHERE library_id='lib'").get(), undefined);
    const state = db.prepare("SELECT state,degraded_reason FROM library_watch_state WHERE library_id='lib'").get() as { state: string; degraded_reason: string };
    assert.equal(state.state, 'degraded'); assert.match(state.degraded_reason, /允许/);
  } finally { await runtime.stop(); db.close(); await rm(dir, { recursive: true, force: true }); }
});
