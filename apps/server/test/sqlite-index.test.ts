import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { existsSync } from 'node:fs';

test('实时目录时间更新只作用于身份匹配的目录', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name,dev,ino,mtime_ms) VALUES ('lib/a','lib','lib','a','1','2',1000)").run();
    const { SqliteLibraryIndex } = await import('../src/watch/sqlite-index.ts');
    const port = new SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    const entry = { path: 'a', isDir: true, mediaId: null, size: 0, mtimeMs: 2000, dev: '1', ino: '2', headHash: null };
    await port.writeDirectoryMtime(entry);
    assert.equal((db.prepare("SELECT mtime_ms FROM folders WHERE path='lib/a'").get() as { mtime_ms: number }).mtime_ms, 2000);
    await port.writeDirectoryMtime({ ...entry, ino: 'other', mtimeMs: 3000 });
    assert.equal((db.prepare("SELECT mtime_ms FROM folders WHERE path='lib/a'").get() as { mtime_ms: number }).mtime_ms, 2000);
  } finally { db.close(); }
});

test('SQLite 目录移动原子改写子孙和路径引用，保留媒体 ID 及缺失状态', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-sqlite-index-')); const filename = path.join(dir, 'db.sqlite');
  let db = openDatabase(filename); let reader = openDatabase(filename, { readonly: true });
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name,dev,ino,mtime_ms) VALUES ('lib','lib',NULL,'照片',NULL,NULL,NULL),('lib/old','lib','lib','old','1','2',1),('lib/old/nested','lib','lib/old','nested','1','3',1)").run();
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,dev,ino,mtime_ms,missing_at_ms) VALUES ('f','lib','old/nested/a.jpg','lib/old/nested','a.jpg','image/jpeg','image',1,1,1,'mtime','1','4',1000,10)").run();
    db.prepare("INSERT INTO users(id,username,password_hash,role,allowed_paths,preferences,created_at) VALUES ('u','user','hash','user',?,'{}',1)").run(JSON.stringify(['lib/old/nested']));
    db.prepare("INSERT INTO favorites(user_id,item_id,item_type) VALUES ('u','lib/old/nested','folder')").run();
    db.prepare("INSERT INTO albums(id,user_id,name,kind,filter,cover_id,created_at,updated_at) VALUES ('a','u','相册','smart',?,'f',1,1)").run(JSON.stringify({ under: 'lib/old/nested' }));
    db.prepare("INSERT INTO shares(id,user_id,token,title,target,created_at) VALUES ('s','u','token','分享',?,1)").run(JSON.stringify({ type: 'folder', path: 'lib/old' }));
    assert.ok(existsSync(new URL('../src/watch/sqlite-index.ts', import.meta.url)), '缺少 SQLite 索引端口');
    const mod = await import('../src/watch/sqlite-index.ts');
    const port = new mod.SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    const old = (await port.readDirectory('')).find((v) => v.path === 'old')!; assert.ok(old);
    await port.writeMoved(old, { ...old, path: 'new' });
    assert.equal((reader.prepare("SELECT relative_path FROM files WHERE id='f'").get() as { relative_path: string }).relative_path, 'old/nested/a.jpg');
    await port.appendChange({ ts: new Date().toISOString(), kind: 'moved', path: 'new', fromPath: 'old', isDir: true, mediaId: null, source: 'watch' });
    assert.deepEqual(reader.prepare("SELECT id,relative_path,folder,missing_at_ms FROM files WHERE id='f'").get(), { id: 'f', relative_path: 'new/nested/a.jpg', folder: 'lib/new/nested', missing_at_ms: 10 });
    assert.equal((reader.prepare("SELECT parent FROM folders WHERE path='lib/new/nested'").get() as { parent: string }).parent, 'lib/new');
    assert.ok(reader.prepare("SELECT 1 FROM files_fts WHERE files_fts MATCH 'new'").get());
    assert.ok(reader.prepare("SELECT 1 FROM favorites WHERE item_id='lib/new/nested'").get());
    assert.deepEqual(JSON.parse((reader.prepare("SELECT allowed_paths FROM users WHERE id='u'").get() as { allowed_paths: string }).allowed_paths), ['lib/new/nested']);
    assert.equal(JSON.parse((reader.prepare("SELECT filter FROM albums WHERE id='a'").get() as { filter: string }).filter).under, 'lib/new/nested');
    assert.equal(JSON.parse((reader.prepare("SELECT target FROM shares WHERE id='s'").get() as { target: string }).target).path, 'lib/new');
    assert.equal((reader.prepare("SELECT cover_id FROM albums WHERE id='a'").get() as { cover_id: string }).cover_id, 'f');
    assert.equal((reader.prepare("SELECT count(*) AS n FROM library_changes WHERE kind='moved'").get() as { n: number }).n, 1);
  } finally { if (reader.open) reader.close(); if (db.open) db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('索引写入后日志提交前连接中断，数据库同时回滚索引与日志', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-sqlite-index-crash-')); const filename = path.join(dir, 'db.sqlite'); let db = openDatabase(filename);
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片')").run();
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES ('f','lib','a.jpg','lib','a.jpg','image/jpeg','image',1,1,1,'mtime')").run();
    assert.ok(existsSync(new URL('../src/watch/sqlite-index.ts', import.meta.url)), '缺少 SQLite 索引端口');
    const mod = await import('../src/watch/sqlite-index.ts');
    const port = new mod.SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    const old = (await port.readDirectory(''))[0]!; await port.writeMissing(old, Date.now());
    db.close(); db = openDatabase(filename);
    assert.equal((db.prepare("SELECT missing_at_ms FROM files WHERE id='f'").get() as { missing_at_ms: number | null }).missing_at_ms, null);
    assert.equal((db.prepare('SELECT count(*) AS n FROM library_changes').get() as { n: number }).n, 0);
  } finally { if (db.open) db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('过期的缺失候选不能删除已恢复的媒体', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片')").run();
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,missing_at_ms) VALUES ('f','lib','a.jpg','lib','a.jpg','image/jpeg','image',1,1,1,'mtime',10)").run();
    const { SqliteLibraryIndex } = await import('../src/watch/sqlite-index.ts');
    const port = new SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    const old = (await port.readDirectory(''))[0]!;
    db.prepare("UPDATE files SET missing_at_ms=NULL WHERE id='f'").run();
    await assert.rejects(port.writeRemoved(old), /索引已变化/);
    assert.ok(db.prepare("SELECT 1 FROM files WHERE id='f'").get());
    assert.equal(db.inTransaction, false);
  } finally { db.close(); }
});

test('新增文件的路径哈希被移动媒体占用时分配新 ID', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片')").run();
    const { mediaId } = await import('../src/core/paths.ts'); const original = mediaId('lib', 'a.jpg');
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES (?,'lib','b.jpg','lib','b.jpg','image/jpeg','image',1,1,1,'mtime')").run(original);
    const { SqliteLibraryIndex } = await import('../src/watch/sqlite-index.ts');
    const port = new SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    const entry = { path: 'a.jpg', isDir: false, mediaId: null, size: 2, mtimeMs: 2000, dev: '1', ino: '2', headHash: null };
    const id = await port.writeAdded(entry); assert.ok(id); assert.notEqual(id, original);
    await port.appendChange({ ts: new Date().toISOString(), kind: 'added', path: 'a.jpg', fromPath: null, isDir: false, mediaId: id, source: 'watch' });
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 2);
  } finally { db.close(); }
});

test('恢复并移动后内容发生变化时保留 ID 并使旧元数据失效', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片')").run();
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,mtime_ms,head_hash,thumb_ready,thumb_version,metadata_status,missing_at_ms) VALUES ('f','lib','a.jpg','lib','a.jpg','image/jpeg','image',1,1,1,'mtime',1000,'old',1,2,'done',10)").run();
    const { SqliteLibraryIndex } = await import('../src/watch/sqlite-index.ts');
    const port = new SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    const old = (await port.readDirectory(''))[0]!;
    await port.writeRestored(old, { ...old, path: 'b.png', size: 2, mtimeMs: 2000, headHash: 'new' });
    await port.appendChange({ ts: new Date().toISOString(), kind: 'restored', path: 'b.png', fromPath: null, isDir: false, mediaId: 'f', source: 'watch' });
    assert.deepEqual(db.prepare("SELECT id,relative_path,mime,size,metadata_status,thumb_ready,thumb_version,head_hash FROM files WHERE id='f'").get(),
      { id: 'f', relative_path: 'b.png', mime: 'image/png', size: 2, metadata_status: 'pending', thumb_ready: 0, thumb_version: 3, head_hash: 'new' });
    assert.deepEqual((db.prepare('SELECT kind,from_path FROM library_changes ORDER BY id').all() as { kind: string; from_path: string | null }[]),
      [{ kind: 'restored', from_path: null }, { kind: 'moved', from_path: 'a.jpg' }]);
    await port.appendChange({ ts: new Date().toISOString(), kind: 'moved', path: 'b.png', fromPath: 'a.jpg', isDir: false, mediaId: 'f', source: 'watch' });
    assert.equal((db.prepare('SELECT count(*) AS n FROM library_changes').get() as { n: number }).n, 2);
  } finally { db.close(); }
});

test('错误的移动日志会回滚索引写入', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片')").run();
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES ('f','lib','a.jpg','lib','a.jpg','image/jpeg','image',1,1,1,'mtime')").run();
    const { SqliteLibraryIndex } = await import('../src/watch/sqlite-index.ts');
    const port = new SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    const old = (await port.readDirectory(''))[0]!; await port.writeMoved(old, { ...old, path: 'b.jpg' });
    await assert.rejects(port.appendChange({ ts: new Date().toISOString(), kind: 'moved', path: 'b.jpg', fromPath: 'wrong.jpg', isDir: false, mediaId: 'f', source: 'watch' }), /不匹配/);
    assert.equal((db.prepare("SELECT relative_path FROM files WHERE id='f'").get() as { relative_path: string }).relative_path, 'a.jpg');
    assert.equal((db.prepare('SELECT count(*) AS n FROM library_changes').get() as { n: number }).n, 0);
  } finally { db.close(); }
});

test('只更新设备身份时保留已经生成的缩略图和元数据', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片')").run();
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,dev,ino,mtime_ms,head_hash,thumb_ready,thumb_version,metadata_status) VALUES ('f','lib','a.jpg','lib','a.jpg','image/jpeg','image',1,1,1,'mtime','1','2',1000,'hash',1,2,'done')").run();
    const { SqliteLibraryIndex } = await import('../src/watch/sqlite-index.ts');
    const port = new SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    const old = (await port.readDirectory(''))[0]!; await port.writeUpdated(old, { ...old, dev: '3', ino: '4' });
    await port.appendChange({ ts: new Date().toISOString(), kind: 'updated', path: 'a.jpg', fromPath: null, isDir: false, mediaId: 'f', source: 'watch' });
    assert.deepEqual(db.prepare("SELECT thumb_ready,thumb_version,metadata_status FROM files WHERE id='f'").get(), { thumb_ready: 1, thumb_version: 2, metadata_status: 'done' });
  } finally { db.close(); }
});

test('清理缺失目录时不会删除已经恢复的子项或使其失去父目录', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name,missing_at_ms) VALUES ('lib','lib',NULL,'照片',NULL),('lib/old','lib','lib','old',10)").run();
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES ('f','lib','old/a.jpg','lib/old','a.jpg','image/jpeg','image',1,1,1,'mtime')").run();
    const { SqliteLibraryIndex } = await import('../src/watch/sqlite-index.ts');
    const port = new SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    const old = (await port.readDirectory(''))[0]!;
    await assert.rejects(port.writeRemoved(old), /索引已变化/);
    assert.ok(db.prepare("SELECT 1 FROM files WHERE id='f'").get()); assert.ok(db.prepare("SELECT 1 FROM folders WHERE path='lib/old'").get());
  } finally { db.close(); }
});

test('全量扫描持有租约时实时索引拒绝写入并保留原状态', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片')").run();
    db.prepare("INSERT INTO scan_locks(library_id,owner,acquired_at,heartbeat_at,lease_expires_at) VALUES ('lib','scanner',unixepoch(),unixepoch(),unixepoch()+30)").run();
    const { SqliteLibraryIndex } = await import('../src/watch/sqlite-index.ts');
    const port = new SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    await assert.rejects(port.writeAdded({ path: 'a.jpg', isDir: false, mediaId: null, size: 1, mtimeMs: 1000, dev: '1', ino: '2', headHash: null }), /扫描/);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 0); assert.equal(db.inTransaction, false);
    db.prepare('DELETE FROM scan_locks').run();
    const id = await port.writeAdded({ path: 'a.jpg', isDir: false, mediaId: null, size: 1, mtimeMs: 1000, dev: '1', ino: '2', headHash: null });
    await port.appendChange({ ts: new Date().toISOString(), kind: 'added', path: 'a.jpg', fromPath: null, isDir: false, mediaId: id, source: 'watch' });
    assert.ok(id);
  } finally { db.close(); }
});


test('内容摘要变化时监控更新切换缓存版本，身份更新不切换', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片')").run();
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,mtime_ms,head_hash) VALUES ('f','lib','a.jpg','lib','a.jpg','image/jpeg','image',1,1,1,'mtime',1000,'old')").run();
    const { SqliteLibraryIndex } = await import('../src/watch/sqlite-index.ts'); const { cacheKey } = await import('../src/core/media-cache.ts');
    const port = new SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    const old = (await port.readDirectory(''))[0]!; const before = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    await port.writeUpdated(old, { ...old, headHash: 'new' });
    await port.appendChange({ ts: new Date().toISOString(), kind: 'updated', path: 'a.jpg', fromPath: null, isDir: false, mediaId: 'f', source: 'watch' });
    const after = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as typeof before;
    assert.notEqual(cacheKey(before, { kind: 'thumb', size: 'm' }), cacheKey(after, { kind: 'thumb', size: 'm' }));
  } finally { db.close(); }
});


test('实时目录移动和同名新建清理过期日志去重状态', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片'),('lib/old','lib','lib','old')").run();
    db.prepare("INSERT INTO scan_expiry_logged(library_id,path) VALUES ('lib','old'),('lib','old/sub')").run();
    const { SqliteLibraryIndex } = await import('../src/watch/sqlite-index.ts');
    const port = new SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    const old = (await port.readDirectory('')).find((row) => row.path === 'old')!;
    await port.writeMoved(old, { ...old, path: 'new' });
    await port.appendChange({ ts: new Date().toISOString(), kind: 'moved', path: 'new', fromPath: 'old', isDir: true, mediaId: null, source: 'watch' });
    assert.equal((db.prepare('SELECT count(*) AS n FROM scan_expiry_logged').get() as { n: number }).n, 0);
    db.prepare("INSERT INTO scan_expiry_logged(library_id,path) VALUES ('lib','old')").run();
    await port.writeAdded({ path: 'old', isDir: true, mediaId: null, size: 0, mtimeMs: 1, dev: '2', ino: '3', headHash: null });
    await port.appendChange({ ts: new Date().toISOString(), kind: 'added', path: 'old', fromPath: null, isDir: true, mediaId: null, source: 'watch' });
    assert.equal((db.prepare('SELECT count(*) AS n FROM scan_expiry_logged').get() as { n: number }).n, 0);
  } finally { db.close(); }
});

test('临时新增记录变化后移动合并拒绝覆盖并保持事务回滚', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'照片')").run();
    db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,dev,ino,mtime_ms,head_hash)
      VALUES ('old','lib','old.jpg','lib','old.jpg','image/jpeg','image',1,1,1,'mtime','1','2',1000,'hash'),
             ('temp','lib','new.jpg','lib','new.jpg','image/jpeg','image',2,1,1,'mtime','1','2',1000,'changed')`).run();
    const { SqliteLibraryIndex } = await import('../src/watch/sqlite-index.ts');
    const port = new SqliteLibraryIndex(db, { libraryId: 'lib', requestFullReconcile: async () => {}, publishEvent: async () => {} });
    const old = (await port.readDirectory('')).find((entry) => entry.path === 'old.jpg')!;
    await assert.rejects(port.writeMoved(old, { ...old, path: 'new.jpg', mediaId: 'temp' }), /临时媒体索引已变化/);
    assert.equal((db.prepare('SELECT count(*) n FROM files').get() as {n:number}).n, 2); assert.equal(db.inTransaction, false);
  } finally { db.close(); }
});
