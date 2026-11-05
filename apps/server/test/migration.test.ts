import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, scryptSync } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/core/database.ts';
import { importLegacy } from '../src/worker/import-legacy.ts';
import { verifyPassword } from '../src/core/password.ts';

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
test('导入 v1 用户、哈希、收藏和壁纸令牌，重跑幂等且不改源库', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-old-'));
  const media = path.join(dir, 'media');
  const legacy = path.join(dir, 'old');
  await mkdir(media); await mkdir(legacy);
  const oldPath = path.join(legacy, 'lumina.db');
  const source = new Database(oldPath);
  source.exec(`CREATE TABLE files (id TEXT PRIMARY KEY,path TEXT,name TEXT,folder_path TEXT,size INTEGER,type TEXT,media_type TEXT,last_modified INTEGER,source_id TEXT,thumb_width INTEGER,thumb_height INTEGER,thumb_aspect_ratio REAL);
    CREATE TABLE favorites (id INTEGER PRIMARY KEY,user_id TEXT,item_id TEXT,item_type TEXT,created_at INTEGER);`);
  const full = path.join(media, '照片.jpg');
  const oldId = Buffer.from(full).toString('base64');
  const salt = Buffer.alloc(16, 2);
  const password = `scrypt$${salt.toString('hex')}$${scryptSync('测试密码', salt, 64).toString('hex')}`;
  source.prepare('INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(oldId, full, '照片.jpg', media, 7, 'image/jpeg', 'image', 1700000000, 'local', 50, 100, .5);
  source.prepare('INSERT INTO favorites (user_id,item_id,item_type,created_at) VALUES (?,?,?,?)').run('alice', oldId, 'file', 1700000000);
  source.close();
  const token = 'fixture-wallpaper-token';
  await writeFile(path.join(legacy, 'lumina-config.json'), JSON.stringify({ title: '家庭图库', libraryPaths: [media], users: [{ username: 'alice', password, isAdmin: true, wallpaperToken: token }] }));
  const before = sha(await readFile(oldPath));
  const db = openDatabase(':memory:');
  try {
    await importLegacy(db, { legacyDir: legacy, mediaRoots: [media], batchSize: 1 });
    await importLegacy(db, { legacyDir: legacy, mediaRoots: [media], batchSize: 1 });
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 1);
    assert.equal((db.prepare('SELECT password_hash FROM users').get() as { password_hash: string }).password_hash, password);
    assert.equal((db.prepare('SELECT token_hash FROM api_tokens').get() as { token_hash: string }).token_hash, sha(token));
    assert.equal((db.prepare('SELECT count(*) AS n FROM favorites').get() as { n: number }).n, 1);
    assert.equal(JSON.parse((db.prepare("SELECT value FROM settings WHERE key='siteName'").get() as { value: string }).value), '家庭图库');
    assert.equal(sha(await readFile(oldPath)), before);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('旧版毫秒时间戳在导入时阻断，避免伪造修改时间', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-old-ms-'));
  const oldPath = path.join(dir, 'lumina.db');
  const media = path.join(dir, 'media');
  await mkdir(media);
  const source = new Database(oldPath);
  source.exec(`CREATE TABLE files (id TEXT PRIMARY KEY,path TEXT,name TEXT,folder_path TEXT,size INTEGER,type TEXT,media_type TEXT,last_modified INTEGER,source_id TEXT,thumb_width INTEGER,thumb_height INTEGER,thumb_aspect_ratio REAL);
    CREATE TABLE favorites (id INTEGER PRIMARY KEY,user_id TEXT,item_id TEXT,item_type TEXT,created_at INTEGER);`);
  const file = path.join(media, 'renamed.jpg');
  source.prepare('INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(Buffer.from(file).toString('base64'), file, 'renamed.jpg', media, 7, 'image/jpeg', 'image', 1700000000000, 'local', null, null, null);
  source.close();
  const db = openDatabase(':memory:');
  try {
    await assert.rejects(importLegacy(db, { legacyDir: dir, mediaRoots: [media] }), /时间戳/);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 0);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='legacy.files.rowid'").get(), undefined);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});


test('导入时立即转换旧版明文口令', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-old-plain-'));
  await writeFile(path.join(dir, 'lumina-config.json'), JSON.stringify({ users: [{ username: 'old', password: 'fixture password', isAdmin: true }] }));
  const db = openDatabase(':memory:');
  try {
    await importLegacy(db, { legacyDir: dir, mediaRoots: [] });
    const row = db.prepare("SELECT password_hash FROM users WHERE username='old'").get() as { password_hash: string };
    assert.match(row.password_hash, /^scrypt\$v2\$/);
    assert.equal((await verifyPassword('fixture password', row.password_hash)).valid, true);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('旧版根目录为越过白名单的符号链接时拒绝导入', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-old-link-'));
  const allowed = path.join(dir, 'allowed'); const outside = path.join(dir, 'outside');
  await mkdir(allowed); await mkdir(outside);
  const link = path.join(allowed, 'link'); await symlink(outside, link);
  await writeFile(path.join(dir, 'lumina-config.json'), JSON.stringify({ libraryPaths: [link] }));
  const db = openDatabase(':memory:');
  try {
    await assert.rejects(importLegacy(db, { legacyDir: dir, mediaRoots: [allowed] }), /挂载根/);
    assert.equal((db.prepare('SELECT count(*) AS n FROM libraries').get() as { n: number }).n, 0);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});
