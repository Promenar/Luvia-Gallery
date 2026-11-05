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

test('重复导入不会恢复已撤销的旧壁纸令牌或被删除的账户', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-legacy-reimport-'));
  const db = openDatabase(':memory:'); const signingKey = 'synthetic-legacy-signing-key';
  const app = await createApp({ db, legacyPending: false, legacyJwtSecret: signingKey });
  const token = jwt.sign({ username: 'alice', role: 'admin', isWallpaper: true }, signingKey, { expiresIn: '1h' });
  try {
    await writeFile(path.join(root, 'lumina-config.json'), JSON.stringify({ libraryPaths: [], users: [{ username: 'alice', password: 'synthetic password', isAdmin: true, wallpaperToken: token }] }));
    const reimport = () => importLegacy(db, { legacyDir: root, mediaRoots: [] });
    const access = () => app.inject({ method: 'GET', url: `/api/scan/results?random=true&token=${token}` });
    await reimport(); assert.equal((await access()).statusCode, 200);
    const login = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'alice', password: 'synthetic password' } });
    const alice = login.json().user.id as string;
    const headers = { cookie: (login.headers['set-cookie'] as string).split(';')[0]!, 'x-luvia-request': '1' };
    const tokenId = (db.prepare('SELECT id FROM api_tokens').get() as { id: string }).id;
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v2/me/tokens/${tokenId}`, headers })).statusCode, 204);
    assert.equal((await access()).statusCode, 401);
    await reimport(); assert.equal((await access()).statusCode, 401);
    const admin = await app.inject({ method: 'POST', url: '/api/v2/admin/users', headers, payload: { username: 'keeper', password: 'keeper password', role: 'admin' } });
    assert.equal(admin.statusCode, 200);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v2/admin/users/${alice}`, headers })).statusCode, 204);
    await reimport();
    assert.equal((await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'alice', password: 'synthetic password' } })).statusCode, 401);
    const keeper = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'keeper', password: 'keeper password' } });
    const keeperHeaders = { cookie: (keeper.headers['set-cookie'] as string).split(';')[0]!, 'x-luvia-request': '1' };
    assert.equal((await app.inject({ method: 'POST', url: '/api/v2/admin/users', headers: keeperHeaders, payload: { username: 'alice', password: 'replacement password' } })).statusCode, 200);
    await reimport(); assert.equal((await access()).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'alice', password: 'replacement password' } })).statusCode, 200);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('迁入壁纸 JWT 必须签名有效、属于对应用户且未超过原始有效期', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-legacy-expiry-'));
  const db = openDatabase(':memory:'); const signingKey = 'synthetic-legacy-signing-key';
  const app = await createApp({ db, legacyPending: false, legacyJwtSecret: signingKey });
  const before = Math.floor(Date.now() / 1000);
  const make = (username: string, exp: number, key = signingKey) => jwt.sign({ username, role: 'user', isWallpaper: true, iat: before - 100, exp }, key);
  const tokens = [make('alice', before - 1), make('bob', before + 3600), make('carol', before + 3600, 'different-synthetic-key'), make('someone-else', before + 3600)];
  try {
    await writeFile(path.join(root, 'lumina-config.json'), JSON.stringify({ users: ['alice', 'bob', 'carol', 'dave'].map((username, i) => ({ username, password: 'synthetic password', wallpaperToken: tokens[i] })) }));
    await importLegacy(db, { legacyDir: root, mediaRoots: [] });
    const access = (token: string) => app.inject({ method: 'GET', url: `/api/scan/results?random=true&token=${token}` });
    assert.equal((await access(tokens[0]!)).statusCode, 401);
    assert.equal((await access(tokens[1]!)).statusCode, 200);
    assert.equal((await access(tokens[2]!)).statusCode, 401);
    assert.equal((await access(tokens[3]!)).statusCode, 401);
    const clock = Date.now;
    try { Date.now = () => (before + 3601) * 1000; assert.equal((await access(tokens[1]!)).statusCode, 401); }
    finally { Date.now = clock; }
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('旧用户名与现有账户冲突时不把旧令牌绑定到现有账户', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-legacy-conflict-'));
  const db = openDatabase(':memory:'); const signingKey = 'synthetic-legacy-signing-key';
  const app = await createApp({ db, legacyPending: false, legacyJwtSecret: signingKey });
  const token = jwt.sign({ username: 'alice', isWallpaper: true }, signingKey, { expiresIn: '1h' });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'alice', password: 'current password' } });
    assert.equal(setup.statusCode, 200);
    await writeFile(path.join(root, 'lumina-config.json'), JSON.stringify({ users: [{ username: 'alice', password: 'old password', isAdmin: true, wallpaperToken: token }] }));
    await importLegacy(db, { legacyDir: root, mediaRoots: [] });
    assert.equal((await app.inject({ method: 'GET', url: `/api/scan/results?random=true&token=${token}` })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'alice', password: 'current password' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'alice', password: 'old password' } })).statusCode, 401);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('升级已有导入记录时不恢复升级前撤销的壁纸令牌', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-legacy-upgrade-'));
  const signingKey = 'synthetic-legacy-signing-key'; const file = path.join(root, 'v2.db');
  const token = jwt.sign({ username: 'alice', isWallpaper: true }, signingKey, { expiresIn: '1h' });
  let db = openDatabase(file);
  try {
    await writeFile(path.join(root, 'lumina-config.json'), JSON.stringify({ users: [{ username: 'alice', password: 'synthetic password', wallpaperToken: token }] }));
    await importLegacy(db, { legacyDir: root, mediaRoots: [] });
    db.prepare('DELETE FROM api_tokens').run();
    db.exec('DROP TABLE legacy_import_users; DROP TABLE legacy_import_tokens; ALTER TABLE api_tokens DROP COLUMN legacy_jwt; PRAGMA user_version=21');
    db.close(); db = openDatabase(file);
    await importLegacy(db, { legacyDir: root, mediaRoots: [] });
    const app = await createApp({ db, legacyPending: false, legacyJwtSecret: signingKey });
    try { assert.equal((await app.inject({ method: 'GET', url: `/api/scan/results?random=true&token=${token}` })).statusCode, 401); }
    finally { await app.close(); }
  } finally { if (db.open) db.close(); await rm(root, { recursive: true, force: true }); }
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
