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

test('批量作业保留共享缩略图；过期的孤立等待租约可回收', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/synthetic')").run();
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES ('photo','lib','a.jpg','lib','a.jpg','image/jpeg','image',1,1,1,'mtime')").run();
    const source = { id: 'photo', size: 1, modified_at: 1 };
    const job = enqueueMediaTask(db, source, { kind: 'thumb', size: 's' }, { waiter: 'request' });
    db.prepare("UPDATE jobs SET status='running',owner='first',lease_expires_at=unixepoch()+30 WHERE id=?").run(job);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('bulk','thumbnails','批量','queued','manual',?,unixepoch())").run(JSON.stringify({ libraryId: 'lib' }));
    await runNextJob(db, { owner: 'second', allowedRoots: [], legacyDir: '/unused', systemRoots: [] });
    releaseMediaWaiter(db, job, 'request', true);
    assert.deepEqual(db.prepare('SELECT status,media_background FROM jobs WHERE id=?').get(job), { status: 'running', media_background: 1 });
    const orphan = enqueueMediaTask(db, source, { kind: 'thumb', size: 'l' }, { waiter: 'expired' });
    db.prepare("UPDATE media_waiters SET lease_expires_at=0 WHERE id='expired'").run();
    assert.equal(cancelUnobservedMediaTask(db, orphan), false);
    assert.equal((db.prepare('SELECT status FROM jobs WHERE id=?').get(orphan) as { status: string }).status, 'queued');
    const lone = enqueueMediaTask(db, source, { kind: 'display' }, { waiter: 'lone' });
    db.prepare("UPDATE media_waiters SET lease_expires_at=0 WHERE id='lone'").run();
    assert.equal(cancelUnobservedMediaTask(db, lone), true);
    assert.equal((db.prepare('SELECT status FROM jobs WHERE id=?').get(lone) as { status: string }).status, 'cancelled');
  } finally { db.close(); }
});
