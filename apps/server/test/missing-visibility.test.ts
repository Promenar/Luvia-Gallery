import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';

test('缺失媒体从浏览、分桶、筛选、回忆、详情、分享、下载和旧版接口隐藏，关联保留', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-missing-visible-')); const parked = `${root}-parked`;
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    await mkdir(path.join(root, 'missing')); await writeFile(path.join(root, 'live.jpg'), 'live'); await writeFile(path.join(root, 'missing', 'hidden.jpg'), 'hidden');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] }); await scan();
    const rows = db.prepare('SELECT id,name FROM files ORDER BY name').all() as { id: string; name: string }[];
    const hidden = rows.find((r) => r.name === 'hidden.jpg')!.id; const live = rows.find((r) => r.name === 'live.jpg')!.id;
    db.prepare("UPDATE files SET model='MissingCamera',thumb_ready=1,thumb_version=1 WHERE id=?").run(hidden);
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!; const headers = { cookie, 'x-luvia-request': '1' }; const userId = setup.json().user.id as string;
    const album = await app.inject({ method: 'POST', url: '/api/v2/albums', headers, payload: { name: '相册', ids: [hidden, live] } });
    assert.equal(album.statusCode, 200);
    await app.inject({ method: 'PUT', url: '/api/v2/media/favorite', headers, payload: { ids: [hidden], favorite: true } });
    const share = await app.inject({ method: 'POST', url: '/api/v2/shares', headers, payload: { target: { type: 'media', ids: [hidden] }, allowDownload: true } });
    assert.equal(share.statusCode, 200); const shareBase = `/api/v2/public/shares/${share.json().token}`;
    const ticket = await app.inject({ method: 'POST', url: '/api/v2/downloads', headers, payload: { ids: [hidden] } }); assert.equal(ticket.statusCode, 200);
    await rename(path.join(root, 'missing'), parked); await scan(); await rename(parked, path.join(root, 'missing'));
    const get = (url: string) => app.inject({ method: 'GET', url, headers: { cookie } });
    assert.deepEqual((await get('/api/v2/media')).json().items.map((v: { id: string }) => v.id), [live]);
    assert.equal((await get('/api/v2/media/buckets')).json().total, 1);
    assert.deepEqual((await get('/api/v2/media/facets')).json().cameras, []);
    assert.deepEqual((await get('/api/v2/media/random?count=10')).json().items.map((v: { id: string }) => v.id), [live]);
    assert.deepEqual((await get('/api/v2/memories')).json().recentlyAdded.map((v: { id: string }) => v.id), [live]);
    const suggest = (await get('/api/v2/search/suggest?q=Missing')).json();
    assert.deepEqual(suggest.folders, []); assert.deepEqual(suggest.cameras, []); assert.deepEqual(suggest.media, []);
    assert.equal((await get(`/api/v2/media/${hidden}`)).statusCode, 404);
    assert.equal((await get(`/api/v2/media/${hidden}/original`)).statusCode, 404);
    assert.equal((await get('/api/v2/folders?path=lib%2Fmissing')).statusCode, 404);
    const folders = (await get('/api/v2/folders?path=lib')).json(); assert.equal(folders.directMediaCount, 1); assert.deepEqual(folders.folders, []);
    const overview = (await get('/api/v2/admin/overview')).json(); assert.equal(overview.media.total, 1); assert.equal(overview.media.missing, 1);
    db.prepare('UPDATE files SET missing_at_ms=? WHERE id=?').run(Date.now() - 8 * 86_400_000, hidden);
    assert.equal((await get('/api/v2/admin/overview')).json().media.missing, 0);
    db.prepare('UPDATE files SET missing_at_ms=? WHERE id=?').run(Date.now(), hidden);
    assert.equal((await get(`/api/v2/albums/${album.json().id}`)).json().count, 1);
    assert.deepEqual((await app.inject({ method: 'GET', url: `${shareBase}/media` })).json().items, []);
    assert.equal((await app.inject({ method: 'GET', url: `${shareBase}/media/${hidden}/original` })).statusCode, 404);
    assert.equal((await get(ticket.json().url)).statusCode, 403);
    assert.equal((await get('/api/scan/results')).json().files.some((v: { name: string }) => v.name === 'hidden.jpg'), false);
    assert.ok(db.prepare("SELECT 1 FROM favorites WHERE user_id=? AND item_id=?").get(userId, hidden));
    assert.ok(db.prepare('SELECT 1 FROM album_items WHERE album_id=? AND file_id=?').get(album.json().id, hidden));
    assert.equal((db.prepare('SELECT thumb_ready FROM files WHERE id=?').get(hidden) as { thumb_ready: number }).thumb_ready, 1);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(parked, { recursive: true, force: true }); }
});

test('旧版路径入口读取移动后保留原 ID 的媒体', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-legacy-moved-')); const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    await writeFile(path.join(root, 'a.jpg'), 'moved content');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] }); await scan();
    const id = (db.prepare('SELECT id FROM files').get() as { id: string }).id;
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    await rename(path.join(root, 'a.jpg'), path.join(root, 'b.jpg')); await scan();
    assert.equal((db.prepare("SELECT id FROM files WHERE relative_path='b.jpg'").get() as { id: string }).id, id);
    const legacyId = Buffer.from(path.join(root, 'b.jpg')).toString('base64');
    const response = await app.inject({ method: 'GET', url: `/api/file/${encodeURIComponent(legacyId)}`, headers: { cookie } });
    assert.equal(response.statusCode, 200); assert.equal(response.body, 'moved content');
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});
