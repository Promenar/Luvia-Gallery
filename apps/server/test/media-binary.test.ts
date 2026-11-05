import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, copyFile, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { runNextJob } from '../src/worker/runner.ts';

test('原文件和浏览器可解码 display 支持 Range 与 ETag，逐次检查访问权限', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-binary-'));
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    const input = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#6388aa' } }).jpeg().toBuffer();
    await sharp(input).toFile(path.join(root, 'photo.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const file = db.prepare('SELECT id FROM files').get() as { id: string };
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const original = await app.inject({ method: 'GET', url: `/api/v2/media/${file.id}/original`, headers: { cookie, range: 'bytes=0-9' } });
    assert.equal(original.statusCode, 206);
    assert.equal(original.rawPayload.length, 10);
    assert.match(String(original.headers['content-range']), /^bytes 0-9\/\d+$/);
    assert.equal(original.headers['accept-ranges'], 'bytes');
    assert.ok(original.headers.etag);
    const display = await app.inject({ method: 'GET', url: `/api/v2/media/${file.id}/display`, headers: { cookie } });
    assert.equal(display.statusCode, 200); assert.equal(display.headers['content-type'], 'image/jpeg');
    assert.equal((await sharp(display.rawPayload).metadata()).width, 32);
    const cached = await app.inject({ method: 'GET', url: `/api/v2/media/${file.id}/display`, headers: { cookie, 'if-none-match': String(display.headers.etag) } });
    assert.equal(cached.statusCode, 304);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${file.id}/original`, headers: { cookie, range: 'bytes=999999-' } })).statusCode, 416);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${file.id}/original` })).statusCode, 401);
    db.prepare("UPDATE users SET role='user',allowed_paths=? WHERE username='admin'").run(JSON.stringify(['lib/other']));
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${file.id}/original`, headers: { cookie } })).statusCode, 404);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('缩略图由 worker 合并生成并填充 ThumbHash', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-thumb-cache-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  try {
    await sharp({ create: { width: 400, height: 300, channels: 3, background: '#6388aa' } }).jpeg().toFile(path.join(root, 'photo.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const { id } = db.prepare('SELECT id FROM files').get() as { id: string };
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const first = app.inject({ method: 'GET', url: `/api/v2/media/${id}/thumb?size=s`, headers: { cookie } });
    const second = app.inject({ method: 'GET', url: `/api/v2/media/${id}/thumb?size=s`, headers: { cookie } });
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails' AND status='queued'").get() as { n: number }).n) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails' AND status='queued'").get() as { n: number }).n, 1);
    await runNextJob(db, { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache });
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200);
    assert.equal(a.headers['content-type'], 'image/webp');
    assert.equal((await sharp(a.rawPayload).metadata()).format, 'webp');
    const row = db.prepare('SELECT thumbhash,thumb_version FROM files WHERE id=?').get(id) as { thumbhash: string | null; thumb_version: number };
    assert.ok(row.thumbhash); assert.equal(row.thumb_version, 1);
    assert.equal((db.prepare("SELECT cover_file_id FROM folders WHERE path='lib'").get() as { cover_file_id: string | null }).cover_file_id, id);
    db.prepare('DELETE FROM cache_entries WHERE media_id=?').run(id);
    db.prepare('UPDATE files SET thumb_ready=0 WHERE id=?').run(id);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${id}/thumb?size=s`, headers: { cookie } })).statusCode, 200);
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries WHERE media_id=?').get(id) as { n: number }).n, 1);
    await appendFile(path.join(root, 'photo.jpg'), Buffer.from([0]));
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const changed = await app.inject({ method: 'GET', url: '/api/v2/media', headers: { cookie } });
    assert.equal(changed.json().items[0].thumbVersion, 0);
    const regenerate = app.inject({ method: 'GET', url: `/api/v2/media/${id}/thumb?size=s`, headers: { cookie } });
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails' AND status='queued'").get() as { n: number }).n) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    await runNextJob(db, { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache });
    assert.equal((await regenerate).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/media', headers: { cookie } })).json().items[0].thumbVersion, 2);
    const { pruneCache } = await import('../src/worker/cache-prune.ts');
    await pruneCache(db, cache, 0);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/media', headers: { cookie } })).json().items[0].thumbVersion, 0);
    assert.equal((db.prepare("SELECT cover_file_id FROM folders WHERE path='lib'").get() as { cover_file_id: string | null }).cover_file_id, null);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('TIFF display 与大图瓦片在 worker 生成前返回 202，生成后提供 WebP', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-display-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-display-cache-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  try {
    await sharp({ create: { width: 8201, height: 10, channels: 3, background: '#6388aa' } }).tiff().toFile(path.join(root, 'wide.tiff'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const { id } = db.prepare('SELECT id FROM files').get() as { id: string };
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const displayUrl = `/api/v2/media/${id}/display`;
    assert.equal((await app.inject({ method: 'GET', url: displayUrl, headers: { cookie } })).statusCode, 202);
    await runNextJob(db, { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache });
    const display = await app.inject({ method: 'GET', url: displayUrl, headers: { cookie } });
    assert.equal(display.statusCode, 200); assert.equal((await sharp(display.rawPayload).metadata()).width, 8201);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${id}/tiles.dzi`, headers: { cookie } })).statusCode, 202);
    await runNextJob(db, { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache });
    const dzi = await app.inject({ method: 'GET', url: `/api/v2/media/${id}/tiles.dzi`, headers: { cookie } });
    assert.equal(dzi.statusCode, 200); assert.match(dzi.body, /Width="8201" Height="10"/);
    const tileUrl = `/api/v2/media/${id}/tiles/14/0_0.webp`;
    assert.equal((await app.inject({ method: 'GET', url: tileUrl, headers: { cookie } })).statusCode, 202);
    await runNextJob(db, { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache });
    const tile = await app.inject({ method: 'GET', url: tileUrl, headers: { cookie } });
    assert.equal(tile.statusCode, 200); assert.equal((await sharp(tile.rawPayload).metadata()).width, 256);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${id}/tiles/14/999_0.webp`, headers: { cookie } })).statusCode, 404);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('HEIC 元数据、完整尺寸显示图和缩略图通过后台解码生成', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-heic-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-heic-cache-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  try {
    await copyFile(new URL('./fixtures/synthetic.heic', import.meta.url), path.join(root, 'image.heic'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const { id } = db.prepare('SELECT id FROM files').get() as { id: string };
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('metadata','metadata','元数据','queued','manual',?,1)").run(JSON.stringify({ libraryId: 'lib' }));
    const options = { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache };
    await runNextJob(db, options);
    const metadata = db.prepare('SELECT width,height,metadata_status FROM files WHERE id=?').get(id) as { width: number; height: number; metadata_status: string };
    assert.deepEqual(metadata, { width: 512, height: 384, metadata_status: 'done' });
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const displayUrl = `/api/v2/media/${id}/display`;
    assert.equal((await app.inject({ method: 'GET', url: displayUrl, headers: { cookie } })).statusCode, 202);
    await runNextJob(db, options);
    const display = await app.inject({ method: 'GET', url: displayUrl, headers: { cookie } });
    assert.equal(display.statusCode, 200);
    const displayImage = await sharp(display.rawPayload).metadata();
    assert.equal(displayImage.format, 'webp'); assert.equal(displayImage.width, 512); assert.equal(displayImage.height, 384);
    const range = await app.inject({ method: 'GET', url: displayUrl, headers: { cookie, range: 'bytes=0-9' } });
    assert.equal(range.statusCode, 206); assert.equal(range.rawPayload.length, 10); assert.ok(range.headers.etag);
    const thumb = app.inject({ method: 'GET', url: `/api/v2/media/${id}/thumb?size=s`, headers: { cookie } });
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails' AND status='queued'").get() as { n: number }).n) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    await runNextJob(db, options);
    const result = await thumb;
    assert.equal(result.statusCode, 200);
    assert.equal((await sharp(result.rawPayload).metadata()).width, 256);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('数据库内伪造的越界符号链接不能经原文件接口读取', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-binary-link-'));
  const external = await mkdtemp(path.join(tmpdir(), 'luvia-binary-out-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    await sharp({ create: { width: 10, height: 10, channels: 3, background: '#aaa' } }).jpeg().toFile(path.join(external, 'secret.jpg'));
    await symlink(path.join(external, 'secret.jpg'), path.join(root, 'link.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES ('evil','lib','link.jpg','lib','link.jpg','image/jpeg','image',1,1,1,'mtime')").run();
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/media/evil/original', headers: { cookie } })).statusCode, 404);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(external, { recursive: true, force: true }); }
});

test('视频缩略图经 FFmpeg 抽帧与 sharp 生成，并发请求合并', async () => {
  const { execFile } = await import('node:child_process'); const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-video-thumb-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-video-cache-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  try {
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../scripts/fixtures.ts', import.meta.url)), '--output', root]);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const { id } = db.prepare("SELECT id FROM files WHERE name='direct.mp4'").get() as { id: string };
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const first = app.inject({ method: 'GET', url: `/api/v2/media/${id}/thumb?size=s`, headers: { cookie } });
    const second = app.inject({ method: 'GET', url: `/api/v2/media/${id}/thumb?size=s`, headers: { cookie } });
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails' AND status='queued'").get() as { n: number }).n) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails' AND status='queued'").get() as { n: number }).n, 1);
    await runNextJob(db, { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache });
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200);
    assert.equal((await sharp(a.rawPayload).metadata()).format, 'webp');
    assert.ok((db.prepare('SELECT thumbhash FROM files WHERE id=?').get(id) as { thumbhash: string | null }).thumbhash);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
