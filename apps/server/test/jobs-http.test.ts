import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Job as JobSchema, JobList, SystemInfo } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

const header = { 'x-luvia-request': '1' };

test('重试与现有活跃作业冲突时返回 409 并保留两条记录', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: header, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at,dedupe_key) VALUES ('old','previews','预览','failed','system',1,'media:same'),('new','previews','预览','queued','system',2,'media:same')").run();
    const response = await app.inject({ method: 'POST', url: '/api/v2/admin/jobs/old/retry', headers: { ...header, cookie } });
    assert.equal(response.statusCode, 409);
    assert.deepEqual(db.prepare("SELECT id,status FROM jobs WHERE id IN ('old','new') ORDER BY id").all(), [{ id: 'new', status: 'queued' }, { id: 'old', status: 'failed' }]);
  } finally { await app.close(); db.close(); }
});

test('管理员可以排队、暂停、恢复、取消作业，非法状态变更返回冲突', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: header, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const created = await app.inject({ method: 'POST', url: '/api/v2/admin/jobs', headers: { ...header, cookie }, payload: { type: 'health_check' } });
    assert.equal(created.statusCode, 200);
    const job = JobSchema.parse(created.json());
    assert.equal(job.status, 'queued');
    const list = await app.inject({ method: 'GET', url: '/api/v2/admin/jobs?status=queued', headers: { cookie } });
    assert.equal(JobList.parse(list.json()).jobs[0]?.id, job.id);
    const action = (name: string) => app.inject({ method: 'POST', url: `/api/v2/admin/jobs/${job.id}/${name}`, headers: { ...header, cookie } });
    assert.equal(JobSchema.parse((await action('pause')).json()).status, 'paused');
    assert.equal((await action('pause')).statusCode, 409);
    assert.equal(JobSchema.parse((await action('resume')).json()).status, 'queued');
    assert.equal(JobSchema.parse((await action('cancel')).json()).status, 'cancelled');
    assert.equal(JobSchema.parse((await action('retry')).json()).status, 'queued');
    assert.equal((await action('invalid')).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/admin/jobs' })).statusCode, 401);
  } finally { await app.close(); db.close(); }
});

test('全库缩略图作业同一范围只排队一个，不同媒体库互不影响', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: header, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const create = () => app.inject({ method: 'POST', url: '/api/v2/admin/jobs', headers: { ...header, cookie }, payload: { type: 'thumbnails' } });
    const first = await create();
    assert.equal(first.statusCode, 200);
    assert.equal((await create()).statusCode, 409);
    const id = JobSchema.parse(first.json()).id;
    await app.inject({ method: 'POST', url: `/api/v2/admin/jobs/${id}/cancel`, headers: { ...header, cookie } });
    assert.equal((await create()).statusCode, 200);
    // 已下线的“补全照片宽高”参数不能被忽略后变成生成全库缩略图
    const legacy = await app.inject({ method: 'POST', url: '/api/v2/admin/jobs', headers: { ...header, cookie }, payload: { type: 'thumbnails', libraryId: undefined, dimensionsOnly: true } });
    assert.equal(legacy.statusCode, 400);
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails' AND status='queued'").get() as { n: number }).n, 1);
  } finally { await app.close(); db.close(); }
});

test('系统信息展示 worker 的 FFmpeg 试编码探测结果', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: header, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    db.prepare("INSERT INTO settings(key,value) VALUES('worker.ffmpeg',?)").run(JSON.stringify({ available: true, version: 'fixture', hwaccels: ['nvenc'], encoder: 'nvenc' }));
    const response = await app.inject({ method: 'GET', url: '/api/v2/admin/system', headers: { cookie } });
    assert.equal(response.statusCode, 200);
    const system = SystemInfo.parse(response.json());
    assert.deepEqual(system.ffmpeg, { available: true, version: 'fixture', hwaccels: ['nvenc'] });
    assert.equal(typeof system.sharp.heif, 'boolean');
  } finally { await app.close(); db.close(); }
});

test('SSE 向管理员推送作业事件', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  const controller = new AbortController();
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: header, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v2/events`, { headers: { cookie }, signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /^text\/event-stream/);
    const reader = response.body!.getReader();
    const created = await app.inject({ method: 'POST', url: '/api/v2/admin/jobs', headers: { ...header, cookie }, payload: { type: 'health_check' } });
    assert.equal(created.statusCode, 200);
    const deadline = setTimeout(() => controller.abort(), 3000);
    let text = '';
    try {
      while (!text.includes('event: job')) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        text += new TextDecoder().decode(chunk.value);
      }
    } finally { clearTimeout(deadline); }
    const data = text.match(/data: (.+)/)?.[1];
    assert.ok(data);
    assert.equal(JobSchema.parse(JSON.parse(data)).id, created.json().id);
  } finally { controller.abort(); await app.close(); db.close(); }
});
