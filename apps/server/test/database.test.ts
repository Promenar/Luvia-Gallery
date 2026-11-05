import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import Database from 'better-sqlite3';

test('数据库迁移持久且可重复，支持只读连接', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-db-'));
  const filename = path.join(dir, 'luvia.db');
  try {
    const db = openDatabase(filename);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('user_version', { simple: true }), 8);
    db.prepare("INSERT INTO libraries (id, name, root) VALUES ('lib1', '测试', '/test')").run();
    db.close();
    const writable = openDatabase(filename);
    assert.equal((writable.prepare('SELECT count(*) AS n FROM libraries').get() as { n: number }).n, 1);
    writable.close();
    const readonly = openDatabase(filename, { readonly: true });
    assert.equal((readonly.prepare('SELECT count(*) AS n FROM libraries').get() as { n: number }).n, 1);
    assert.throws(() => readonly.prepare("DELETE FROM libraries").run());
    readonly.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('仅新建数据库时原子排队一次旧数据导入', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-bootstrap-'));
  const filename = path.join(dir, 'luvia.db');
  try {
    const first = openDatabase(filename, { bootstrapLegacy: true });
    assert.equal((first.prepare("SELECT count(*) AS n FROM jobs WHERE type='import_legacy' AND status='queued'").get() as { n: number }).n, 1);
    assert.equal((first.prepare("SELECT value FROM settings WHERE key='legacy.pending'").get() as { value: string }).value, 'true');
    first.close();
    const again = openDatabase(filename, { bootstrapLegacy: true });
    assert.equal((again.prepare("SELECT count(*) AS n FROM jobs WHERE type='import_legacy'").get() as { n: number }).n, 1);
    again.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('trigram 索引能查找中文中间子串并在修改后同步', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries (id, name, root) VALUES ('lib1', '测试', '/test')").run();
    db.prepare(`INSERT INTO files (id, library_id, relative_path, folder, name, mime, media_type, size, modified_at, taken_at, taken_at_source)
      VALUES ('a', 'lib1', '旅行/美丽的西湖风景.jpg', 'lib1/旅行', '美丽的西湖风景.jpg', 'image/jpeg', 'image', 1, 1, 1, 'mtime')`).run();
    const find = db.prepare('SELECT rowid FROM files_fts WHERE files_fts MATCH ?');
    assert.equal(find.all('西湖风').length, 1);
    db.prepare("UPDATE files SET name = '全新名字.jpg' WHERE id = 'a'").run();
    assert.equal(find.all('西湖风').length, 0);
    assert.equal(find.all('全新名').length, 1);
    db.prepare("DELETE FROM files WHERE id = 'a'").run();
    assert.equal(find.all('全新名').length, 0);
  } finally { db.close(); }
});


test('已有版本 1 数据库升级时保留数据并创建扫描锁表', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-upgrade-'));
  const filename = path.join(dir, 'luvia.db');
  const old = new Database(filename);
  old.exec("CREATE TABLE libraries (id TEXT PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE folders (path TEXT PRIMARY KEY, library_id TEXT NOT NULL); CREATE TABLE api_tokens (id TEXT PRIMARY KEY); CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL); INSERT INTO libraries VALUES ('lib1','测试'); PRAGMA user_version=1");
  old.close();
  try {
    const db = openDatabase(filename);
    assert.equal(db.pragma('user_version', { simple: true }), 8);
    assert.equal((db.prepare('SELECT count(*) AS n FROM libraries').get() as { n: number }).n, 1);
    db.prepare("INSERT INTO scan_locks(library_id,owner,acquired_at) VALUES ('lib1','owner',1)").run();
    db.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
