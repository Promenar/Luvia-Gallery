import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Share } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { runNextJob } from '../src/worker/runner.ts';

const run = promisify(execFile);
test('HLS 按会话转码、逐段鉴权、支持分享并在闲置后回收', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-hls-')); const cache = await mkdtemp(path.join(tmpdir(), 'luvia-hls-cache-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  try {
    await run(process.execPath, [fileURLToPath(new URL('../scripts/fixtures.ts', import.meta.url)), '--output', root]);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const { id } = db.prepare("SELECT id FROM files WHERE name='transcode.mkv'").get() as { id: string };
    db.prepare("UPDATE files SET playability='transcode' WHERE id=?").run(id);
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!; const headers = { cookie, 'x-luvia-request': '1' };
    const index = `/api/v2/media/${id}/hls/index.m3u8`;
    assert.equal((await app.inject({ method: 'GET', url: index })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: index, headers: { cookie } })).statusCode, 202);
    assert.equal((await app.inject({ method: 'GET', url: index, headers: { cookie } })).statusCode, 202);
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE dedupe_key LIKE 'hls:%'").get() as { n: number }).n, 1);
    const options = { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache };
    await runNextJob(db, options);
    const playlist = await app.inject({ method: 'GET', url: index, headers: { cookie } });
    assert.equal(playlist.statusCode, 200); assert.match(playlist.body, /#EXTM3U/); assert.match(playlist.body, /#EXT-X-ENDLIST/);
    const segment = playlist.body.split('\n').find((line) => /^seg-\d+\.ts$/.test(line)); assert.ok(segment);
    const segmentResult = await app.inject({ method: 'GET', url: `/api/v2/media/${id}/hls/${segment}`, headers: { cookie } });
    assert.equal(segmentResult.statusCode, 200); assert.ok(segmentResult.rawPayload.length > 0);
    const { pruneCache } = await import('../src/worker/cache-prune.ts');
    await pruneCache(db, cache, 0);
    assert.ok((db.prepare("SELECT count(*) AS n FROM cache_entries WHERE variant='hls'").get() as { n: number }).n > 0);
    const segmentFile = path.join(cache, 'inspect.ts'); await writeFile(segmentFile, segmentResult.rawPayload);
    const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'default=noprint_wrappers=1:nokey=1', segmentFile]);
    assert.ok(probe.stdout.trim().split(/\s+/).every((codec) => codec === 'h264'));
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${id}/hls/../secret`, headers: { cookie } })).statusCode, 404);
    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const secondCookie = (login.headers['set-cookie'] as string).split(';')[0]!;
    assert.equal((await app.inject({ method: 'GET', url: index, headers: { cookie: secondCookie } })).statusCode, 202);
    const created = await app.inject({ method: 'POST', url: '/api/v2/shares', headers, payload: { target: { type: 'media', ids: [id] } } });
    const share = Share.parse(created.json()); const publicIndex = `/api/v2/public/shares/${share.token}/media/${id}/hls/index.m3u8`;
    const publicPending = await app.inject({ method: 'GET', url: publicIndex });
    assert.equal(publicPending.statusCode, 202);
    const visitorCookie = (publicPending.headers['set-cookie'] as string).split(';')[0]!;
    for (let step = 0; step < 4; step++) {
      const state = await app.inject({ method: 'GET', url: publicIndex, headers: { cookie: visitorCookie } });
      if (state.statusCode === 200) break;
      await runNextJob(db, options);
    }
    const publicPlaylist = await app.inject({ method: 'GET', url: publicIndex, headers: { cookie: visitorCookie } });
    assert.equal(publicPlaylist.statusCode, 200);
    const publicSegment = publicPlaylist.body.split('\n').find((line) => /^seg-\d+\.ts$/.test(line)); assert.ok(publicSegment);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/public/shares/${share.token}/media/${id}/hls/${publicSegment}`, headers: { cookie: visitorCookie } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v2/shares/${share.id}`, headers })).statusCode, 204);
    assert.equal((await app.inject({ method: 'GET', url: publicIndex, headers: { cookie: visitorCookie } })).statusCode, 404);
    db.prepare('UPDATE hls_sessions SET last_access_at=0').run();
    const { cleanupHls } = await import('../src/worker/hls.ts');
    await cleanupHls(db, cache, Date.now());
    assert.equal((db.prepare('SELECT count(*) AS n FROM hls_sessions').get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT count(*) AS n FROM cache_entries WHERE variant='hls'").get() as { n: number }).n, 0);
    const orphanSession = 'a'.repeat(64); const orphanGeneration = 'b'.repeat(32);
    const orphan = path.join(cache, 'hls', orphanSession, orphanGeneration); await mkdir(orphan, { recursive: true });
    await writeFile(path.join(orphan, 'seg-000000.ts'), 'fixture'); await utimes(orphan, 1, 1);
    db.prepare("INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at,variant,hls_session_id) VALUES ('orphan',?,7,0,'hls',?)")
      .run(`hls/${orphanSession}/${orphanGeneration}/seg-000000.ts`, orphanSession);
    await cleanupHls(db, cache, Date.now());
    await assert.rejects(access(orphan));
    assert.equal((db.prepare("SELECT count(*) AS n FROM cache_entries WHERE cache_key='orphan'").get() as { n: number }).n, 0);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('转码尚在运行时提供已经完成的 HLS 分片，停止 worker 会终止进程', async () => {
  const { chmod } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-hls-stream-')); const cache = await mkdtemp(path.join(tmpdir(), 'luvia-hls-stream-cache-'));
  const bin = await mkdtemp(path.join(tmpdir(), 'luvia-hls-bin-')); const originalPath = process.env.PATH;
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  const abort = new AbortController(); let work: Promise<void> | undefined;
  try {
    let executable = '';
    for (const entry of (originalPath ?? '').split(path.delimiter)) {
      const candidate = path.join(entry, 'ffmpeg');
      try { await access(candidate, constants.X_OK); executable = candidate; break; } catch { /* 检查下一个 PATH 目录。 */ }
    }
    assert.ok(executable, '缺少 FFmpeg');
    await run(executable, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=12', '-t', '15', '-threads', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(root, 'long.mkv')]);
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(path.join(bin, 'ffmpeg'), `#!/bin/sh\nexec ${quote(executable)} -re "$@"\n`);
    await chmod(path.join(bin, 'ffmpeg'), 0o755);
    process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ''}`;
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','视频',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const { id } = db.prepare('SELECT id FROM files').get() as { id: string };
    db.prepare("UPDATE files SET playability='transcode' WHERE id=?").run(id);
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!; const url = `/api/v2/media/${id}/hls/index.m3u8`;
    assert.equal((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode, 202);
    const { runWorkerPool } = await import('../src/worker/pool.ts');
    work = runWorkerPool(db, { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache, signal: abort.signal });
    let playable = false;
    for (let step = 0; step < 60; step++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 200));
      const playlist = await app.inject({ method: 'GET', url, headers: { cookie } });
      if (playlist.statusCode !== 200) continue;
      const segment = playlist.body.split('\n').find((line) => /^seg-\d+\.ts$/.test(line));
      if (!segment) continue;
      assert.equal((db.prepare("SELECT status FROM jobs WHERE dedupe_key LIKE 'hls:%'").get() as { status: string }).status, 'running');
      assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${id}/hls/${segment}`, headers: { cookie } })).statusCode, 200);
      assert.equal((await app.inject({ method: 'GET', url: `/api/v2/media/${id}/thumb?size=s`, headers: { cookie } })).statusCode, 200);
      playable = true; break;
    }
    abort.abort(); await work;
    assert.equal(playable, true);
    assert.equal((db.prepare('SELECT count(*) AS n FROM ffmpeg_slots').get() as { n: number }).n, 0);
    await runNextJob(db, { owner: 'worker-next', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache, hlsIdleMs: 100 });
    const idle = db.prepare("SELECT status,result FROM jobs WHERE dedupe_key LIKE 'hls:%' ORDER BY created_at DESC LIMIT 1").get() as { status: string; result: string };
    assert.equal(idle.status, 'succeeded'); assert.equal(JSON.parse(idle.result).idle, 1);
    assert.equal((db.prepare('SELECT state FROM hls_sessions').get() as { state: string }).state, 'idle');
    assert.equal((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode, 202);
  } finally {
    abort.abort(); await work?.catch(() => {});
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); await rm(bin, { recursive: true, force: true });
  }
});
