import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

test('会话仍有效但目录权限变化时通过 SSE 通知客户端', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  const timers: NodeJS.Timeout[] = [];
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const admin = (setup.headers['set-cookie'] as string).split(';')[0]!;
    await app.inject({ method: 'POST', url: '/api/v2/admin/users', headers: { cookie: admin, 'x-luvia-request': '1' }, payload: { username: 'limited', password: 'test password', allowedPaths: ['lib/allowed'] } });
    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'limited', password: 'test password' } });
    const cookie = (login.headers['set-cookie'] as string).split(';')[0]!;
    const response = app.inject({ method: 'GET', url: '/api/v2/events', headers: { cookie } });
    timers.push(setTimeout(() => db.prepare("UPDATE users SET allowed_paths=? WHERE username='limited'").run(JSON.stringify(['lib/other'])), 300));
    timers.push(setTimeout(() => db.prepare('DELETE FROM sessions').run(), 900));
    assert.match((await response).body, /event: session\ndata: \{"reason":"permissions_changed"\}/);
  } finally { timers.forEach(clearTimeout); await app.close(); db.close(); }
});

test('空目录 library 事件只发给不受目录限制的用户', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  let timer: NodeJS.Timeout | undefined;
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const adminCookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    await app.inject({ method: 'POST', url: '/api/v2/admin/users', headers: { cookie: adminCookie, 'x-luvia-request': '1' }, payload: { username: 'limited', password: 'test password', allowedPaths: ['lib/allowed'] } });
    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'limited', password: 'test password' } });
    const limitedCookie = (login.headers['set-cookie'] as string).split(';')[0]!;
    const insert = db.prepare("INSERT INTO job_events(event_type,payload) VALUES ('library',?)");
    insert.run(JSON.stringify({ libraryId: null, source: 'scan', folders: [], added: 7, removed: 0, updated: 0, moved: 0 }));
    insert.run(JSON.stringify({ libraryId: 'lib', source: 'watch', folders: ['lib/allowed', 'lib/private'], added: 1, removed: 0, updated: 0, moved: 0 }));
    const headers = { 'last-event-id': '0' };
    const admin = app.inject({ method: 'GET', url: '/api/v2/events', headers: { ...headers, cookie: adminCookie } });
    const limited = app.inject({ method: 'GET', url: '/api/v2/events', headers: { ...headers, cookie: limitedCookie } });
    timer = setTimeout(() => db.prepare('DELETE FROM sessions').run(), 1000);
    const [adminResponse, limitedResponse] = await Promise.all([admin, limited]);
    clearTimeout(timer); timer = undefined;
    assert.equal(adminResponse.statusCode, 200); assert.equal(limitedResponse.statusCode, 200);
    const events = (body: string) => [...body.matchAll(/event: library\ndata: (.+)/g)].map((match) => JSON.parse(match[1]!));
    assert.deepEqual(events(adminResponse.body).map((event) => event.folders), [[], ['lib/allowed', 'lib/private']]);
    assert.deepEqual(events(limitedResponse.body).map((event) => event.folders), [['lib/allowed']]);
  } finally { if (timer) clearTimeout(timer); await app.close(); db.close(); }
});

test('SSE 每用户最多八条连接，断开后释放名额', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  const controllers = Array.from({ length: 10 }, () => new AbortController());
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookies = [(setup.headers['set-cookie'] as string).split(';')[0]!];
    await app.inject({ method: 'POST', url: '/api/v2/admin/users', headers: { cookie: cookies[0]!, 'x-luvia-request': '1' }, payload: { username: 'other', password: 'test password' } });
    const otherLogin = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'other', password: 'test password' } });
    const otherCookie = (otherLogin.headers['set-cookie'] as string).split(';')[0]!;
    for (let i = 0; i < 7; i++) {
      const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'admin', password: 'test password' } });
      cookies.push((login.headers['set-cookie'] as string).split(';')[0]!);
    }
    for (let i = 0; i < cookies.length; i++) {
      const response = await app.inject({ method: 'GET', url: '/api/v2/events', headers: { cookie: cookies[i]! }, payloadAsStream: true, signal: controllers[i]!.signal });
      assert.equal(response.statusCode, 200); response.stream().on('error', () => {});
    }
    const overflow = await app.inject({ method: 'GET', url: '/api/v2/events', headers: { cookie: cookies[0]! }, payloadAsStream: true });
    assert.equal(overflow.statusCode, 429); overflow.stream().resume();
    const other = await app.inject({ method: 'GET', url: '/api/v2/events', headers: { cookie: otherCookie }, payloadAsStream: true, signal: controllers[8]!.signal });
    assert.equal(other.statusCode, 200); other.stream().on('error', () => {});
    controllers[0]!.abort();
    let status = 429;
    for (let i = 0; i < 50 && status === 429; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const response = await app.inject({ method: 'GET', url: '/api/v2/events', headers: { cookie: cookies[1]! }, payloadAsStream: true, signal: controllers[9]!.signal });
      status = response.statusCode; response.stream().on('error', () => {});
    }
    assert.equal(status, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/events', headers: { cookie: cookies[1]! }, payloadAsStream: true })).statusCode, 429);
  } finally { for (const controller of controllers) controller.abort(); await app.close(); db.close(); }
});

test('SSE 客户端中断后回收并发名额', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  const controllers = Array.from({ length: 9 }, () => new AbortController());
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    for (let i = 0; i < 8; i++) {
      const response = await app.inject({ method: 'GET', url: '/api/v2/events', headers: { cookie }, payloadAsStream: true, signal: controllers[i]!.signal });
      assert.equal(response.statusCode, 200); response.stream().on('error', () => {});
    }
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/events', headers: { cookie } })).statusCode, 429);
    controllers[0]!.abort();
    let status = 429;
    for (let i = 0; i < 50 && status === 429; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const response = await app.inject({ method: 'GET', url: '/api/v2/events', headers: { cookie }, payloadAsStream: true, signal: controllers[8]!.signal });
      status = response.statusCode; response.stream().on('error', () => {});
    }
    assert.equal(status, 200);
  } finally { for (const controller of controllers) controller.abort(); await app.close(); db.close(); }
});
