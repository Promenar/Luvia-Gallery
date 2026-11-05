import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, writeFile, unlink, rm, opendir, symlink, realpath, rename, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { JobQueue } from '../src/core/jobs.ts';
import type { Dirent } from 'node:fs';

test('完整扫描标记缺失并在宽限期恢复，过期后清理关联', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-grace-')); const db = openDatabase(':memory:'); let time = 1000;
  try {
    await mkdir(path.join(root, 'sub')); await writeFile(path.join(root, 'sub', 'a.jpg'), 'original');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO users(id,username,password_hash,role,preferences,created_at) VALUES ('u','user','hash','admin','{}',1)").run();
    db.prepare("INSERT INTO albums(id,user_id,name,kind,created_at,updated_at) VALUES ('album','u','相册','manual',1,1)").run();
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], clock: () => time });
    await scan();
    const id = (db.prepare('SELECT id FROM files').get() as { id: string }).id;
    db.prepare("INSERT INTO favorites(user_id,item_id,item_type) VALUES ('u',?,'file')").run(id);
    db.prepare("INSERT INTO album_items(album_id,file_id,created_at) VALUES ('album',?,1)").run(id);
    db.prepare("INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at,media_id) VALUES ('cache','thumb.jpg',1,1,?)").run(id);
    await rename(path.join(root, 'sub'), `${root}-parked`); time++;
    assert.equal((await scan()).removed, 0);
    assert.equal((db.prepare('SELECT missing_at_ms FROM files WHERE id=?').get(id) as { missing_at_ms: number }).missing_at_ms, time * 1000);
    assert.equal((db.prepare("SELECT missing_at_ms FROM folders WHERE path='lib/sub'").get() as { missing_at_ms: number }).missing_at_ms, time * 1000);
    assert.ok(db.prepare('SELECT 1 FROM favorites WHERE item_id=?').get(id));
    assert.ok(db.prepare('SELECT 1 FROM album_items WHERE file_id=?').get(id));
    assert.ok(db.prepare('SELECT 1 FROM cache_entries WHERE media_id=?').get(id));
    await rename(`${root}-parked`, path.join(root, 'sub')); time++;
    await scan(); assert.deepEqual(db.prepare('SELECT id,missing_at_ms FROM files').get(), { id, missing_at_ms: null });
    await rename(path.join(root, 'sub'), `${root}-parked`); time++; await scan();
    time += 7 * 86_400 + 1; assert.equal((await scan()).removed, 1);
    assert.equal(db.prepare('SELECT 1 FROM files WHERE id=?').get(id), undefined);
    assert.equal(db.prepare('SELECT 1 FROM favorites WHERE item_id=?').get(id), undefined);
    assert.equal(db.prepare('SELECT 1 FROM album_items WHERE file_id=?').get(id), undefined);
    assert.equal(db.prepare('SELECT 1 FROM cache_entries WHERE media_id=?').get(id), undefined);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(`${root}-parked`, { recursive: true, force: true }); }
});

test('零天宽限期在标记后的下一次完整扫描清理', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-grace-zero-')); const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO settings(key,value) VALUES ('admin.settings',?)").run(JSON.stringify({ libraries: { missingGraceDays: 0 } }));
    await writeFile(path.join(root, 'a.jpg'), 'a');
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    await scan(); await unlink(path.join(root, 'a.jpg'));
    assert.equal((await scan()).removed, 0);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 1);
    assert.equal((await scan()).removed, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('过期媒体清理其缩略图缓存文件并保留可恢复清理记录', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'luvia-scan-cache-clean-')); const root = path.join(base, 'media'); const cacheDir = path.join(base, 'cache');
  await mkdir(root); await mkdir(cacheDir); const filename = path.join(base, 'db.sqlite'); let db = openDatabase(filename);
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO settings(key,value) VALUES ('admin.settings',?)").run(JSON.stringify({ libraries: { missingGraceDays: 0 } }));
    await writeFile(path.join(root, 'a.jpg'), 'a');
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    await scan(); const id = (db.prepare('SELECT id FROM files').get() as { id: string }).id;
    await writeFile(path.join(cacheDir, 'thumb.jpg'), 'cache');
    db.prepare("INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at,media_id,variant) VALUES ('cache','thumb.jpg',5,1,?,'thumb')").run(id);
    await unlink(path.join(root, 'a.jpg')); await scan(); await scan();
    assert.ok(db.prepare("SELECT 1 FROM cache_gc WHERE cache_key='cache'").get());
    db.close(); db = openDatabase(filename);
    const { cleanupDeletedMediaCache } = await import('../src/worker/cache-prune.ts');
    await cleanupDeletedMediaCache(db, cacheDir, { owner: 'test' });
    await assert.rejects(access(path.join(cacheDir, 'thumb.jpg')), { code: 'ENOENT' });
    assert.equal(db.prepare("SELECT 1 FROM cache_entries WHERE cache_key='cache'").get(), undefined);
    assert.equal(db.prepare("SELECT 1 FROM cache_gc WHERE cache_key='cache'").get(), undefined);
  } finally { if (db.open) db.close(); await rm(base, { recursive: true, force: true }); }
});

test('超出宽限期后文件重新出现不会恢复旧收藏', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-expired-')); const db = openDatabase(':memory:'); let time = 1000;
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO users(id,username,password_hash,role,preferences,created_at) VALUES ('u','user','hash','admin','{}',1)").run();
    await writeFile(path.join(root, 'a.jpg'), 'a');
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], clock: () => time });
    await scan(); const id = (db.prepare('SELECT id FROM files').get() as { id: string }).id;
    db.prepare("INSERT INTO favorites(user_id,item_id,item_type) VALUES ('u',?,'file')").run(id);
    await rename(path.join(root, 'a.jpg'), `${root}-parked`); time++; await scan();
    time += 7 * 86_400 + 1; await rename(`${root}-parked`, path.join(root, 'a.jpg')); await scan();
    assert.equal(db.prepare("SELECT 1 FROM favorites WHERE item_type='file' AND item_id=?").get(id), undefined);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(`${root}-parked`, { force: true }); }
});

test('扫描按 inode 保留移动媒体 ID，旧路径重新出现时分配不冲突的 ID', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-move-'));
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await writeFile(path.join(root, 'a.jpg'), 'original');
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const original = db.prepare("SELECT id,dev,ino FROM files WHERE relative_path='a.jpg'").get() as { id: string; dev: string | null; ino: string | null };
    assert.ok(original.dev && original.ino, '扫描应记录文件身份');
    await rename(path.join(root, 'a.jpg'), path.join(root, 'b.jpg'));
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    assert.equal((db.prepare("SELECT id FROM files WHERE relative_path='b.jpg'").get() as { id: string }).id, original.id);
    await writeFile(path.join(root, 'a.jpg'), 'replacement');
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const rows = db.prepare('SELECT id,relative_path FROM files ORDER BY relative_path').all() as { id: string; relative_path: string }[];
    assert.equal(rows.length, 2); assert.equal(rows[1]?.id, original.id); assert.notEqual(rows[0]?.id, original.id);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    assert.deepEqual(db.prepare('SELECT id,relative_path FROM files ORDER BY relative_path').all(), rows);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('移动后旧路径同时出现新文件时，扫描顺序不改变原媒体 ID', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-move-replace-')); const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await writeFile(path.join(root, 'a.jpg'), 'original');
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const id = (db.prepare("SELECT id FROM files WHERE relative_path='a.jpg'").get() as { id: string }).id;
    await rename(path.join(root, 'a.jpg'), path.join(root, 'b.jpg'));
    await writeFile(path.join(root, 'a.jpg'), 'replacement');
    const sorted: typeof opendir = async (p, options) => {
      const dir = await opendir(p, options); const entries: Dirent[] = [];
      for await (const entry of dir) entries.push(entry);
      entries.sort((a, b) => a.name.localeCompare(b.name));
      return { async *[Symbol.asyncIterator]() { yield* entries; } } as unknown as Awaited<ReturnType<typeof opendir>>;
    };
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], openDir: sorted });
    const rows = db.prepare('SELECT id,relative_path FROM files ORDER BY relative_path').all() as { id: string; relative_path: string }[];
    assert.equal(rows.length, 2); assert.equal(rows[1]?.id, id); assert.notEqual(rows[0]?.id, id);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('离线互换两个已索引文件路径后仍保留各自媒体 ID', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-swap-')); const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await writeFile(path.join(root, 'a.jpg'), 'first'); await writeFile(path.join(root, 'b.jpg'), 'second');
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], batchSize: 1 }); await scan();
    const original = db.prepare('SELECT id,relative_path FROM files ORDER BY relative_path').all() as { id: string; relative_path: string }[];
    await rename(path.join(root, 'a.jpg'), path.join(root, 'temporary')); await rename(path.join(root, 'b.jpg'), path.join(root, 'a.jpg')); await rename(path.join(root, 'temporary'), path.join(root, 'b.jpg'));
    await scan();
    const after = db.prepare('SELECT id,relative_path FROM files ORDER BY relative_path').all() as { id: string; relative_path: string }[];
    assert.deepEqual(after, [{ id: original[1]!.id, relative_path: 'a.jpg' }, { id: original[0]!.id, relative_path: 'b.jpg' }]);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('离线目录改名后扫描迁移媒体 ID、收藏和目录授权', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-directory-move-')); const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO users(id,username,password_hash,role,allowed_paths,preferences,created_at) VALUES ('u','user','hash','user',?,'{}',1)").run(JSON.stringify(['lib/old']));
    await mkdir(path.join(root, 'old')); await writeFile(path.join(root, 'old', 'a.jpg'), 'first');
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] }); await scan();
    const id = (db.prepare('SELECT id FROM files').get() as { id: string }).id;
    db.prepare("INSERT INTO favorites(user_id,item_id,item_type) VALUES ('u','lib/old','folder')").run();
    await rename(path.join(root, 'old'), path.join(root, 'new')); await scan();
    assert.deepEqual(db.prepare('SELECT id,relative_path FROM files').get(), { id, relative_path: 'new/a.jpg' });
    assert.ok(db.prepare("SELECT 1 FROM favorites WHERE item_id='lib/new'").get());
    assert.deepEqual(JSON.parse((db.prepare("SELECT allowed_paths FROM users WHERE id='u'").get() as { allowed_paths: string }).allowed_paths), ['lib/new']);
    assert.equal(db.prepare("SELECT 1 FROM folders WHERE path='lib/old'").get(), undefined);
    assert.ok(db.prepare("SELECT 1 FROM library_changes WHERE kind='moved' AND path='new' AND from_path='old' AND is_dir=1 AND source='scan'").get());
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('同秒同大小覆盖后扫描使旧缩略图、预览和元数据失效', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-subsecond-')); const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    const filename = path.join(root, 'a.jpg'); const base = 1_700_000_000;
    await writeFile(filename, 'first'); await utimes(filename, base + 0.1, base + 0.1);
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] }); await scan();
    db.prepare("UPDATE files SET thumb_ready=1,thumb_version=1,thumbhash='old',has_preview=1,metadata_status='done',head_hash='old' WHERE name='a.jpg'").run();
    await writeFile(filename, 'other'); await utimes(filename, base + 0.9, base + 0.9); await scan();
    assert.deepEqual(db.prepare('SELECT thumb_ready,thumb_version,thumbhash,has_preview,metadata_status,head_hash FROM files').get(),
      { thumb_ready: 0, thumb_version: 2, thumbhash: null, has_preview: 0, metadata_status: 'pending', head_hash: null });
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('全量扫描将新增、变更、移动、缺失、恢复和清理写入最近变更记录', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-changes-')); const parked = `${root}-parked`; const db = openDatabase(':memory:'); let time = Math.floor(Date.now() / 1000);
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], clock: () => time });
    await writeFile(path.join(root, 'a.jpg'), 'a'); await scan();
    const id = (db.prepare('SELECT id FROM files').get() as { id: string }).id;
    await writeFile(path.join(root, 'a.jpg'), 'changed'); await scan();
    await rename(path.join(root, 'a.jpg'), path.join(root, 'b.jpg')); await scan();
    await rename(path.join(root, 'b.jpg'), parked); time++; await scan();
    await rename(parked, path.join(root, 'b.jpg')); time++; await scan();
    await rename(path.join(root, 'b.jpg'), parked); time++; await scan();
    time += 7 * 86_400 + 1; await scan();
    const changes = db.prepare('SELECT kind,path,from_path,media_id,source FROM library_changes ORDER BY id').all() as { kind: string; path: string; from_path: string | null; media_id: string | null; source: string }[];
    assert.deepEqual(changes.map((v) => [v.kind, v.path, v.from_path, v.media_id, v.source]), [
      ['added', 'a.jpg', null, id, 'scan'], ['updated', 'a.jpg', null, id, 'scan'], ['moved', 'b.jpg', 'a.jpg', id, 'scan'],
      ['missing', 'b.jpg', null, id, 'scan'], ['restored', 'b.jpg', null, id, 'scan'], ['missing', 'b.jpg', null, id, 'scan'], ['removed', 'b.jpg', null, id, 'scan'],
    ]);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(parked, { force: true }); }
});

test('扫描识别缺失文件以新路径恢复时原子记录恢复和移动', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-restore-move-')); const parked = `${root}-parked`; const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    await writeFile(path.join(root, 'a.jpg'), 'a'); await scan(); const id = (db.prepare('SELECT id FROM files').get() as { id: string }).id;
    await rename(path.join(root, 'a.jpg'), parked); await scan(); await rename(parked, path.join(root, 'b.jpg')); await scan();
    assert.deepEqual(db.prepare("SELECT kind,path,from_path,media_id FROM library_changes WHERE kind IN ('restored','moved') ORDER BY id").all(), [
      { kind: 'restored', path: 'b.jpg', from_path: null, media_id: id }, { kind: 'moved', path: 'b.jpg', from_path: 'a.jpg', media_id: id },
    ]);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(parked, { force: true }); }
});

test('扫描目录新增、缺失、恢复及分批清理时记录变更', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-dir-changes-')); const parked = `${root}-parked`; const db = openDatabase(':memory:'); let time = Math.floor(Date.now() / 1000);
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await mkdir(path.join(root, 'album', 'nested'), { recursive: true }); await writeFile(path.join(root, 'album', 'nested', 'a.jpg'), 'a');
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], clock: () => time }); await scan();
    await rename(path.join(root, 'album'), parked); await scan();
    time++; await rename(parked, path.join(root, 'album')); await scan();
    time++; await rename(path.join(root, 'album'), parked); await scan(); time += 7 * 86_400 + 1; await scan();
    assert.deepEqual(db.prepare("SELECT kind,path,is_dir FROM library_changes ORDER BY id").all(), [
      { kind: 'added', path: 'album', is_dir: 1 }, { kind: 'missing', path: 'album', is_dir: 1 },
      { kind: 'restored', path: 'album', is_dir: 1 }, { kind: 'missing', path: 'album', is_dir: 1 },
      { kind: 'removed', path: 'album', is_dir: 1 },
    ]);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(parked, { recursive: true, force: true }); }
});

test('扫描日志写入失败时对应文件索引事务回滚', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-log-rollback-')); const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await writeFile(path.join(root, 'a.jpg'), 'a');
    db.exec("CREATE TRIGGER reject_change BEFORE INSERT ON library_changes BEGIN SELECT RAISE(ABORT,'日志不可写'); END");
    await assert.rejects(scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] }), /日志不可写/);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 0);
    assert.equal((db.prepare('SELECT count(*) AS n FROM library_changes').get() as { n: number }).n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('扫描增删文件；读取错误或取消时保留未见文件', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-'));
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO libraries (id,name,root) VALUES (?,?,?)').run('lib1', '测试', root);
    await mkdir(path.join(root, '子目录'));
    await writeFile(path.join(root, 'a.jpg'), 'image');
    await writeFile(path.join(root, '子目录', 'b.png'), 'image');
    const first = await scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root] });
    assert.equal(first.errors, 0);
    assert.equal(first.added, 2);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 2);
    await unlink(path.join(root, '子目录', 'b.png'));
    const denied: typeof opendir = async (p, options) => {
      if (String(p).endsWith('子目录')) throw Object.assign(new Error('模拟读取错误'), { code: 'EACCES' });
      return opendir(p, options);
    };
    const interrupted = await scanLibrary(db, { id: 'lib1', root }, { openDir: denied, allowedRoots: [root] });
    assert.equal(interrupted.errors, 1);
    assert.equal(interrupted.removed, 0);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 2);
    assert.equal((db.prepare("SELECT missing_at_ms FROM files WHERE name='b.png'").get() as { missing_at_ms: number | null }).missing_at_ms, null);
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(scanLibrary(db, { id: 'lib1', root }, { signal: cancelled.signal, allowedRoots: [root] }));
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 2);
    const complete = await scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root] });
    assert.equal(complete.removed, 0);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 2);
    assert.equal(typeof (db.prepare("SELECT missing_at_ms FROM files WHERE name='b.png'").get() as { missing_at_ms: number }).missing_at_ms, 'number');
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});


test('同一媒体库正在扫描时拒绝第二个扫描，避免互相清理', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-lock-'));
  const db = openDatabase(':memory:');
  let release!: () => void; let entered!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { entered = resolve; });
  try {
    db.prepare('INSERT INTO libraries (id,name,root) VALUES (?,?,?)').run('lib1', '测试', root);
    const delayed: typeof opendir = async (p, options) => { entered(); await blocked; return opendir(p, options); };
    const first = scanLibrary(db, { id: 'lib1', root }, { openDir: delayed, allowedRoots: [root] });
    await started;
    try { await assert.rejects(scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root] }), /正在扫描/); }
    finally { release(); await first; }
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});


test('扫描根目录的真实路径必须在白名单内', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'luvia-scan-root-'));
  const allowed = path.join(base, 'allowed'); const outside = path.join(base, 'outside');
  await mkdir(allowed); await mkdir(outside);
  const root = path.join(allowed, 'link'); await symlink(outside, root);
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO libraries (id,name,root) VALUES (?,?,?)').run('lib1', '测试', root);
    await assert.rejects(scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [allowed] }), /挂载根/);
  } finally { db.close(); await rm(base, { recursive: true, force: true }); }
});


test('目录项类型未知时保护现有索引，禁止执行删除清理', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-unknown-'));
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO libraries (id,name,root) VALUES (?,?,?)').run('lib1', '测试', root);
    await writeFile(path.join(root, 'a.jpg'), 'image');
    await scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root] });
    const unknown: typeof opendir = async (p, options) => {
      const dir = await opendir(p, options);
      return { async *[Symbol.asyncIterator]() {
        for await (const entry of dir) yield { name: entry.name, isDirectory: () => false, isFile: () => false, isSymbolicLink: () => false };
      } } as unknown as Awaited<ReturnType<typeof opendir>>;
    };
    const result = await scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root], openDir: unknown });
    assert.ok(result.errors > 0);
    assert.equal(result.removed, 0);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('扫描锁只接管过期租约', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-lease-'));
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO libraries (id,name,root) VALUES (?,?,?)').run('lib1', '测试', root);
    db.prepare("INSERT INTO scan_locks(library_id,owner,acquired_at,heartbeat_at,lease_expires_at) VALUES ('lib1','old',100,100,130)").run();
    await assert.rejects(scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root], owner: 'new', clock: () => 110 }), /正在扫描/);
    const result = await scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root], owner: 'new', clock: () => 131 });
    assert.equal(result.errors, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('扫描接管后从已持久化目录断点继续', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-resume-'));
  const db = openDatabase(':memory:');
  let time = 100;
  try {
    await mkdir(path.join(root, 'sub'));
    const actualRoot = await realpath(root);
    await writeFile(path.join(root, 'root.jpg'), 'image');
    await writeFile(path.join(root, 'sub', 'child.jpg'), 'image');
    db.prepare('INSERT INTO libraries (id,name,root) VALUES (?,?,?)').run('lib1', '测试', root);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('scan','scan','扫描','queued','manual',100)").run();
    const a = new JobQueue(db, 'worker-a');
    const b = new JobQueue(db, 'worker-b');
    assert.equal(a.claim(time)?.id, 'scan');
    const controller = new AbortController();
    const interrupt: typeof opendir = async (p, options) => {
      if (String(p) === path.join(actualRoot, 'sub')) { controller.abort(); controller.signal.throwIfAborted(); }
      return opendir(p, options);
    };
    await assert.rejects(scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root], owner: 'worker-a', jobId: 'scan', clock: () => time, signal: controller.signal, openDir: interrupt }));
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 1);
    time = 131;
    assert.equal(b.claim(time)?.id, 'scan');
    const opened: string[] = [];
    const observe: typeof opendir = async (p, options) => { opened.push(String(p)); return opendir(p, options); };
    const result = await scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root], owner: 'worker-b', jobId: 'scan', clock: () => time, openDir: observe });
    assert.equal(opened.includes(actualRoot), false);
    assert.equal(result.errors, 0);
    assert.equal(result.added, 2);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 2);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('过期扫描者恢复后不能覆盖已经接管的扫描结果', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-fence-'));
  const db = openDatabase(':memory:');
  let time = 100;
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  try {
    await writeFile(path.join(root, 'a.jpg'), 'image');
    await writeFile(path.join(root, 'note.txt'), '非媒体文件');
    db.prepare('INSERT INTO libraries (id,name,root) VALUES (?,?,?)').run('lib1', '测试', root);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('scan','scan','扫描','queued','manual',100)").run();
    const a = new JobQueue(db, 'worker-a');
    const b = new JobQueue(db, 'worker-b');
    a.claim(time);
    const slow: typeof opendir = async (p, options) => { entered(); await blocked; return opendir(p, options); };
    const first = scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root], owner: 'worker-a', jobId: 'scan', clock: () => time, openDir: slow });
    await started;
    time = 131;
    assert.equal(b.claim(time)?.id, 'scan');
    const result = await scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root], owner: 'worker-b', jobId: 'scan', clock: () => time });
    assert.deepEqual(result, { added: 1, removed: 0, errors: 0 });
    release();
    await assert.rejects(first, /租约已失效/);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 1);
  } finally { release(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('同一 worker 接管过期扫描时旧执行不能删除新锁', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-scan-same-owner-')); const db = openDatabase(':memory:');
  let time = 100; let enteredA!: () => void; let enteredB!: () => void; let releaseA!: () => void; let releaseB!: () => void;
  const startedA = new Promise<void>((resolve) => { enteredA = resolve; }); const startedB = new Promise<void>((resolve) => { enteredB = resolve; });
  const blockedA = new Promise<void>((resolve) => { releaseA = resolve; }); const blockedB = new Promise<void>((resolve) => { releaseB = resolve; });
  try {
    await writeFile(path.join(root, 'a.jpg'), 'image');
    db.prepare('INSERT INTO libraries(id,name,root) VALUES (?,?,?)').run('lib1', '照片', root);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('scan','scan','扫描','queued','manual',100)").run();
    const a = new JobQueue(db, 'same-worker'); const b = new JobQueue(db, 'same-worker');
    const claimA = a.claim(time)!;
    const first = scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root], owner: 'same-worker', jobId: 'scan', jobLeaseToken: claimA.leaseToken, clock: () => time,
      openDir: async (p, options) => { enteredA(); await blockedA; return opendir(p, options); } });
    await startedA; time = 131;
    const claimB = b.claim(time)!;
    const second = scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root], owner: 'same-worker', jobId: 'scan', jobLeaseToken: claimB.leaseToken, clock: () => time,
      openDir: async (p, options) => { enteredB(); await blockedB; return opendir(p, options); } });
    await startedB; releaseA(); await assert.rejects(first, /租约已失效/);
    assert.equal((db.prepare("SELECT count(*) AS n FROM scan_locks WHERE library_id='lib1'").get() as { n: number }).n, 1);
    releaseB(); assert.equal((await second).errors, 0);
  } finally { releaseA(); releaseB(); db.close(); await rm(root, { recursive: true, force: true }); }
});


test('文件先于缺失目录到期时记录文件清理', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-expiry-log-')); const db = openDatabase(':memory:'); let time = 1000;
  try {
    await mkdir(path.join(root, 'sub')); await writeFile(path.join(root, 'sub', 'a.jpg'), 'a');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], clock: () => time });
    await scan(); await unlink(path.join(root, 'sub', 'a.jpg')); time += 1; await scan();
    await rm(path.join(root, 'sub'), { recursive: true }); time += 86400; await scan();
    time += 6 * 86400 + 1; await scan();
    assert.ok(db.prepare("SELECT 1 FROM library_changes WHERE kind='removed' AND path='sub/a.jpg' AND is_dir=0").get());
    assert.ok(db.prepare("SELECT 1 FROM folders WHERE path='lib/sub'").get());
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('其他作业扫描后旧断点重新遍历，避免误标缺失', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-interleaved-scan-')); const db = openDatabase(':memory:');
  try {
    await mkdir(path.join(root, 'sub')); await writeFile(path.join(root, 'root.jpg'), 'a'); await writeFile(path.join(root, 'sub', 'child.jpg'), 'b');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('a','scan','扫描','queued','manual',1)").run();
    new JobQueue(db, 'owner').claim();
    const controller = new AbortController(); const actualRoot = await realpath(root);
    const interrupt: typeof opendir = async (p, options) => { if (String(p) === path.join(actualRoot, 'sub')) { controller.abort(); controller.signal.throwIfAborted(); } return opendir(p, options); };
    await assert.rejects(scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], owner: 'owner', jobId: 'a', signal: controller.signal, openDir: interrupt }));
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], owner: 'owner', jobId: 'a' });
    assert.equal((db.prepare('SELECT count(*) AS n FROM files WHERE missing_at_ms IS NOT NULL').get() as { n: number }).n, 0);
    assert.equal((db.prepare('SELECT count(*) AS n FROM folders WHERE missing_at_ms IS NOT NULL').get() as { n: number }).n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});


test('清理文件提交后目录清理中断时文件删除日志仍然存在', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-cleanup-interrupt-')); const parked = `${root}-parked`; const db = openDatabase(':memory:'); let time = 1000;
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await mkdir(path.join(root, 'sub')); await writeFile(path.join(root, 'sub', 'a.jpg'), 'a');
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], clock: () => time });
    await scan(); await rename(path.join(root, 'sub'), parked); time++; await scan(); time += 7 * 86400 + 1;
    db.exec("CREATE TRIGGER stop_folder_delete BEFORE DELETE ON folders WHEN old.path='lib/sub' BEGIN SELECT RAISE(ABORT,'中断'); END");
    await assert.rejects(scan(), /中断/);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 0);
    assert.ok(db.prepare("SELECT 1 FROM library_changes WHERE kind='removed' AND path='sub' AND is_dir=1").get());
    assert.equal((db.prepare("SELECT count(*) AS n FROM library_changes WHERE kind='removed'").get() as { n: number }).n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(parked, { recursive: true, force: true }); }
});


test('缺失目录先到期时保留仍在宽限期的子项及父目录', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-parent-expiry-')); const parked = `${root}-parked`; const db = openDatabase(':memory:'); let time = 1000;
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await mkdir(path.join(root, 'sub')); await writeFile(path.join(root, 'sub', 'a.jpg'), 'a');
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], clock: () => time }); await scan();
    await rename(path.join(root, 'sub'), parked); time++; await scan();
    db.prepare("UPDATE files SET missing_at_ms=?").run((time + 86400) * 1000);
    time += 7 * 86400 + 1; await scan();
    assert.ok(db.prepare("SELECT 1 FROM files WHERE relative_path='sub/a.jpg'").get());
    assert.ok(db.prepare("SELECT 1 FROM folders WHERE path='lib/sub'").get());
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(parked, { recursive: true, force: true }); }
});


test('同名新目录清理时不复用旧目录的日志去重状态', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-dir-reuse-')); const parked = `${root}-parked`; const db = openDatabase(':memory:'); let time = 1000;
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO scan_expiry_logged(library_id,path) VALUES ('lib','sub')").run();
    await mkdir(path.join(root, 'sub')); await writeFile(path.join(root, 'sub', 'a.jpg'), 'a');
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], clock: () => time }); await scan();
    await rename(path.join(root, 'sub'), parked); time++; await scan(); time += 7 * 86400 + 1; await scan();
    assert.ok(db.prepare("SELECT 1 FROM library_changes WHERE kind='removed' AND path='sub' AND is_dir=1").get());
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(parked, { recursive: true, force: true }); }
});


test('过期目录恢复时同路径旧文件的清理有删除日志', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-expired-return-')); const parked = `${root}-parked`; const db = openDatabase(':memory:'); let time = 1000;
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await mkdir(path.join(root, 'sub')); await writeFile(path.join(root, 'sub', 'a.jpg'), 'a');
    const scan = () => scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], clock: () => time }); await scan();
    const id = (db.prepare('SELECT id FROM files').get() as { id: string }).id;
    await rename(path.join(root, 'sub'), parked); time++; await scan(); time += 7 * 86400 + 1; await rename(parked, path.join(root, 'sub')); await scan();
    assert.ok(db.prepare("SELECT 1 FROM library_changes WHERE kind='removed' AND path='sub/a.jpg' AND media_id=?").get(id));
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(parked, { recursive: true, force: true }); }
});
