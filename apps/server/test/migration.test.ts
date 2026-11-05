import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, scryptSync } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/core/database.ts';
import * as legacyImport from '../src/worker/import-legacy.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { verifyPassword } from '../src/core/password.ts';

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
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
  const token = 'fixture-wallpaper-token';
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
