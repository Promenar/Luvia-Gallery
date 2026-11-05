import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Album, AlbumList, MediaPage } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

test('手动与智能相册遵守成员、筛选及用户目录权限', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    const insert = db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source)
      VALUES (?,'lib',?,?,?,'image/jpeg',?,1,?,?, 'mtime')`);
    insert.run('one', 'visible/one.jpg', 'lib/visible', 'one.jpg', 'image', 10, 10);
    insert.run('two', 'visible/two.mp4', 'lib/visible', 'two.mp4', 'video', 20, 20);
    insert.run('secret', 'private/secret.jpg', 'lib/private', 'secret.jpg', 'image', 30, 30);
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const adminCookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const userCreate = await app.inject({ method: 'POST', url: '/api/v2/admin/users', headers: { cookie: adminCookie, 'x-luvia-request': '1' }, payload: { username: 'guest', password: 'guest password', allowedPaths: ['lib/visible'] } });
    assert.equal(userCreate.statusCode, 200);
    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', headers: { 'x-luvia-request': '1' }, payload: { username: 'guest', password: 'guest password' } });
    const cookie = (login.headers['set-cookie'] as string).split(';')[0]!;
    const headers = { cookie, 'x-luvia-request': '1' };
    const create = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v2/albums', headers, payload });
    assert.equal((await create({ name: '越权', ids: ['secret'] })).statusCode, 403);
    const manualRes = await create({ name: '旅程', ids: ['one', 'two', 'one'] });
    assert.equal(manualRes.statusCode, 200);
    const manual = Album.parse(manualRes.json());
    assert.equal(manual.count, 2); assert.equal(manual.cover?.id, 'two');
    assert.equal(manual.startAt, new Date(10_000).toISOString()); assert.equal(manual.endAt, new Date(20_000).toISOString());
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/albums/${manual.id}`, headers: { cookie: adminCookie } })).statusCode, 404);
    const filtered = await app.inject({ method: 'GET', url: `/api/v2/media?scope=album&albumId=${manual.id}&types=video`, headers: { cookie } });
    assert.deepEqual(MediaPage.parse(filtered.json()).items.map((item) => item.id), ['two']);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/v2/albums/${manual.id}`, headers, payload: { coverId: 'secret' } })).statusCode, 403);
    assert.equal(Album.parse((await app.inject({ method: 'PATCH', url: `/api/v2/albums/${manual.id}`, headers, payload: { coverId: 'one' } })).json()).cover?.id, 'one');
    const removed = await app.inject({ method: 'DELETE', url: `/api/v2/albums/${manual.id}/items`, headers, payload: { ids: ['one'] } });
    assert.equal(removed.statusCode, 200); assert.equal(removed.json().updated, 1);
    assert.equal(Album.parse((await app.inject({ method: 'GET', url: `/api/v2/albums/${manual.id}`, headers: { cookie } })).json()).cover?.id, 'two');
    const added = await app.inject({ method: 'POST', url: `/api/v2/albums/${manual.id}/items`, headers, payload: { ids: ['one', 'one'] } });
    assert.equal(added.statusCode, 200); assert.equal(added.json().updated, 1);
    assert.equal(Album.parse((await app.inject({ method: 'GET', url: `/api/v2/albums/${manual.id}`, headers: { cookie } })).json()).count, 2);
    const smartRes = await create({ name: '照片', kind: 'smart', filter: { types: ['image'] } });
    assert.equal(smartRes.statusCode, 200);
    const smart = Album.parse(smartRes.json());
    assert.equal(smart.count, 1); assert.equal(smart.cover?.id, 'one');
    const smartPage = await app.inject({ method: 'GET', url: `/api/v2/media?scope=album&albumId=${smart.id}`, headers: { cookie } });
    assert.deepEqual(MediaPage.parse(smartPage.json()).items.map((item) => item.id), ['one']);
    const intersection = await app.inject({ method: 'GET', url: `/api/v2/media?scope=album&albumId=${smart.id}&types=video`, headers: { cookie } });
    assert.equal(MediaPage.parse(intersection.json()).items.length, 0);
    assert.equal((await app.inject({ method: 'POST', url: `/api/v2/albums/${smart.id}/items`, headers, payload: { ids: ['two'] } })).statusCode, 409);
    assert.equal(AlbumList.parse((await app.inject({ method: 'GET', url: '/api/v2/albums', headers: { cookie } })).json()).albums.length, 2);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v2/albums/${manual.id}`, headers })).statusCode, 204);
  } finally { await app.close(); db.close(); }
});
