import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Job as JobSchema, JobList } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

const header = { 'x-luvia-request': '1' };

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
