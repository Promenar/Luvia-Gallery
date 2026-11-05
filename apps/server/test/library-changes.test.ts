import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LibraryChangeList } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

test('最近变更仅管理员可查询，按时间倒序并限制条数', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const url = '/api/v2/admin/libraries/lib/changes';
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401);
    const empty = await app.inject({ method: 'GET', url, headers: { cookie } });
    assert.equal(empty.statusCode, 200);
    assert.deepEqual(LibraryChangeList.parse(empty.json()), { changes: [] });
    const insert = db.prepare('INSERT INTO library_changes(library_id,ts,kind,path,from_path,is_dir,media_id,source) VALUES (?,?,?,?,?,?,?,?)');
    const ts = Date.now();
    insert.run('lib', ts - 1000, 'added', 'a.jpg', null, 0, 'f', 'scan');
    insert.run('lib', ts, 'moved', 'b.jpg', 'a.jpg', 0, 'f', 'watch');
    const result = await app.inject({ method: 'GET', url: `${url}?limit=1`, headers: { cookie } });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(LibraryChangeList.parse(result.json()).changes, [{ ts: new Date(ts).toISOString(), kind: 'moved', path: 'b.jpg', fromPath: 'a.jpg', isDir: false, mediaId: 'f', source: 'watch' }]);
    assert.equal((await app.inject({ method: 'GET', url: `${url}?limit=501`, headers: { cookie } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/admin/libraries/unknown/changes', headers: { cookie } })).statusCode, 404);
  } finally { await app.close(); db.close(); }
});

test('写入变更时清除 30 天前的记录并保留近期记录', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    const { appendLibraryChange } = await import('../src/core/library-changes.ts');
    const now = Date.now();
    const change = { kind: 'added' as const, path: 'a.jpg', fromPath: null, isDir: false, mediaId: 'f', source: 'scan' as const };
    appendLibraryChange(db, 'lib', { ...change, ts: new Date(now - 31 * 86_400_000).toISOString() }, now - 31 * 86_400_000);
    appendLibraryChange(db, 'lib', { ...change, path: 'b.jpg', ts: new Date(now).toISOString() }, now);
    assert.deepEqual(db.prepare('SELECT path FROM library_changes').all(), [{ path: 'b.jpg' }]);
  } finally { db.close(); }
});
