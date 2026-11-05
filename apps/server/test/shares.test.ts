import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { PublicShare, Share, MediaPage } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';

test('分享密码、目标、下载权限、所有者目录权限和撤销均在每次访问时检查', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-shares-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    await sharp({ create: { width: 16, height: 12, channels: 3, background: '#789' } }).jpeg().toFile(path.join(root, 'one.jpg'));
    await sharp({ create: { width: 16, height: 12, channels: 3, background: '#456' } }).jpeg().toFile(path.join(root, 'two.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const ids = db.prepare('SELECT id,name FROM files ORDER BY name').all() as { id: string; name: string }[];
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const ownerCookie = (setup.headers['set-cookie'] as string).split(';')[0]!; const owner = { cookie: ownerCookie, 'x-luvia-request': '1' };
    const created = await app.inject({ method: 'POST', url: '/api/v2/shares', headers: owner, payload: { title: '照片', target: { type: 'media', ids: [ids[0]!.id] }, password: 'test password', allowDownload: false } });
    assert.equal(created.statusCode, 200);
    const share = Share.parse(created.json()); assert.equal(share.mediaCount, 1); assert.equal(share.hasPassword, true);
    const base = `/api/v2/public/shares/${share.token}`;
    const locked = PublicShare.parse((await app.inject({ method: 'GET', url: base })).json());
    assert.equal(locked.unlocked, false); assert.equal(locked.mediaCount, null); assert.equal(locked.cover, null);
    assert.equal((await app.inject({ method: 'GET', url: `${base}/media` })).statusCode, 403);
    assert.equal((await app.inject({ method: 'POST', url: `${base}/unlock`, headers: { 'x-luvia-request': '1' }, payload: { password: 'incorrect' } })).statusCode, 401);
    const unlock = await app.inject({ method: 'POST', url: `${base}/unlock`, payload: { password: 'test password' } });
    assert.equal(unlock.statusCode, 204);
    const shareCookie = (unlock.headers['set-cookie'] as string).split(';')[0]!;
    assert.equal(PublicShare.parse((await app.inject({ method: 'GET', url: base, headers: { cookie: shareCookie } })).json()).unlocked, true);
    const page = await app.inject({ method: 'GET', url: `${base}/media`, headers: { cookie: shareCookie } });
    assert.deepEqual(MediaPage.parse(page.json()).items.map((item) => item.id), [ids[0]!.id]);
    assert.equal((await app.inject({ method: 'GET', url: `${base}/media/${ids[0]!.id}/original`, headers: { cookie: shareCookie } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: `${base}/media/${ids[1]!.id}/original`, headers: { cookie: shareCookie } })).statusCode, 404);
    db.prepare("UPDATE users SET role='user',allowed_paths=? WHERE username='admin'").run(JSON.stringify(['lib/elsewhere']));
    assert.equal(MediaPage.parse((await app.inject({ method: 'GET', url: `${base}/media`, headers: { cookie: shareCookie } })).json()).items.length, 0);
    db.prepare("UPDATE users SET role='admin',allowed_paths=NULL WHERE username='admin'").run();
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v2/shares/${share.id}`, headers: owner })).statusCode, 204);
    assert.equal((await app.inject({ method: 'GET', url: base, headers: { cookie: shareCookie } })).statusCode, 404);
    const openRes = await app.inject({ method: 'POST', url: '/api/v2/shares', headers: owner, payload: { target: { type: 'folder', path: 'lib' }, allowDownload: true } });
    const open = Share.parse(openRes.json());
    const range = await app.inject({ method: 'GET', url: `/api/v2/public/shares/${open.token}/media/${ids[0]!.id}/original`, headers: { range: 'bytes=0-9' } });
    assert.equal(range.statusCode, 206); assert.equal(range.rawPayload.length, 10);
    db.prepare('UPDATE shares SET expires_at=1 WHERE id=?').run(open.id);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/public/shares/${open.token}` })).statusCode, 404);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('分享在缩略图生成期间被撤销时不会向等待中的访客返回媒体', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-share-revoke-')); const cache = await mkdtemp(path.join(tmpdir(), 'luvia-share-cache-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  try {
    await sharp({ create: { width: 30, height: 20, channels: 3, background: '#789' } }).jpeg().toFile(path.join(root, 'one.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const { id } = db.prepare('SELECT id FROM files').get() as { id: string };
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!; const headers = { cookie, 'x-luvia-request': '1' };
    const created = await app.inject({ method: 'POST', url: '/api/v2/shares', headers, payload: { target: { type: 'media', ids: [id] } } });
    const share = Share.parse(created.json());
    const pending = app.inject({ method: 'GET', url: `/api/v2/public/shares/${share.token}/media/${id}/thumb?size=s` });
    for (let index = 0; index < 100; index++) {
      if ((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails' AND status='queued'").get() as { n: number }).n) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v2/shares/${share.id}`, headers })).statusCode, 204);
    const { runNextJob } = await import('../src/worker/runner.ts');
    await runNextJob(db, { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache });
    assert.equal((await pending).statusCode, 404);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('相册分享实时应用智能筛选，创建时检查所有权及目录边界', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片'),('lib/visible','lib','lib','可见'),('lib/private','lib','lib','私密')").run();
    const add = db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES (?,'lib',?,?,?,'image/jpeg',?,1,1,1,'mtime')");
    add.run('one', 'visible/one.jpg', 'lib/visible', 'one.jpg', 'image');
    add.run('two', 'visible/two.mp4', 'lib/visible', 'two.mp4', 'video');
    add.run('secret', 'private/secret.jpg', 'lib/private', 'secret.jpg', 'image');
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const adminCookie = (setup.headers['set-cookie'] as string).split(';')[0]!; const admin = { cookie: adminCookie, 'x-luvia-request': '1' };
    const adminAlbum = await app.inject({ method: 'POST', url: '/api/v2/albums', headers: admin, payload: { name: '管理员相册' } });
    await app.inject({ method: 'POST', url: '/api/v2/admin/users', headers: admin, payload: { username: 'guest', password: 'guest password', allowedPaths: ['lib/visible'] } });
    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', headers: { 'x-luvia-request': '1' }, payload: { username: 'guest', password: 'guest password' } });
    const guestCookie = (login.headers['set-cookie'] as string).split(';')[0]!; const guest = { cookie: guestCookie, 'x-luvia-request': '1' };
    const create = (target: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v2/shares', headers: guest, payload: { target } });
    assert.equal((await create({ type: 'media', ids: ['one', 'secret'] })).statusCode, 403);
    assert.equal((await create({ type: 'folder', path: 'lib/private' })).statusCode, 403);
    assert.equal((await create({ type: 'album', albumId: adminAlbum.json().id })).statusCode, 404);
    const album = await app.inject({ method: 'POST', url: '/api/v2/albums', headers: guest, payload: { name: '智能相册', kind: 'smart', filter: { types: ['image'] } } });
    await app.inject({ method: 'PUT', url: '/api/v2/media/favorite', headers: guest, payload: { ids: ['one'], favorite: true } });
    const share = Share.parse((await create({ type: 'album', albumId: album.json().id })).json());
    const url = `/api/v2/public/shares/${share.token}/media`;
    const first = MediaPage.parse((await app.inject({ method: 'GET', url })).json());
    assert.deepEqual(first.items.map((item) => [item.id, item.favorite]), [['one', false]]);
    await app.inject({ method: 'PATCH', url: `/api/v2/albums/${album.json().id}`, headers: guest, payload: { filter: { types: ['video'] } } });
    assert.deepEqual(MediaPage.parse((await app.inject({ method: 'GET', url })).json()).items.map((item) => item.id), ['two']);
    db.prepare("UPDATE libraries SET enabled=0 WHERE id='lib'").run();
    assert.equal(MediaPage.parse((await app.inject({ method: 'GET', url })).json()).items.length, 0);
  } finally { await app.close(); db.close(); }
});
