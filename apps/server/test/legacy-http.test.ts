import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { runNextJob } from '../src/worker/runner.ts';

test('v1 壁纸令牌、结果字段、文件和文件夹接口与旧客户端兼容', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-v1-http-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-v1-cache-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, cacheDir: cache, legacyJwtSecret: 'synthetic-only-secret' });
  try {
    await mkdir(path.join(root, 'inside'));
    const filename = path.join(root, 'inside', 'photo.jpg');
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#789abc' } }).jpeg().toFile(filename);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const file = db.prepare('SELECT id,modified_at,size,mime FROM files').get() as { id: string; modified_at: number; size: number; mime: string };
    db.prepare('UPDATE files SET width=64,height=48 WHERE id=?').run(file.id);
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const tokenResponse = await app.inject({ method: 'POST', url: '/api/v2/me/tokens', headers: { cookie, 'x-luvia-request': '1' }, payload: { name: '壁纸', scope: 'wallpaper', wallpaper: { source: 'folder', folder: 'lib/inside', landscapeOnly: true, includeVideos: false } } });
    const token = tokenResponse.json().token as string;
    const result = await app.inject({ method: 'GET', url: `/api/scan/results?random=true&limit=10&token=${token}` });
    assert.equal(result.statusCode, 200);
    const body = result.json();
    assert.deepEqual(Object.keys(body).sort(), ['files', 'hasMore', 'sources', 'total', 'totalExact']);
    assert.equal(body.files.length, 1);
    const id = Buffer.from(filename).toString('base64');
    assert.deepEqual(body.files[0], { id, url: `/api/file/${encodeURIComponent(id)}`, thumbnailUrl: `/api/thumb/${encodeURIComponent(id)}`, name: 'photo.jpg', path: filename,
      folderPath: path.dirname(filename), size: file.size, type: file.mime, lastModified: file.modified_at, mediaType: 'image', sourceId: 'local', isFavorite: false, width: 64, height: 48, aspectRatio: 64 / 48 });
    assert.deepEqual(body.sources, [{ id: 'local', name: 'Local Storage', count: body.total, countExact: body.totalExact }]);
    const original = await app.inject({ method: 'GET', url: `${body.files[0].url}?token=${token}`, headers: { range: 'bytes=0-9' } });
    assert.equal(original.statusCode, 206); assert.equal(original.rawPayload.length, 10);
    const thumbRequest = app.inject({ method: 'GET', url: `${body.files[0].thumbnailUrl}?token=${token}` });
    for (let i = 0; i < 100; i++) {
      if ((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails' AND status='queued'").get() as { n: number }).n) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    await runNextJob(db, { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache });
    assert.equal((await thumbRequest).statusCode, 200);
    const folders = await app.inject({ method: 'GET', url: `/api/library/folders?parentPath=${encodeURIComponent(root)}&token=${token}` });
    assert.equal(folders.statusCode, 200);
    assert.deepEqual(folders.json().folders[0], { name: 'inside', path: path.join(root, 'inside'), mediaCount: 1, coverMedia: null, lastModified: Math.floor((await stat(filename)).mtimeMs / 1000), isFavorite: false });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'test password' } });
    assert.equal(login.statusCode, 200); assert.ok(login.json().token); assert.equal(login.json().user.username, 'admin');
    assert.equal((await app.inject({ method: 'GET', url: '/api/scan/results?limit=1', headers: { authorization: `Bearer ${login.json().token}` } })).statusCode, 200);
    const pastEnd = await app.inject({ method: 'GET', url: '/api/scan/results?limit=1&offset=10', headers: { authorization: `Bearer ${login.json().token}` } });
    assert.deepEqual(pastEnd.json().files, []);
    await app.inject({ method: 'PATCH', url: `/api/v2/me/tokens/${tokenResponse.json().meta.id}`, headers: { cookie, 'x-luvia-request': '1' }, payload: { wallpaper: { folder: null } } });
    const noFolder = await app.inject({ method: 'GET', url: `/api/scan/results?random=true&token=${token}` });
    assert.deepEqual(noFolder.json().files, []);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media?token=${token}` })).statusCode, 400);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('壁纸配置控制收藏文件夹、横竖比例与视频范围', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const user = setup.json().user.id;
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/synthetic')").run();
    const add = db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,width,height) VALUES (?,'lib',?,?,?,?,?,1,1,1,'mtime',?,?)");
    add.run('a', 'a.jpg', 'lib', 'a.jpg', 'image/jpeg', 'image', 100, 50);
    add.run('b', 'fav/b.mp4', 'lib/fav', 'b.mp4', 'video/mp4', 'video', 100, 50);
    add.run('c', 'fav/c.jpg', 'lib/fav', 'c.jpg', 'image/jpeg', 'image', 50, 100);
    add.run('d', 'd.jpg', 'lib', 'd.jpg', 'image/jpeg', 'image', 100, 50);
    db.prepare("INSERT INTO favorites(user_id,item_id,item_type) VALUES (?, 'a', 'file'), (?, 'lib/fav', 'folder')").run(user, user);
    const created = await app.inject({ method: 'POST', url: '/api/v2/me/tokens', headers: { cookie, 'x-luvia-request': '1' }, payload: { name: '壁纸', scope: 'wallpaper', wallpaper: { source: 'favorites', landscapeOnly: true, includeVideos: false } } });
    const token = created.json().token as string; const id = created.json().meta.id as string;
    const names = async () => {
      const res = await app.inject({ method: 'GET', url: `/api/scan/results?random=true&limit=10&token=${token}` });
      assert.equal(res.statusCode, 200);
      return (res.json().files as { name: string }[]).map((item) => item.name).sort();
    };
    assert.deepEqual(await names(), ['a.jpg']);
    const patch = (wallpaper: object) => app.inject({ method: 'PATCH', url: `/api/v2/me/tokens/${id}`, headers: { cookie, 'x-luvia-request': '1' }, payload: { wallpaper } });
    await patch({ includeVideos: true });
    assert.deepEqual(await names(), ['a.jpg', 'b.mp4']);
    await patch({ landscapeOnly: false });
    assert.deepEqual(await names(), ['a.jpg', 'b.mp4', 'c.jpg']);
  } finally { await app.close(); db.close(); }
});
