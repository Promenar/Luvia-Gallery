import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LibraryChangedEvent } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('同库扫描与监控事件跨连接节流并持久合并', async () => {
  const mod = await import('../src/worker/watch-events.ts').catch(() => null);
  assert.ok(mod, '媒体库事件持久节流尚未接入');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-event-')); const filename = path.join(dir, 'db.sqlite');
  const db = openDatabase(filename); const other = openDatabase(filename);
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/lib')").run();
    mod.publishLibraryEvent(db, { libraryId: 'lib', source: 'scan', folders: ['lib/a'], added: 1, removed: 0, updated: 0, moved: 0 }, 1000);
    mod.publishLibraryEvent(other, { libraryId: 'lib', source: 'watch', folders: ['lib/a/b'], added: 1, removed: 0, updated: 0, moved: 0 }, 2000);
    mod.publishLibraryEvent(db, { libraryId: 'lib', source: 'scan', folders: ['lib/a'], added: 0, removed: 1, updated: 0, moved: 0 }, 2100);
    assert.equal((db.prepare("SELECT count(*) n FROM job_events WHERE event_type='library'").get() as {n:number}).n, 1);
    assert.equal(mod.flushLibraryEvents(db, 2999), 0);
    assert.equal(mod.flushLibraryEvents(db, 3000), 1);
    assert.equal(mod.flushLibraryEvents(db, 4999), 0);
    assert.equal(mod.flushLibraryEvents(db, 5000), 1);
    const rows = db.prepare("SELECT payload FROM job_events WHERE event_type='library' ORDER BY id").all() as {payload:string}[];
    assert.deepEqual(rows.map((row) => LibraryChangedEvent.parse(JSON.parse(row.payload)).source), ['scan','watch','scan']);
    assert.equal(LibraryChangedEvent.parse(JSON.parse(rows[1]!.payload)).added, 1);
    assert.equal((db.prepare("SELECT last_event_at FROM library_watch_state WHERE library_id='lib'").get() as {last_event_at:string}).last_event_at, new Date(5000).toISOString());
  } finally { other.close(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('发布的媒体库事件经 SSE 按用户目录权限过滤', async () => {
  const { publishLibraryEvent } = await import('../src/worker/watch-events.ts');
  const { createApp } = await import('../src/api/app.ts');
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  let timer: NodeJS.Timeout | undefined;
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/lib')").run();
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const admin = (setup.headers['set-cookie'] as string).split(';')[0]!;
    await app.inject({ method: 'POST', url: '/api/v2/admin/users', headers: { cookie: admin, 'x-luvia-request': '1' }, payload: { username: 'limited', password: 'test password', allowedPaths: ['lib/allowed'] } });
    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'limited', password: 'test password' } });
    const cookie = (login.headers['set-cookie'] as string).split(';')[0]!;
    publishLibraryEvent(db, { libraryId: 'lib', source: 'watch', folders: ['lib/allowed', 'lib/private'], added: 1, removed: 0, updated: 0, moved: 0 });
    timer = setTimeout(() => db.prepare('DELETE FROM sessions').run(), 800);
    const response = await app.inject({ method: 'GET', url: '/api/v2/events', headers: { cookie, 'last-event-id': '0' } });
    const match = response.body.match(/event: library\ndata: (.+)/); assert.ok(match);
    const event = LibraryChangedEvent.parse(JSON.parse(match[1]!));
    assert.equal(event.libraryId, 'lib'); assert.deepEqual(event.folders, ['lib/allowed']);
  } finally { if (timer) clearTimeout(timer); await app.close(); db.close(); }
});

test('事件合并时保留受限子目录，SSE 向有权用户发送变化', async () => {
  const { publishLibraryEvent, flushLibraryEvents } = await import('../src/worker/watch-events.ts');
  const { createApp } = await import('../src/api/app.ts');
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false }); let timer: NodeJS.Timeout | undefined;
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/lib')").run();
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const admin = (setup.headers['set-cookie'] as string).split(';')[0]!;
    await app.inject({ method: 'POST', url: '/api/v2/admin/users', headers: { cookie: admin, 'x-luvia-request': '1' }, payload: { username: 'limited', password: 'test password', allowedPaths: ['lib/allowed'] } });
    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'limited', password: 'test password' } });
    const cookie = (login.headers['set-cookie'] as string).split(';')[0]!;
    const event = (folders: string[]) => ({ libraryId: 'lib', source: 'watch' as const, folders, added: 1, removed: 0, updated: 0, moved: 0 });
    publishLibraryEvent(db, event(['lib/private']), 1000);
    publishLibraryEvent(db, event(['lib']), 1100); publishLibraryEvent(db, event(['lib/allowed']), 1200);
    flushLibraryEvents(db, 3000);
    timer = setTimeout(() => db.prepare('DELETE FROM sessions').run(), 800);
    const response = await app.inject({ method: 'GET', url: '/api/v2/events', headers: { cookie, 'last-event-id': '0' } });
    const match = response.body.match(/event: library\ndata: (.+)/); assert.ok(match);
    assert.deepEqual(LibraryChangedEvent.parse(JSON.parse(match[1]!)).folders, ['lib/allowed']);
  } finally { if (timer) clearTimeout(timer); await app.close(); db.close(); }
});
