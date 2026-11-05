import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import sharp from 'sharp';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { importLegacy } from '../src/worker/import-legacy.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { runNextJob } from '../src/worker/runner.ts';

test('旧 JWT 绑定迁入账户并在密码变更和同名重建后失效', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-legacy-jwt-user-'));
  const db = openDatabase(':memory:'); const signingKey = 'synthetic-legacy-signing-key';
  const app = await createApp({ db, legacyPending: false, legacyJwtSecret: signingKey });
  try {
    await writeFile(path.join(root, 'lumina-config.json'), JSON.stringify({ libraryPaths: [], users: [{ username: 'alice', password: 'synthetic password', isAdmin: true }] }));
    await importLegacy(db, { legacyDir: root, mediaRoots: [] });
    const old = jwt.sign({ username: 'alice', role: 'admin' }, signingKey, { expiresIn: '7d' });
    const access = (value: string) => app.inject({ method: 'GET', url: '/api/scan/results', headers: { authorization: `Bearer ${value}` } });
    assert.equal((await access(old)).statusCode, 200);
    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'alice', password: 'synthetic password' } });
    const cookie = (login.headers['set-cookie'] as string).split(';')[0]!;
    assert.equal((await app.inject({ method: 'POST', url: '/api/v2/me/password', headers: { cookie, 'x-luvia-request': '1' }, payload: { current: 'synthetic password', next: 'new synthetic password' } })).statusCode, 204);
    assert.equal((await access(old)).statusCode, 401);
    const newLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'alice', password: 'new synthetic password' } });
    const fresh = newLogin.json().token as string; assert.equal((await access(fresh)).statusCode, 200);
    const user = db.prepare("SELECT * FROM users WHERE username='alice'").get() as Record<string, unknown>;
    db.prepare("DELETE FROM users WHERE username='alice'").run();
    db.prepare('INSERT INTO users(id,username,password_hash,role,allowed_paths,preferences,created_at) VALUES (?,?,?,?,?,?,?)')
      .run('replacement', user.username, user.password_hash, user.role, user.allowed_paths, user.preferences, user.created_at);
    assert.equal((await access(old)).statusCode, 401);
    assert.equal((await access(fresh)).statusCode, 401);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('迁入壁纸 JWT 被删除或过期后不能回退到普通旧 JWT', async () => {
  const db = openDatabase(':memory:'); const signingKey = 'synthetic-legacy-signing-key';
  const app = await createApp({ db, legacyPending: false, legacyJwtSecret: signingKey });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!; const userId = setup.json().user.id;
    const token = jwt.sign({ username: 'admin', role: 'admin', isWallpaper: true }, signingKey, { expiresIn: '365d' });
    db.prepare("INSERT INTO api_tokens(id,user_id,token_hash,name,scope,prefix,created_at,wallpaper) VALUES ('old',?,?, '旧壁纸','wallpaper','fixture',1,?)")
      .run(userId, createHash('sha256').update(token).digest('hex'), JSON.stringify({ source: 'library', landscapeOnly: false, includeVideos: true }));
    const query = () => app.inject({ method: 'GET', url: `/api/scan/results?random=true&token=${token}` });
    const bearer = () => app.inject({ method: 'GET', url: '/api/scan/results?random=true', headers: { authorization: `Bearer ${token}` } });
    assert.equal((await query()).statusCode, 200); assert.equal((await bearer()).statusCode, 200);
    db.prepare("UPDATE api_tokens SET expires_at=1 WHERE id='old'").run();
    assert.equal((await query()).statusCode, 401); assert.equal((await bearer()).statusCode, 401);
    db.prepare("UPDATE api_tokens SET expires_at=NULL WHERE id='old'").run();
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/v2/me/tokens/old', headers: { cookie, 'x-luvia-request': '1' } })).statusCode, 204);
    assert.equal((await query()).statusCode, 401); assert.equal((await bearer()).statusCode, 401);
  } finally { await app.close(); db.close(); }
});

test('旧版缩略图生成期间撤销查询令牌或旧 JWT 不返回图片', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-legacy-thumb-auth-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-legacy-thumb-cache-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, legacyJwtSecret: 'synthetic-signing-key', cacheDir: cache });
  try {
    for (const name of ['one.jpg', 'two.jpg']) await sharp({ create: { width: 64, height: 48, channels: 3, background: '#789' } }).jpeg().toFile(path.join(root, name));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!; const headers = { cookie, 'x-luvia-request': '1' };
    const created = await app.inject({ method: 'POST', url: '/api/v2/me/tokens', headers, payload: { name: '合成客户端', scope: 'read' } });
    const token = created.json().token as string;
    const legacyLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'test password' } });
    const legacyJwt = legacyLogin.json().token as string;
    const url = (name: string) => `/api/thumb/${encodeURIComponent(Buffer.from(path.join(root, name)).toString('base64'))}`;
    const waitForJob = async () => {
      for (let index = 0; index < 100; index++) {
        if ((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='thumbnails' AND status='queued'").get() as { n: number }).n) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      }
      throw new Error('缩略图作业未入队');
    };
    const first = app.inject({ method: 'GET', url: `${url('one.jpg')}?token=${token}` });
    await waitForJob();
    await app.inject({ method: 'DELETE', url: `/api/v2/me/tokens/${created.json().meta.id}`, headers });
    await runNextJob(db, { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache });
    assert.equal((await first).statusCode, 401);
    const second = app.inject({ method: 'GET', url: url('two.jpg'), headers: { authorization: `Bearer ${legacyJwt}` } });
    await waitForJob(); db.prepare("DELETE FROM users WHERE username='admin'").run();
    await runNextJob(db, { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache });
    assert.equal((await second).statusCode, 401);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
