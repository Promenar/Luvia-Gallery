import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LibraryChangedEvent } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { FakeWatcher } from '../src/watch/watcher.ts';
import { WatchRuntime } from '../src/worker/watch-runtime.ts';
import { startWatchLoop } from '../src/worker/watch-loop.ts';
import { runNextJob } from '../src/worker/runner.ts';
import { flushLibraryEvents } from '../src/worker/watch-events.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';

async function until(check: () => boolean, timeout = 18000): Promise<void> {
  const end = Date.now() + timeout;
  while (!check()) { if (Date.now() >= end) throw new Error('等待监控行为超时'); await delay(100); }
}

test('空挂载点启动后恢复，通过 worker 扫描保留全部媒体身份', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-mount-e2e-')); const root = path.join(dir, 'media'); await mkdir(root);
  const db = openDatabase(path.join(dir, 'db.sqlite')); const watcher = new FakeWatcher();
  db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
  await writeFile(path.join(root, 'a.jpg'), 'photo');
  await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], mount: async () => 'nas' });
  const before = db.prepare('SELECT id,missing_at_ms FROM files').all();
  db.prepare('DELETE FROM library_watch_state').run();
  await rename(path.join(root, 'a.jpg'), path.join(dir, 'saved.jpg'));
  let mounted = false;
  const runtime = new WatchRuntime(db, { owner: 'watch', allowedRoots: [root], watcher: () => watcher, mount: async () => mounted ? 'nas' : 'empty' });
  const loop = startWatchLoop(runtime, { intervalMs: 50 });
  try {
    await loop.ready;
    assert.equal((db.prepare('SELECT state FROM library_watch_state').get() as {state:string}).state, 'degraded');
    assert.deepEqual(db.prepare('SELECT id,missing_at_ms FROM files').all(), before);
    await rename(path.join(dir, 'saved.jpg'), path.join(root, 'a.jpg')); mounted = true;
    await until(() => !!db.prepare("SELECT 1 FROM jobs WHERE type='scan' AND status='queued'").get(), 3000);
    assert.equal(await runNextJob(db, { owner: 'scanner', allowedRoots: [root], legacyDir: root, systemRoots: [] }), true);
    assert.deepEqual(db.prepare('SELECT id,missing_at_ms FROM files').all(), before);
  } finally { await loop.stop(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('worker 主循环对临时媒体库处理新增修改移动删除并发布事件', { timeout: 70000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-e2e-')); const root = path.join(dir, 'media'); await mkdir(root);
  const db = openDatabase(path.join(dir, 'db.sqlite')); const watcher = new FakeWatcher();
  db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
  const runtime = new WatchRuntime(db, { owner: 'watch', watcher: () => watcher });
  const loop = startWatchLoop(runtime, { intervalMs: 100 });
  const app = await createApp({ db, legacyPending: false }); const sseAbort = new AbortController();
  const timer = setInterval(() => flushLibraryEvents(db), 100); timer.unref();
  const signal = (name: string) => watcher.emit({ eventType: 'rename', path: name });
  const file = (name: string) => db.prepare('SELECT id,missing_at_ms FROM files WHERE library_id=? AND relative_path=?').get('lib', name) as {id:string; missing_at_ms:number|null} | undefined;
  const events = () => (db.prepare("SELECT payload FROM job_events WHERE event_type='library' ORDER BY id").all() as {payload:string}[]).map((row) => LibraryChangedEvent.parse(JSON.parse(row.payload)));
  try {
    await loop.ready;
    assert.equal(await runNextJob(db, { owner: 'scanner', allowedRoots: [root], legacyDir: root, systemRoots: [] }), true);
    assert.ok(events().some((event) => event.source === 'scan'));
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const cursor = (db.prepare('SELECT COALESCE(max(id),0) n FROM job_events').get() as {n:number}).n;
    const sse = await app.inject({ method: 'GET', url: '/api/v2/events', headers: { cookie, 'last-event-id': String(cursor) }, payloadAsStream: true, signal: sseAbort.signal });
    let streamText = ''; let addedAt: number | null = null;
    sse.stream().on('error', () => {}); sse.stream().on('data', (chunk: Buffer) => {
      streamText += chunk.toString();
      for (const match of streamText.matchAll(/event: library\ndata: (.+)/g)) {
        const event = LibraryChangedEvent.parse(JSON.parse(match[1]!));
        if (event.source === 'watch' && event.added === 1 && addedAt === null) addedAt = performance.now();
      }
    });
    await writeFile(path.join(root, 'a.jpg'), 'initial'); const writtenAt = performance.now(); signal('a.jpg');
    await until(() => !!file('a.jpg') && addedAt !== null, 7000);
    assert.ok(addedAt !== null && addedAt - writtenAt <= 7000, '新增文件 SSE 延迟超过七秒');
    const id = file('a.jpg')!.id;
    await writeFile(path.join(root, 'a.jpg'), 'modified photo'); signal('a.jpg');
    await until(() => events().some((event) => event.source === 'watch' && event.updated > 0));
    await rename(path.join(root, 'a.jpg'), path.join(root, 'b.jpg')); signal('a.jpg'); signal('b.jpg');
    await until(() => file('b.jpg')?.id === id && events().some((event) => event.source === 'watch' && event.moved > 0));
    await unlink(path.join(root, 'b.jpg')); signal('b.jpg');
    await until(() => file('b.jpg')?.missing_at_ms !== null && !!file('b.jpg') && events().some((event) => event.source === 'watch' && event.removed > 0));
  } finally { sseAbort.abort(); clearInterval(timer); await loop.stop(); await app.close(); db.close(); await rm(dir, { recursive: true, force: true }); }
});
