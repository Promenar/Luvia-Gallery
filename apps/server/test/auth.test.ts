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

test('迁移待处理时禁止匿名初始化；会话写请求必须携带自定义头', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: true });
  try {
    let res = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'password' } });
    assert.equal(res.statusCode, 503);
    res = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: header, payload: { username: 'admin', password: 'password' } });
    assert.equal(res.statusCode, 503);
    assert.equal((db.prepare('SELECT count(*) AS n FROM users').get() as { n: number }).n, 0);
  } finally { await app.close(); db.close(); }
});

test('匿名初始化与登录无需会话 CSRF 标头，会话写入仍受保护', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    const account = { username: 'admin', password: 'test password' };
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: account });
    assert.equal(setup.statusCode, 200);
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/v2/me/preferences', headers: { cookie }, payload: { density: 2 } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: account })).statusCode, 200);
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

test('偏好补丁深度合并并保留未修改字段', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: header, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    assert.equal(setup.json().user.preferences.theme.accent, 'dynamic');
    let res = await app.inject({ method: 'PATCH', url: '/api/v2/me/preferences', headers: { ...header, cookie }, payload: { home: { heroSource: 'folder', heroFolder: 'lib/trip' }, slideshow: { intervalSec: 9, loop: false }, folderIncludeSubfolders: true } });
    assert.equal(res.statusCode, 200);
    res = await app.inject({ method: 'PATCH', url: '/api/v2/me/preferences', headers: { ...header, cookie }, payload: { home: { heroSource: 'favorites' }, slideshow: { order: 'shuffle' } } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().home, { heroSource: 'favorites', heroFolder: 'lib/trip' });
    assert.deepEqual(res.json().slideshow, { intervalSec: 9, order: 'shuffle', kenBurns: true, loop: false });
    assert.equal(res.json().folderIncludeSubfolders, true);
  } finally { await app.close(); db.close(); }
});

test('壁纸令牌可创建并合并修改，普通令牌不接受壁纸配置', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: header, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const created = await app.inject({ method: 'POST', url: '/api/v2/me/tokens', headers: { ...header, cookie }, payload: { name: '壁纸', scope: 'wallpaper', wallpaper: { source: 'folder', folder: 'lib/a', landscapeOnly: false } } });
    assert.equal(created.statusCode, 200);
    const { token, meta } = CreatedToken.parse(created.json());
    assert.equal(meta.wallpaper?.source, 'folder');
    assert.equal(meta.wallpaper?.folder, 'lib/a');
    assert.equal(meta.wallpaper?.landscapeOnly, false);
    const patched = await app.inject({ method: 'PATCH', url: `/api/v2/me/tokens/${meta.id}`, headers: { ...header, cookie }, payload: { wallpaper: { includeVideos: true }, name: '桌面' } });
    assert.equal(patched.statusCode, 200);
    assert.deepEqual(patched.json().wallpaper, { source: 'folder', folder: 'lib/a', landscapeOnly: false, includeVideos: true, intervalSec: 30 });
    const listed = await app.inject({ method: 'GET', url: '/api/v2/me/tokens', headers: { cookie } });
    assert.deepEqual(listed.json().tokens[0].wallpaper, patched.json().wallpaper);
    assert.equal(JSON.stringify(listed.json()).includes(token), false);
    const denied = await app.inject({ method: 'PATCH', url: `/api/v2/me/tokens/${meta.id}`, headers: { cookie }, payload: { name: '拒绝' } });
    assert.equal(denied.statusCode, 403);
    const bearer = await app.inject({ method: 'PATCH', url: '/api/v2/me/preferences', headers: { authorization: `Bearer ${token}` }, payload: { density: 1 } });
    assert.equal(bearer.statusCode, 403);
    assert.notEqual(bearer.json().error.message, '请求缺少安全标头');
    const readToken = await app.inject({ method: 'POST', url: '/api/v2/me/tokens', headers: { ...header, cookie }, payload: { name: '读取', scope: 'read', wallpaper: { source: 'library' } } });
    assert.equal(readToken.statusCode, 400);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v2/me/tokens/${meta.id}`, headers: { ...header, cookie } })).statusCode, 204);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/media/random', headers: { authorization: `Bearer ${token}` } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/me/tokens', headers: { cookie } })).json().tokens.length, 0);
  } finally { await app.close(); db.close(); }
});
