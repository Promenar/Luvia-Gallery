import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { cachePath } from '../src/core/media-cache.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';

test('壁纸配置约束随机、旧版分页和全部媒体二进制读取', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-wallpaper-scope-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-wallpaper-cache-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  try {
    await mkdir(path.join(root, 'inside', 'nested'), { recursive: true });
    await mkdir(path.join(root, 'outside'));
    for (const name of ['inside/a.jpg', 'inside/portrait.jpg', 'inside/nested/b.jpg', 'inside/movie.mkv', 'outside/secret.jpg']) {
      await writeFile(path.join(root, name), 'synthetic media');
    }
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare('UPDATE files SET width=100,height=50').run();
    db.prepare("UPDATE files SET width=50,height=100 WHERE name='portrait.jpg'").run();
    db.prepare("UPDATE files SET playability='transcode' WHERE name='movie.mkv'").run();
    const rows = db.prepare('SELECT id,name,relative_path,size,modified_at FROM files').all() as { id: string; name: string; relative_path: string; size: number; modified_at: number }[];
    const byName = (name: string) => rows.find((row) => row.name === name)!;
    for (const row of rows) for (const size of ['s', 'm'] as const) {
      const filename = cachePath(cache, row, { kind: 'thumb', size });
      await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, 'synthetic thumbnail');
    }
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!; const admin = { cookie, 'x-luvia-request': '1' };
    const created = await app.inject({ method: 'POST', url: '/api/v2/me/tokens', headers: admin, payload: { name: '壁纸', scope: 'wallpaper', wallpaper: { source: 'folder', folder: 'lib/inside', landscapeOnly: true, includeVideos: false } } });
    const token = created.json().token as string; const tokenId = created.json().meta.id as string; const bearer = { authorization: `Bearer ${token}` };
    const random = await app.inject({ method: 'GET', url: '/api/v2/media/random?count=20', headers: bearer });
    const legacy = await app.inject({ method: 'GET', url: `/api/scan/results?limit=20&sort=nameAsc&token=${token}` });
    const secret = byName('secret.jpg'); const legacyId = encodeURIComponent(Buffer.from(path.join(root, secret.relative_path)).toString('base64'));
    const urls = [`/api/v2/media/${secret.id}/original`, `/api/v2/media/${secret.id}/thumb?size=s`, `/api/v2/media/${secret.id}/display`, `/api/v2/media/${secret.id}/tiles.dzi`, `/api/v2/media/${secret.id}/tiles/1/0_0.webp`, `/api/file/${legacyId}?token=${token}`, `/api/thumb/${legacyId}?token=${token}`, `/api/v2/media/${byName('movie.mkv').id}/hls/index.m3u8`];
    const statuses = [];
    for (const url of urls) statuses.push((await app.inject({ method: 'GET', url, headers: bearer })).statusCode);
    assert.deepEqual({ random: random.json().items.map((item: { name: string }) => item.name).sort(), legacy: legacy.json().files.map((item: { name: string }) => item.name).sort(), statuses },
      { random: ['a.jpg', 'b.jpg'], legacy: ['a.jpg', 'b.jpg'], statuses: [404, 404, 404, 404, 404, 404, 404, 404] });
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${byName('a.jpg').id}/original`, headers: bearer })).statusCode, 200);
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/v2/media/random?types=video', headers: bearer })).json().items, []);
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/v2/media/random?under=lib/outside', headers: bearer })).json().items, []);
    const page = await app.inject({ method: 'GET', url: `/api/scan/results?limit=1&offset=1&sort=nameAsc&token=${token}` });
    assert.deepEqual(page.json().files.map((item: { name: string }) => item.name), ['b.jpg']);
    await app.inject({ method: 'PATCH', url: `/api/v2/me/tokens/${tokenId}`, headers: admin, payload: { wallpaper: { includeVideos: true } } });
    const videoUrl = `/api/v2/media/${byName('movie.mkv').id}/hls/index.m3u8`;
    assert.equal((await app.inject({ method: 'GET', url: videoUrl, headers: bearer })).statusCode, 202);
    await app.inject({ method: 'PATCH', url: `/api/v2/me/tokens/${tokenId}`, headers: admin, payload: { wallpaper: { includeVideos: false } } });
    assert.equal((await app.inject({ method: 'GET', url: videoUrl, headers: bearer })).statusCode, 404);
    const userId = setup.json().user.id as string;
    db.prepare("INSERT INTO favorites(user_id,item_id,item_type) VALUES (?,?,'file'), (?,?,'folder')").run(userId, byName('secret.jpg').id, userId, 'lib/inside/nested');
    await app.inject({ method: 'PATCH', url: `/api/v2/me/tokens/${tokenId}`, headers: admin, payload: { wallpaper: { source: 'favorites', landscapeOnly: true, includeVideos: false } } });
    const favorites = await app.inject({ method: 'GET', url: `/api/scan/results?sort=nameAsc&token=${token}` });
    assert.deepEqual(favorites.json().files.map((item: { name: string }) => item.name), ['b.jpg', 'secret.jpg']);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${byName('a.jpg').id}/original`, headers: bearer })).statusCode, 404);
    await app.inject({ method: 'PATCH', url: `/api/v2/me/tokens/${tokenId}`, headers: admin, payload: { wallpaper: { source: 'folder', folder: null } } });
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/v2/media/random', headers: bearer })).json().items, []);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${byName('a.jpg').id}/original`, headers: bearer })).statusCode, 404);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
