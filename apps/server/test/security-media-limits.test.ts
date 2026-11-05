import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { enqueueMediaTask } from '../src/core/media-cache.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';

async function fixture(count: number, extension = 'mkv') {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-security-media-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-security-cache-'));
  for (let i = 0; i < count; i++) await writeFile(path.join(root, `${i}.${extension}`), 'synthetic media');
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
  await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
  db.prepare("UPDATE files SET playability='transcode'").run();
  const rows = db.prepare('SELECT id,size,modified_at FROM files ORDER BY name').all() as { id: string; size: number; modified_at: number }[];
  const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
  const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
  db.prepare(`INSERT INTO shares(id,user_id,token,title,target,allow_download,created_at)
    SELECT 'share',id,'share-token','测试','{"type":"folder","path":"lib"}',0,1 FROM users WHERE username='admin'`).run();
  return { root, cache, db, app, rows, cookie, async close() { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); } };
}

test('分享访客无 Cookie 多次访问同一视频只排队一次', async () => {
  const f = await fixture(1);
  try {
    const url = `/api/v2/public/shares/share-token/media/${f.rows[0]!.id}/hls/index.m3u8`;
    for (let i = 0; i < 4; i++) assert.equal((await f.app.inject({ method: 'GET', url })).statusCode, 202);
    assert.equal((f.db.prepare("SELECT count(*) AS n FROM jobs WHERE dedupe_key LIKE 'hls:%' AND status='queued'").get() as { n: number }).n, 1);
  } finally { await f.close(); }
});

test('分享 HLS 按分享及全站限额隔离，登录用户保留独立名额', async () => {
  const f = await fixture(12);
  try {
    for (const n of [2, 3]) f.db.prepare(`INSERT INTO shares(id,user_id,token,title,target,allow_download,created_at)
      SELECT ?,id,?,'测试','{"type":"folder","path":"lib"}',0,1 FROM users WHERE username='admin'`).run(`share${n}`, `token${n}`);
    const share = (token: string, i: number) => f.app.inject({ method: 'GET', url: `/api/v2/public/shares/${token}/media/${f.rows[i]!.id}/hls/index.m3u8` });
    const user = (i: number) => f.app.inject({ method: 'GET', url: `/api/v2/media/${f.rows[i]!.id}/hls/index.m3u8`, headers: { cookie: f.cookie } });
    assert.equal((await share('share-token', 0)).statusCode, 202);
    assert.equal((await share('share-token', 1)).statusCode, 503);
    assert.equal((await share('share-token', 0)).statusCode, 202);
    assert.equal((await share('token2', 1)).statusCode, 202);
    f.db.prepare("UPDATE jobs SET status='paused' WHERE id=(SELECT job_id FROM hls_sessions WHERE media_id=?)").run(f.rows[1]!.id);
    assert.equal((await share('token3', 2)).statusCode, 503);
    for (let i = 2; i < 10; i++) assert.equal((await user(i)).statusCode, 202);
    assert.equal((await user(10)).statusCode, 503);
    f.db.prepare("UPDATE jobs SET status='succeeded' WHERE id=(SELECT job_id FROM hls_sessions WHERE media_id=?)").run(f.rows[1]!.id);
    assert.equal((await share('token3', 2)).statusCode, 202);
  } finally { await f.close(); }
});

test('缩略图等待达到全局上限时返回待处理且不增加等待者', async () => {
  const f = await fixture(1, 'jpg'); let timer: NodeJS.Timeout | undefined;
  try {
    const row = f.rows[0]!; const variant = { kind: 'thumb' as const, size: 's' as const };
    let job = '';
    for (let i = 0; i < 32; i++) job = enqueueMediaTask(f.db, row, variant, { waiter: `waiting-${i}` });
    timer = setTimeout(() => f.db.prepare("UPDATE jobs SET status='failed' WHERE id=?").run(job), 250);
    const response = await f.app.inject({ method: 'GET', url: `/api/v2/media/${row.id}/thumb?size=s&wait=true`, headers: { cookie: f.cookie } });
    clearTimeout(timer); timer = undefined;
    assert.equal(response.statusCode, 202);
    assert.equal(response.json().status, 'pending');
    assert.equal((f.db.prepare('SELECT count(*) AS n FROM media_waiters').get() as { n: number }).n, 32);
  } finally { if (timer) clearTimeout(timer); await f.close(); }
});

test('同一媒体的瓦片待处理作业有上限且允许已有瓦片复用', async () => {
  const f = await fixture(1, 'jpg');
  try {
    const row = f.rows[0]!;
    f.db.prepare('UPDATE files SET width=16384,height=1024 WHERE id=?').run(row.id);
    const url = (col: number) => `/api/v2/media/${row.id}/tiles/14/${col}_0.webp`;
    for (let col = 0; col < 8; col++) assert.equal((await f.app.inject({ method: 'GET', url: url(col), headers: { cookie: f.cookie } })).statusCode, 202);
    assert.equal((await f.app.inject({ method: 'GET', url: url(0), headers: { cookie: f.cookie } })).statusCode, 202);
    assert.equal((await f.app.inject({ method: 'GET', url: url(8), headers: { cookie: f.cookie } })).statusCode, 503);
    const active = () => (f.db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails' AND status IN ('queued','running','paused') AND json_extract(payload,'$.variant.kind')='tile'").get() as { n: number }).n;
    assert.equal(active(), 8);
    f.db.prepare("UPDATE jobs SET status='succeeded' WHERE id=(SELECT id FROM jobs WHERE type='thumbnails' AND json_extract(payload,'$.variant.kind')='tile' LIMIT 1)").run();
    assert.equal((await f.app.inject({ method: 'GET', url: url(8), headers: { cookie: f.cookie } })).statusCode, 202);
    assert.equal(active(), 8);
  } finally { await f.close(); }
});
