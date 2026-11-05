import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { runNextJob } from '../src/worker/runner.ts';

const run = promisify(execFile);
test('预览作业生成静音 MP4，接口提供权限校验和 Range', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-previews-')); const cache = await mkdtemp(path.join(tmpdir(), 'luvia-previews-cache-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  try {
    await run(process.execPath, [fileURLToPath(new URL('../scripts/fixtures.ts', import.meta.url)), '--output', root]);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const { id } = db.prepare("SELECT id FROM files WHERE name='direct.mp4'").get() as { id: string };
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${id}/preview`, headers: { cookie } })).statusCode, 404);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('bulk','previews','生成预览','queued','manual',?,1)").run(JSON.stringify({ libraryId: 'lib' }));
    const options = { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache };
    for (let index = 0; index < 10 && !(db.prepare('SELECT has_preview FROM files WHERE id=?').get(id) as { has_preview: number }).has_preview; index++) await runNextJob(db, options);
    assert.equal((db.prepare('SELECT has_preview FROM files WHERE id=?').get(id) as { has_preview: number }).has_preview, 1);
    const result = await app.inject({ method: 'GET', url: `/api/v2/media/${id}/preview`, headers: { cookie } });
    assert.equal(result.statusCode, 200); assert.equal(result.headers['content-type'], 'video/mp4');
    const output = path.join(cache, 'inspect.mp4'); await writeFile(output, result.rawPayload);
    const probe = await run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', output]);
    const streams = (JSON.parse(probe.stdout) as { streams: { codec_type: string; codec_name: string }[] }).streams;
    assert.equal(streams.find((stream) => stream.codec_type === 'video')?.codec_name, 'h264');
    assert.equal(streams.some((stream) => stream.codec_type === 'audio'), false);
    const range = await app.inject({ method: 'GET', url: `/api/v2/media/${id}/preview`, headers: { cookie, range: 'bytes=0-15' } });
    assert.equal(range.statusCode, 206); assert.equal(range.rawPayload.length, 16);
    db.prepare("UPDATE users SET role='user',allowed_paths=? WHERE username='admin'").run(JSON.stringify(['lib/private']));
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${id}/preview`, headers: { cookie } })).statusCode, 404);
    db.prepare("UPDATE users SET role='admin',allowed_paths=NULL WHERE username='admin'").run();
    const { pruneCache } = await import('../src/worker/cache-prune.ts');
    await pruneCache(db, cache, 0);
    assert.equal((db.prepare('SELECT has_preview FROM files WHERE id=?').get(id) as { has_preview: number }).has_preview, 0);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${id}/preview`, headers: { cookie } })).statusCode, 404);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
