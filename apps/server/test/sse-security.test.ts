import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

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
