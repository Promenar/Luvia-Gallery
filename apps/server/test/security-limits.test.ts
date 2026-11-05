import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

test('登录账号和分享解锁分桶，同时保留每 IP 总体限速', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, legacyJwtSecret: 'test-signing-key' });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    assert.equal(setup.statusCode, 200);
    db.prepare(`INSERT INTO shares(id,user_id,token,title,target,password_hash,allow_download,created_at)
      SELECT 'share',id,'share-token','测试','{"type":"media","ids":[]}',password_hash,0,1 FROM users WHERE username='admin'`).run();
    const attempt = (url: string, username: string) => app.inject({ method: 'POST', url, payload: { username, password: 'wrong password' } });
    for (let i = 0; i < 10; i++) assert.equal((await attempt(i % 2 ? '/api/auth/login' : '/api/v2/auth/login', 'missing')).statusCode, 401);
    assert.equal((await attempt('/api/v2/auth/login', 'missing')).statusCode, 429);
    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'admin', password: 'test password' } });
    assert.equal(login.statusCode, 200);
    const unlock = await app.inject({ method: 'POST', url: '/api/v2/public/shares/share-token/unlock', payload: { password: 'test password' } });
    assert.equal(unlock.statusCode, 204);
    for (let i = 0; i < 9; i++) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/v2/public/shares/share-token/unlock', payload: { password: 'wrong password' } })).statusCode, 401);
    }
    assert.equal((await app.inject({ method: 'POST', url: '/api/v2/public/shares/share-token/unlock', payload: { password: 'wrong password' } })).statusCode, 429);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'admin', password: 'test password' } })).statusCode, 200);
  } finally { await app.close(); db.close(); }
});

test('代理信任默认关闭，启用跳数或 true 后区分转发的客户端', async () => {
  const previous = process.env.TRUST_PROXY;
  try {
    for (const config of [undefined, '1', 'true']) {
      if (config === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = config;
      const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
      try {
        const request = (ip: string) => app.inject({ method: 'POST', url: '/api/v2/auth/login', remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': ip }, payload: { username: 'missing', password: 'wrong password' } });
        for (let i = 0; i < 10; i++) assert.equal((await request('198.51.100.1')).statusCode, 401);
        assert.equal((await request('198.51.100.1')).statusCode, 429);
        assert.equal((await request('198.51.100.2')).statusCode, config === undefined ? 429 : 401);
      } finally { await app.close(); db.close(); }
    }
  } finally { if (previous === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = previous; }
});

test('单个 IP 的大量不同账号请求仍受总体上限约束', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    const attempt = (index: number) => app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: `missing${index}`, password: 'wrong password' } });
    for (let index = 0; index < 100; index++) assert.equal((await attempt(index)).statusCode, 401);
    assert.equal((await attempt(100)).statusCode, 429);
  } finally { await app.close(); db.close(); }
});

test('Fastify 客户端错误保留状态且不会写入错误日志', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  app.get('/test-internal-error', async () => { throw new Error('synthetic internal error'); });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const requests = [
      { method: 'POST' as const, url: '/api/v2/auth/login', headers: { 'content-type': 'application/json' }, payload: '{' },
      { method: 'POST' as const, url: '/api/v2/auth/login', headers: { 'content-type': 'application/json' }, payload: `"${'a'.repeat(1_048_576)}"` },
      { method: 'POST' as const, url: '/api/v2/auth/login', headers: { 'content-type': 'application/x-unsupported' }, payload: 'fixture' },
    ];
    const responses = [];
    for (const request of requests) responses.push(await app.inject(request));
    assert.deepEqual(responses.map((response) => response.statusCode), [400, 413, 415]);
    for (const response of responses) assert.match(response.json().error.message, /[\u4e00-\u9fff]/);
    const logs = () => app.inject({ method: 'GET', url: '/api/v2/admin/logs?level=error', headers: { cookie } });
    assert.deepEqual((await logs()).json().logs, []);
    assert.equal((await app.inject({ method: 'GET', url: '/test-internal-error' })).statusCode, 500);
    assert.equal((await logs()).json().logs.length, 1);
  } finally { await app.close(); db.close(); }
});
