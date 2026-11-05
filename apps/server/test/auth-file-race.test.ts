import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

for (const phase of ['realpath', 'open'] as const) test(`原文件在 ${phase} 等待期间撤销会话后不返回内容`, async () => {
  const root = fileURLToPath(new URL('./fixtures', import.meta.url));
  const filename = path.join(root, 'synthetic.heic'); const info = await fs.promises.stat(filename);
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  const original = fs.promises[phase]; let release!: () => void; let entered!: () => void; let armed = true;
  const blocked = new Promise<void>((resolve) => { release = resolve; }); const reached = new Promise<void>((resolve) => { entered = resolve; });
  try {
    db.prepare('INSERT INTO libraries(id,name,root) VALUES (?,?,?)').run('lib', '合成', root);
    db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source)
      VALUES ('media','lib','synthetic.heic','lib','synthetic.heic','image/heic','image',?,?,?,'mtime')`).run(info.size, Math.floor(info.mtimeMs / 1000), 1);
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    Object.defineProperty(fs.promises, phase, { configurable: true, writable: true, value: async (...args: unknown[]) => {
      const matches = path.resolve(String(args[0])) === (phase === 'realpath' ? root : filename);
      if (armed && matches) { armed = false; entered(); await blocked; }
      return Reflect.apply(original, fs.promises, args);
    } });
    syncBuiltinESMExports();
    const response = app.inject({ method: 'GET', url: '/api/v2/media/media/original', headers: { cookie } });
    await Promise.race([reached, new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('未进入测试屏障')), 3000); timer.unref(); })]);
    db.prepare('DELETE FROM sessions').run(); release();
    assert.equal((await response).statusCode, 401);
  } finally {
    release(); Object.defineProperty(fs.promises, phase, { configurable: true, writable: true, value: original }); syncBuiltinESMExports();
    await app.close(); db.close();
  }
});

test('HLS 等待期间媒体移入无权目录时不返回分片', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-hls-move-race-')); const cache = await mkdtemp(path.join(tmpdir(), 'luvia-hls-move-cache-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  const original = fs.promises.lstat; let release!: () => void; let entered!: () => void; let armed = true;
  const blocked = new Promise<void>((resolve) => { release = resolve; }); const reached = new Promise<void>((resolve) => { entered = resolve; });
  try {
    await mkdir(path.join(root, 'a')); await writeFile(path.join(root, 'a', 'clip.mp4'), 'video');
    const info = await fs.promises.stat(path.join(root, 'a', 'clip.mp4'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,playability) VALUES ('f','lib','a/clip.mp4','lib/a','clip.mp4','video/mp4','video',?,?,1,'mtime','transcode')")
      .run(info.size, Math.floor(info.mtimeMs / 1000));
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    db.prepare("UPDATE users SET role='user',allowed_paths=? WHERE username='admin'").run(JSON.stringify(['lib/a']));
    const url = '/api/v2/media/f/hls/index.m3u8';
    assert.equal((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode, 202);
    const session = db.prepare('SELECT id FROM hls_sessions').get() as { id: string }; const generation = 'a'.repeat(32);
    const { hlsDirectory } = await import('../src/core/hls.ts'); const directory = hlsDirectory(cache, session.id, generation);
    await mkdir(directory, { recursive: true }); const playlist = path.join(directory, 'index.m3u8'); await writeFile(playlist, '#EXTM3U\n');
    db.prepare("UPDATE hls_sessions SET generation=?,state='ready' WHERE id=?").run(generation, session.id);
    Object.defineProperty(fs.promises, 'lstat', { configurable: true, writable: true, value: async (...args: unknown[]) => {
      if (armed && path.resolve(String(args[0])) === playlist) { armed = false; entered(); await blocked; }
      return Reflect.apply(original, fs.promises, args);
    } }); syncBuiltinESMExports();
    const response = app.inject({ method: 'GET', url, headers: { cookie } });
    await Promise.race([reached, new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('未进入测试屏障')), 3000); timer.unref(); })]);
    db.prepare("UPDATE files SET folder='lib/b',relative_path='b/clip.mp4' WHERE id='f'").run(); release();
    assert.equal((await response).statusCode, 404);
  } finally {
    release(); Object.defineProperty(fs.promises, 'lstat', { configurable: true, writable: true, value: original }); syncBuiltinESMExports();
    await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true });
  }
});
