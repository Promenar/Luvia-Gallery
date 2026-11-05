import { test } from 'node:test';
import assert from 'node:assert/strict';
import { User, UserList } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

test('管理员维护账户、目录权限及会话，并保护最后一位管理员', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const admin = User.parse(setup.json().user);
    const adminCookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const adminHeaders = { cookie: adminCookie, 'x-luvia-request': '1' };
    const call = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) => app.inject({ method, url, headers: adminHeaders, ...(payload === undefined ? {} : { payload }) });
    assert.equal((await call('POST', '/api/v2/admin/users', { username: 'bad', password: 'test password', allowedPaths: ['lib/../private'] })).statusCode, 400);
    const created = await call('POST', '/api/v2/admin/users', { username: 'guest', password: 'guest password', allowedPaths: ['lib/photos'] });
    assert.equal(created.statusCode, 200);
    const guest = User.parse(created.json());
    assert.deepEqual(guest.allowedPaths, ['lib/photos']);
    assert.equal((await call('POST', '/api/v2/admin/users', { username: 'guest', password: 'test password' })).statusCode, 409);
    const list = await app.inject({ method: 'GET', url: '/api/v2/admin/users', headers: { cookie: adminCookie } });
    assert.deepEqual(UserList.parse(list.json()).users.map((u) => u.username).sort(), ['admin', 'guest']);
    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', headers: { 'x-luvia-request': '1' }, payload: { username: 'guest', password: 'guest password' } });
    const guestCookie = (login.headers['set-cookie'] as string).split(';')[0]!;
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/admin/users', headers: { cookie: guestCookie } })).statusCode, 403);
    const updated = await call('PATCH', `/api/v2/admin/users/${guest.id}`, { allowedPaths: ['lib/other'], password: 'new guest password' });
    assert.equal(updated.statusCode, 200);
    assert.deepEqual(User.parse(updated.json()).allowedPaths, ['lib/other']);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/admin/users', headers: { cookie: guestCookie } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v2/auth/login', headers: { 'x-luvia-request': '1' }, payload: { username: 'guest', password: 'new guest password' } })).statusCode, 200);
    assert.equal((await call('PATCH', `/api/v2/admin/users/${admin.id}`, { role: 'user' })).statusCode, 409);
    assert.equal((await call('DELETE', `/api/v2/admin/users/${admin.id}`)).statusCode, 409);
    assert.equal((await call('PATCH', `/api/v2/admin/users/${guest.id}`, { role: 'admin' })).statusCode, 200);
    assert.equal(User.parse((await call('PATCH', `/api/v2/admin/users/${guest.id}`, { allowedPaths: ['lib/photos'] })).json()).allowedPaths, null);
    assert.equal((await call('DELETE', `/api/v2/admin/users/${admin.id}`)).statusCode, 204);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/admin/users', headers: { cookie: adminCookie } })).statusCode, 401);
  } finally { await app.close(); db.close(); }
});
