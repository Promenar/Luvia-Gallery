import { test } from 'node:test';
import { scryptSync } from 'node:crypto';
import assert from 'node:assert/strict';
import { AuthState, UserResponse, CreatedToken } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

const header = { 'x-luvia-request': '1' };

test('初始化、会话、访问令牌和密码更改后会话撤销', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    let res = await app.inject({ method: 'GET', url: '/api/v2/auth/state' });
    assert.deepEqual(AuthState.parse(res.json()).initialized, false);
    res = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: header, payload: { username: 'admin', password: 'correct horse' } });
    assert.equal(res.statusCode, 200);
    assert.equal(UserResponse.parse(res.json()).user.role, 'admin');
    const cookie = res.headers['set-cookie'];
    assert.ok(typeof cookie === 'string' && cookie.includes('HttpOnly') && cookie.includes('SameSite=Lax'));
    const session = cookie.split(';')[0]!;
    res = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: header, payload: { username: 'other', password: 'correct horse' } });
    assert.equal(res.statusCode, 409);
    res = await app.inject({ method: 'GET', url: '/api/v2/auth/state', headers: { cookie: session } });
    assert.equal(AuthState.parse(res.json()).user?.username, 'admin');
    res = await app.inject({ method: 'POST', url: '/api/v2/me/tokens', headers: { ...header, cookie: session }, payload: { name: '设备', scope: 'read' } });
    assert.equal(res.statusCode, 200);
    const token = CreatedToken.parse(res.json()).token;
    assert.equal((db.prepare('SELECT count(*) AS n FROM api_tokens WHERE token_hash = ?').get(token) as { n: number }).n, 0);
    res = await app.inject({ method: 'GET', url: '/api/v2/auth/state', headers: { authorization: `Bearer ${token}` } });
    assert.equal(AuthState.parse(res.json()).user?.username, 'admin');
    res = await app.inject({ method: 'PATCH', url: '/api/v2/me/preferences', headers: { ...header, authorization: `Bearer ${token}` }, payload: { density: 2 } });
    assert.equal(res.statusCode, 403);
    res = await app.inject({ method: 'GET', url: `/api/v2/auth/state?token=${token}` });
    assert.equal(res.statusCode, 400);
    res = await app.inject({ method: 'POST', url: '/api/v2/me/password', headers: { ...header, cookie: session }, payload: { current: 'correct horse', next: 'new correct horse' } });
    assert.equal(res.statusCode, 204);
    res = await app.inject({ method: 'GET', url: '/api/v2/auth/state', headers: { cookie: session } });
    assert.equal(AuthState.parse(res.json()).user, null);
    res = await app.inject({ method: 'POST', url: '/api/v2/auth/login', headers: header, payload: { username: 'admin', password: 'new correct horse' } });
    assert.equal(res.statusCode, 200);
    UserResponse.parse(res.json());
  } finally { await app.close(); db.close(); }
});

test('迁移待处理时禁止匿名初始化；跨站请求必须携带自定义头', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: true });
  try {
    let res = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'password' } });
    assert.equal(res.statusCode, 403);
    res = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: header, payload: { username: 'admin', password: 'password' } });
    assert.equal(res.statusCode, 503);
    assert.equal((db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n, 0);
  } finally { await app.close(); db.close(); }
});

test('登录兼容旧版 scrypt 与历史明文并升级', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    db.prepare("INSERT INTO users (id,username,password_hash,role,preferences,created_at) VALUES ('1','old','old password','admin','{}',1)").run();
    let res = await app.inject({ method: 'POST', url: '/api/v2/auth/login', headers: header, payload: { username: 'old', password: 'old password' } });
    assert.equal(res.statusCode, 200);
    assert.match((db.prepare("SELECT password_hash FROM users WHERE id='1'").get() as { password_hash: string }).password_hash, /^scrypt\$v2\$/);
    const salt = Buffer.alloc(16, 3);
    const oldHash = `scrypt$${salt.toString('hex')}$${scryptSync('legacy password', salt, 64).toString('hex')}`;
    db.prepare("INSERT INTO users (id,username,password_hash,role,preferences,created_at) VALUES ('2','hash',?,'user','{}',1)").run(oldHash);
    res = await app.inject({ method: 'POST', url: '/api/v2/auth/login', headers: header, payload: { username: 'hash', password: 'legacy password' } });
    assert.equal(res.statusCode, 200);
    assert.match((db.prepare("SELECT password_hash FROM users WHERE id='2'").get() as { password_hash: string }).password_hash, /^scrypt\$v2\$/);
  } finally { await app.close(); db.close(); }
});
