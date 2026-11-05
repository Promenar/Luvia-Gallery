import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, scryptSync } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import jwt from 'jsonwebtoken';
import { openDatabase } from '../src/core/database.ts';
import * as legacyImport from '../src/worker/import-legacy.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { runNextJob } from '../src/worker/runner.ts';
import { createApp } from '../src/api/app.ts';
import { verifyPassword } from '../src/core/password.ts';

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
const signingKey = 'synthetic-legacy-signing-key';
const { importLegacy } = legacyImport;

test('旧库只导入用户数据，收藏在扫描后匹配，孤儿保留且重复导入幂等', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-old-'));
  const media = path.join(dir, 'media'); const legacy = path.join(dir, 'old');
  await mkdir(media); await mkdir(legacy); await mkdir(path.join(media, 'sub'));
  const a = path.join(media, 'a.jpg'); const b = path.join(media, 'b.jpg'); const c = path.join(media, 'sub', 'c.jpg');
  await writeFile(a, 'a'); await writeFile(b, 'bb'); await writeFile(c, 'ccc');
  const oldPath = path.join(legacy, 'lumina.db');
  const source = new Database(oldPath);
  source.exec(`CREATE TABLE files (id TEXT PRIMARY KEY,path TEXT UNIQUE,last_modified INTEGER);
    CREATE TABLE favorites (id INTEGER PRIMARY KEY,user_id TEXT,item_id TEXT,item_type TEXT,created_at INTEGER);`);
  source.prepare('INSERT INTO files VALUES (?,?,?)').run('old-opaque-id', a, 1700000000000);
  source.prepare('INSERT INTO files VALUES (?,?,?)').run('old-b-id', b, 1);
  const addFavorite = source.prepare("INSERT INTO favorites(user_id,item_id,item_type,created_at) VALUES ('alice',?,?,1700000000)");
  addFavorite.run('old-opaque-id', 'file');
  addFavorite.run(b, 'file');
  addFavorite.run(Buffer.from(c).toString('base64'), 'file');
  addFavorite.run(path.join(media, 'sub'), 'folder');
  addFavorite.run(Buffer.from(path.join(media, 'missing.jpg')).toString('base64'), 'file');
  addFavorite.run('orphan', 'file');
  source.close();
  const salt = Buffer.alloc(16, 2);
  const password = `scrypt$${salt.toString('hex')}$${scryptSync('测试密码', salt, 64).toString('hex')}`;
  const token = jwt.sign({ username: 'alice', isWallpaper: true }, signingKey, { expiresIn: '3650d' });
  await writeFile(path.join(legacy, 'lumina-config.json'), JSON.stringify({ title: '家庭图库', libraryPaths: [media, path.join(dir, 'missing')], users: [{ username: 'alice', password, isAdmin: true, wallpaperToken: token }] }));
  const before = sha(await readFile(oldPath));
  const db = openDatabase(':memory:');
  try {
    const initial = await importLegacy(db, { legacyDir: legacy, mediaRoots: [media], batchSize: 1 });
    assert.deepEqual(initial, { imported: 0, pending: 5, unmatched: 1, unmappedRoots: 1 });
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 0);
    assert.equal((db.prepare('SELECT password_hash FROM users').get() as { password_hash: string }).password_hash, password);
    const tokenRow = db.prepare('SELECT token_hash,scope,wallpaper FROM api_tokens').get() as { token_hash: string; scope: string; wallpaper: string };
    assert.equal(tokenRow.token_hash, sha(token));
    assert.equal(tokenRow.scope, 'wallpaper');
    assert.equal(JSON.parse(tokenRow.wallpaper).source, 'library');
    assert.equal(JSON.parse(tokenRow.wallpaper).landscapeOnly, false);
    assert.equal(JSON.parse(tokenRow.wallpaper).includeVideos, true);
    assert.equal(JSON.parse((db.prepare("SELECT value FROM settings WHERE key='siteName'").get() as { value: string }).value), '家庭图库');
    const lib = db.prepare('SELECT id,root FROM libraries').get() as { id: string; root: string };
    await scanLibrary(db, lib, { allowedRoots: [media] });
    const reconcileLegacyFavorites = Reflect.get(legacyImport, 'reconcileLegacyFavorites');
    assert.equal(typeof reconcileLegacyFavorites, 'function');
    const result = reconcileLegacyFavorites(db, { finalize: true });
    assert.deepEqual(result, { imported: 4, pending: 0, unmatched: 2 });
    assert.equal((db.prepare('SELECT count(*) AS n FROM favorites').get() as { n: number }).n, 4);
    assert.deepEqual(await importLegacy(db, { legacyDir: legacy, mediaRoots: [media], batchSize: 1 }), { ...result, unmappedRoots: 1 });
    assert.equal((db.prepare('SELECT count(*) AS n FROM favorites').get() as { n: number }).n, 4);
    assert.equal(sha(await readFile(oldPath)), before);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('旧壁纸默认保留竖图、未知尺寸与视频，并迁移兼容设置', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-old-wallpaper-')); const media = path.join(dir, 'media'); const legacy = path.join(dir, 'legacy');
  await mkdir(media); await mkdir(legacy);
  const aliceToken = jwt.sign({ username: 'alice', isWallpaper: true }, signingKey, { expiresIn: '3650d' });
  const bobToken = jwt.sign({ username: 'bob', isWallpaper: true }, signingKey, { expiresIn: '3650d' });
  await writeFile(path.join(legacy, 'lumina-config.json'), JSON.stringify({ libraryPaths: [media], users: [
    { username: 'alice', password: 'synthetic password', isAdmin: true, wallpaperToken: aliceToken },
    { username: 'bob', password: 'synthetic password', wallpaperToken: bobToken, wallpaperConfig: { interval: 45, showVideos: false } },
  ] }));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false, legacyJwtSecret: signingKey });
  try {
    await importLegacy(db, { legacyDir: legacy, mediaRoots: [media] });
    const library = (db.prepare('SELECT id FROM libraries').get() as { id: string }).id;
    const add = db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,width,height) VALUES (?,?,?,?,?,?,?,?,?,?,'mtime',?,?)");
    add.run('portrait', library, 'portrait.jpg', library, 'portrait.jpg', 'image/jpeg', 'image', 1, 1, 1, 100, 200);
    add.run('unknown', library, 'unknown.jpg', library, 'unknown.jpg', 'image/jpeg', 'image', 1, 1, 1, null, null);
    add.run('video', library, 'video.mp4', library, 'video.mp4', 'video/mp4', 'video', 1, 1, 1, null, null);
    const response = await app.inject({ method: 'GET', url: `/api/scan/results?random=true&token=${aliceToken}` });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().files.map((item: { name: string }) => item.name).sort(), ['portrait.jpg', 'unknown.jpg', 'video.mp4']);
    const config = db.prepare("SELECT wallpaper FROM api_tokens WHERE name='旧版壁纸令牌' AND token_hash=?").get(sha(bobToken)) as { wallpaper: string };
    assert.deepEqual(JSON.parse(config.wallpaper), { source: 'library', folder: null, intervalSec: 45, landscapeOnly: false, includeVideos: false });
  } finally { await app.close(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('导入时转换明文口令并把越界、系统目录与缺失目录计为不可映射', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-old-root-'));
  const allowed = path.join(dir, 'allowed'); const outside = path.join(dir, 'outside');
  const system = path.join(allowed, 'data');
  await mkdir(allowed); await mkdir(outside); await mkdir(system);
  const link = path.join(allowed, 'link'); await symlink(outside, link);
  await writeFile(path.join(dir, 'lumina-config.json'), JSON.stringify({ libraryPaths: [link, system, path.join(allowed, 'missing')], users: [{ username: 'old', password: 'fixture password', isAdmin: true }] }));
  const db = openDatabase(':memory:');
  try {
    const result = await importLegacy(db, { legacyDir: dir, mediaRoots: [allowed], systemRoots: [system] });
    assert.equal(result.unmappedRoots, 3);
    assert.equal((db.prepare('SELECT count(*) AS n FROM libraries').get() as { n: number }).n, 0);
    const row = db.prepare("SELECT password_hash FROM users WHERE username='old'").get() as { password_hash: string };
    assert.match(row.password_hash, /^scrypt\$v2\$/);
    assert.equal((await verifyPassword('fixture password', row.password_hash)).valid, true);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('没有旧库路径和 MEDIA_ROOT 时，候选挂载不会自动启用', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-old-no-roots-'));
  const mount = path.join(dir, 'mount'); const legacy = path.join(dir, 'legacy');
  await mkdir(mount); await mkdir(legacy);
  await writeFile(path.join(legacy, 'lumina-config.json'), JSON.stringify({ title: '合成库' }));
  const db = openDatabase(':memory:'); const fallback = openDatabase(':memory:'); const empty = openDatabase(':memory:');
  try {
    await importLegacy(db, { legacyDir: legacy, mediaRoots: [mount] });
    assert.equal((db.prepare('SELECT count(*) AS n FROM libraries').get() as { n: number }).n, 0);
    await importLegacy(fallback, { legacyDir: legacy, mediaRoots: [mount], fallbackRoots: [mount] });
    assert.equal((fallback.prepare('SELECT count(*) AS n FROM libraries').get() as { n: number }).n, 1);
    await writeFile(path.join(legacy, 'lumina-config.json'), JSON.stringify({ libraryPaths: [] }));
    await importLegacy(empty, { legacyDir: legacy, mediaRoots: [mount], fallbackRoots: [mount] });
    assert.equal((empty.prepare('SELECT count(*) AS n FROM libraries').get() as { n: number }).n, 0);
  } finally { db.close(); fallback.close(); empty.close(); await rm(dir, { recursive: true, force: true }); }
});

test('后续扫描发现原先未匹配媒体时恢复旧收藏', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-old-unmatched-')); const media = path.join(dir, 'media'); const legacy = path.join(dir, 'legacy');
  await mkdir(media); await mkdir(legacy);
  const old = new Database(path.join(legacy, 'lumina.db'));
  old.exec('CREATE TABLE files(id TEXT PRIMARY KEY,path TEXT UNIQUE); CREATE TABLE favorites(user_id TEXT,item_id TEXT,item_type TEXT,created_at INTEGER)');
  old.prepare("INSERT INTO favorites VALUES ('alice',?,'file',1)").run(Buffer.from(path.join(media, 'later.jpg')).toString('base64')); old.close();
  await writeFile(path.join(legacy, 'lumina-config.json'), JSON.stringify({ libraryPaths: [media], users: [{ username: 'alice', password: 'synthetic password', isAdmin: true }] }));
  const db = openDatabase(':memory:');
  try {
    await importLegacy(db, { legacyDir: legacy, mediaRoots: [media] });
    const library = db.prepare('SELECT id,root FROM libraries').get() as { id: string; root: string };
    await scanLibrary(db, library, { allowedRoots: [media] });
    assert.deepEqual(legacyImport.reconcileLegacyFavorites(db, { finalize: true }), { imported: 0, pending: 0, unmatched: 1 });
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at,result) VALUES ('old-import','import_legacy','旧数据','succeeded','system',1,?)")
      .run(JSON.stringify({ imported: 0, pending: 0, unmatched: 1, unmappedRoots: 0 }));
    await writeFile(path.join(media, 'later.jpg'), 'synthetic image');
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at,payload) VALUES ('later-scan','scan','扫描','queued','manual',2,?)").run(JSON.stringify({ libraryId: library.id }));
    await runNextJob(db, { owner: 'worker', allowedRoots: [media], legacyDir: legacy, systemRoots: [] });
    const updated = db.prepare("SELECT result FROM jobs WHERE id='old-import'").get() as { result: string };
    assert.deepEqual(JSON.parse(updated.result), { imported: 1, pending: 0, unmatched: 0, unmappedRoots: 0 });
    assert.equal((db.prepare('SELECT count(*) AS n FROM favorites').get() as { n: number }).n, 1);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('嵌套媒体库的旧收藏优先匹配已启用且实际收录媒体的最深目录', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-old-nested-')); const child = path.join(dir, 'sub');
  await mkdir(child); await writeFile(path.join(child, 'a.jpg'), 'synthetic image');
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO users(id,username,password_hash,role,preferences,created_at) VALUES ('u','user','hash','user','{}',1)").run();
    db.prepare("INSERT INTO libraries(id,name,root,enabled) VALUES ('parent','父库',?,1),('child','子库',?,0)").run(dir, child);
    await scanLibrary(db, { id: 'parent', root: dir }, { allowedRoots: [dir] });
    const addPending = (key: string) => db.prepare("INSERT INTO legacy_favorites_pending(source_key,username,user_id,legacy_item,absolute_path,item_type,created_at,status) VALUES (?,'user','u','old',?,'file',1,'unmatched')").run(key, path.join(child, 'a.jpg'));
    addPending('one');
    assert.deepEqual(legacyImport.reconcileLegacyFavorites(db, { finalize: true }), { imported: 1, pending: 0, unmatched: 0 });
    db.prepare("UPDATE libraries SET enabled=1 WHERE id='child'").run();
    addPending('two');
    assert.deepEqual(legacyImport.reconcileLegacyFavorites(db, { finalize: true }), { imported: 2, pending: 0, unmatched: 0 });
    await scanLibrary(db, { id: 'child', root: child }, { allowedRoots: [dir] });
    addPending('three');
    assert.deepEqual(legacyImport.reconcileLegacyFavorites(db, { finalize: true }), { imported: 3, pending: 0, unmatched: 0 });
    const paths = db.prepare("SELECT f.library_id FROM favorites v JOIN files f ON f.id=v.item_id WHERE v.user_id='u' ORDER BY f.library_id").all() as { library_id: string }[];
    assert.deepEqual(paths.map((row) => row.library_id), ['child', 'parent']);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('嵌套媒体库的旧收藏只匹配用户有权访问的目录', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-old-nested-permission-')); const child = path.join(dir, 'sub');
  await mkdir(child); await writeFile(path.join(child, 'a.jpg'), 'synthetic image');
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO users(id,username,password_hash,role,allowed_paths,preferences,created_at) VALUES ('u','user','hash','user',?,'{}',1)").run(JSON.stringify(['parent']));
    db.prepare("INSERT INTO libraries(id,name,root,enabled) VALUES ('parent','父库',?,1),('child','子库',?,1)").run(dir, child);
    await scanLibrary(db, { id: 'parent', root: dir }, { allowedRoots: [dir] });
    await scanLibrary(db, { id: 'child', root: child }, { allowedRoots: [dir] });
    const addPending = (key: string) => db.prepare("INSERT INTO legacy_favorites_pending(source_key,username,user_id,legacy_item,absolute_path,item_type,created_at,status) VALUES (?,'user','u','old',?,'file',1,'unmatched')").run(key, path.join(child, 'a.jpg'));
    addPending('one');
    assert.deepEqual(legacyImport.reconcileLegacyFavorites(db, { finalize: true }), { imported: 1, pending: 0, unmatched: 0 });
    const first = db.prepare("SELECT f.library_id FROM favorites v JOIN files f ON f.id=v.item_id WHERE v.user_id='u'").get() as { library_id: string };
    assert.equal(first.library_id, 'parent');
    db.prepare("UPDATE users SET allowed_paths='[]' WHERE id='u'").run(); addPending('two');
    assert.deepEqual(legacyImport.reconcileLegacyFavorites(db, { finalize: true }), { imported: 1, pending: 0, unmatched: 1 });
    db.prepare("UPDATE users SET allowed_paths=? WHERE id='u'").run(JSON.stringify(['child']));
    assert.deepEqual(legacyImport.reconcileLegacyFavorites(db, { finalize: true }), { imported: 2, pending: 0, unmatched: 0 });
    const libraries = db.prepare("SELECT f.library_id FROM favorites v JOIN files f ON f.id=v.item_id WHERE v.user_id='u' ORDER BY f.library_id").all() as { library_id: string }[];
    assert.deepEqual(libraries.map((row) => row.library_id), ['child', 'parent']);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('缺少旧配置时，身份不明的现有用户收藏不会静默推进游标', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-old-favorite-identity-')); const filename = path.join(dir, 'v2.db');
  let db = openDatabase(filename);
  try {
    const config = path.join(dir, 'lumina-config.json');
    await writeFile(config, JSON.stringify({ users: [
      { username: 'alice', password: 'synthetic password', isAdmin: true },
      { username: 'bob', password: 'synthetic password', isAdmin: true },
    ] }));
    await importLegacy(db, { legacyDir: dir, mediaRoots: [] });
    db.prepare("DELETE FROM legacy_jwt_users WHERE user_id=(SELECT id FROM users WHERE username='alice')").run();
    db.prepare("INSERT INTO legacy_jwt_revoked_users(username) VALUES ('alice')").run();
    db.exec('DROP TABLE legacy_import_users; DROP TABLE legacy_import_tokens; ALTER TABLE api_tokens DROP COLUMN legacy_jwt; PRAGMA user_version=21');
    db.close(); db = openDatabase(filename); await unlink(config);
    const source = new Database(path.join(dir, 'lumina.db'));
    source.exec('CREATE TABLE files(id TEXT,path TEXT); CREATE TABLE favorites(user_id TEXT,item_id TEXT,item_type TEXT,created_at INTEGER)');
    source.prepare("INSERT INTO favorites VALUES ('alice',?,'file',1)").run(Buffer.from(path.join(dir, 'photo.jpg')).toString('base64')); source.close();
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('legacy','import_legacy','旧导入','queued','manual',1)").run();
    await runNextJob(db, { owner: 'worker', allowedRoots: [], legacyDir: dir, systemRoots: [] });
    const job = db.prepare("SELECT status,error FROM jobs WHERE id='legacy'").get() as { status: string; error: string };
    assert.equal(job.status, 'failed'); assert.match(job.error, /无法安全确认/);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='legacy.favorites.rowid'").get(), undefined);
  } finally { if (db.open) db.close(); await rm(dir, { recursive: true, force: true }); }
});
