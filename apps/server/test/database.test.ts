import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import Database from 'better-sqlite3';

test('版本 22 升级保留媒体及关联数据并提供持久身份字段', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-watch-upgrade-'));
  const filename = path.join(dir, 'v22.sqlite');
  try {
    await copyFile(new URL('./fixtures/watch-v22.sqlite', import.meta.url), filename);
    const db = openDatabase(filename);
    try {
      assert.equal(db.pragma('user_version', { simple: true }), 27);
      assert.deepEqual(db.prepare("SELECT id,missing_at_ms,dev,ino,mtime_ms,head_hash FROM files WHERE id='f'").get(),
        { id: 'f', missing_at_ms: null, dev: null, ino: null, mtime_ms: null, head_hash: null });
      db.prepare("UPDATE files SET dev=?,ino=?,mtime_ms=?,head_hash=? WHERE id='f'").run('18446744073709551615', '18446744073709551614', 1234.5, 'abc');
      assert.deepEqual(db.prepare("SELECT dev,ino FROM files WHERE id='f'").get(), { dev: '18446744073709551615', ino: '18446744073709551614' });
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='file_watch_index'").get(), '缺少增量回填的身份索引');
      assert.deepEqual(db.prepare("SELECT file_id FROM file_watch_index WHERE library_id='lib' AND dev=? AND ino=?").all('18446744073709551615', '18446744073709551614'), [{ file_id: 'f' }]);
      db.prepare("UPDATE files SET missing_at_ms=2000 WHERE id='f'").run();
      assert.deepEqual(db.prepare("SELECT file_id FROM file_watch_index WHERE library_id='lib' AND missing_at_ms=2000").all(), [{ file_id: 'f' }]);
      assert.equal((db.prepare("SELECT count(*) AS n FROM favorites WHERE item_id='f'").get() as { n: number }).n, 1);
      assert.equal((db.prepare("SELECT count(*) AS n FROM album_items WHERE file_id='f'").get() as { n: number }).n, 1);
      assert.equal((db.prepare("SELECT count(*) AS n FROM cache_entries WHERE media_id='f'").get() as { n: number }).n, 1);
      assert.deepEqual(db.prepare("SELECT missing_at_ms,dev,ino,mtime_ms FROM folders LIMIT 1").all(), []);
    } finally { db.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('数据库迁移持久且可重复，支持只读连接', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-db-'));
  const filename = path.join(dir, 'luvia.db');
  try {
    const db = openDatabase(filename);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    assert.equal(db.pragma('user_version', { simple: true }), 27);
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

test('物化月份统计随文件新增、拍摄时间变更和删除保持一致', () => {
  const db = openDatabase(':memory:');
  try {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='timeline_counts'").get();
    assert.ok(exists, '缺少物化时间分桶');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    const insert = db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES (?,'lib',?,'lib',?,'image/jpeg','image',1,?,?, 'mtime')");
    const january = Date.UTC(2024, 0, 15) / 1000; const february = Date.UTC(2024, 1, 15) / 1000;
    insert.run('a', 'a.jpg', 'a.jpg', january, january);
    insert.run('b', 'b.jpg', 'b.jpg', february, february);
    const counts = () => db.prepare('SELECT month,count FROM timeline_counts WHERE count>0 ORDER BY month').all();
    assert.deepEqual(counts(), [{ month: '2024-01', count: 1 }, { month: '2024-02', count: 1 }]);
    db.prepare("UPDATE files SET taken_at=? WHERE id='a'").run(february);
    assert.deepEqual(counts(), [{ month: '2024-02', count: 2 }]);
    db.prepare("DELETE FROM files WHERE id='b'").run();
    assert.deepEqual(counts(), [{ month: '2024-02', count: 1 }]);
  } finally { db.close(); }
});


test('已有版本 1 数据库升级时保留数据并创建扫描锁表', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-upgrade-'));
  const filename = path.join(dir, 'luvia.db');
  const old = new Database(filename);
  old.exec("CREATE TABLE libraries (id TEXT PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE folders (path TEXT PRIMARY KEY, library_id TEXT NOT NULL,cover_file_id TEXT); CREATE TABLE users (id TEXT PRIMARY KEY,username TEXT NOT NULL,role TEXT NOT NULL); CREATE TABLE api_tokens (id TEXT PRIMARY KEY,user_id TEXT,token_hash TEXT); CREATE TABLE jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL,type TEXT,started_at INTEGER); CREATE TABLE files (id TEXT PRIMARY KEY,library_id TEXT,folder TEXT NOT NULL,size INTEGER,taken_at INTEGER NOT NULL,created_at INTEGER NOT NULL DEFAULT 0); CREATE TABLE settings (key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO libraries VALUES ('lib1','测试'); PRAGMA user_version=1");
  old.close();
  try {
    const db = openDatabase(filename);
    assert.equal(db.pragma('user_version', { simple: true }), 27);
    assert.equal((db.prepare('SELECT count(*) AS n FROM libraries').get() as { n: number }).n, 1);
    db.prepare("INSERT INTO scan_locks(library_id,owner,acquired_at) VALUES ('lib1','owner',1)").run();
    db.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
