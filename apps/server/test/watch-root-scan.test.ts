import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { scanLibrary } from '../src/worker/scan.ts';

test('扫描期间挂载身份不符不会标记既有文件缺失，修改根目录会重置身份', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-scan-root-')); const root = path.join(dir, 'media'); await mkdir(root);
  const db = openDatabase(path.join(dir, 'db.sqlite'));
  try {
    await writeFile(path.join(root, 'a.jpg'), 'a');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare("UPDATE library_watch_state SET mount_root=?,mount_identity='original',mount_attempted=1 WHERE library_id='lib'").run(root);
    await rm(path.join(root, 'a.jpg'));
    await assert.rejects(scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], mount: async () => 'fallback' }), /挂载/);
    assert.equal((db.prepare('SELECT missing_at_ms FROM files').get() as {missing_at_ms:number|null}).missing_at_ms, null);
    db.prepare("UPDATE libraries SET root=? WHERE id='lib'").run(`${root}-new`);
    assert.deepEqual(db.prepare("SELECT mount_root,mount_identity,mount_attempted FROM library_watch_state WHERE library_id='lib'").get(), {mount_root:null,mount_identity:null,mount_attempted:0});
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('挂载来源改变但文件内容一致时自动接纳新身份', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-mount-change-')); const root = path.join(dir, 'media'); await mkdir(root);
  const db = openDatabase(path.join(dir, 'db.sqlite'));
  try {
    await writeFile(path.join(root, 'a.jpg'), 'photo');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], mount: async () => 'usb-a' });
    const original = db.prepare('SELECT id FROM files').get();
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], mount: async () => 'usb-b' });
    assert.deepEqual(db.prepare('SELECT id FROM files').get(), original);
    assert.equal((db.prepare('SELECT mount_identity FROM library_watch_state').get() as { mount_identity: string }).mount_identity, 'usb-b');
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('升级前索引缺少毫秒修改时间时，首次确认按秒级修改时间接纳挂载且不阻塞扫描', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-legacy-mount-')); const root = path.join(dir, 'media'); await mkdir(root);
  const db = openDatabase(path.join(dir, 'db.sqlite'));
  try {
    for (const name of ['a.jpg', 'b.jpg', 'c.jpg']) await writeFile(path.join(root, name), name);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], mount: async () => 'nas' });
    const before = db.prepare('SELECT id FROM files ORDER BY id').all();
    // 模拟升级前的库：尚未回填毫秒时间，也没有记录挂载身份。
    db.prepare('UPDATE files SET mtime_ms=NULL').run();
    db.prepare("DELETE FROM library_watch_state WHERE library_id='lib'").run();
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], mount: async () => 'nas' });
    assert.equal((db.prepare('SELECT mount_identity FROM library_watch_state').get() as { mount_identity: string }).mount_identity, 'nas');
    assert.deepEqual(db.prepare('SELECT id FROM files WHERE missing_at_ms IS NULL ORDER BY id').all(), before);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('监控关闭的已有库在挂载点为空时拒绝扫描，恢复后保留媒体身份', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-off-mount-')); const root = path.join(dir, 'media'); await mkdir(root);
  const db = openDatabase(path.join(dir, 'db.sqlite'));
  try {
    await writeFile(path.join(root, 'a.jpg'), 'photo');
    db.prepare("INSERT INTO libraries(id,name,root,watch_mode) VALUES ('lib','照片',?,'off')").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], mount: async () => 'nas' });
    const original = db.prepare('SELECT id FROM files').get() as { id: string };
    db.prepare("DELETE FROM library_watch_state WHERE library_id='lib'").run();
    await rename(path.join(root, 'a.jpg'), path.join(dir, 'saved.jpg'));
    await assert.rejects(scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], mount: async () => 'empty' }), /挂载/);
    assert.equal((db.prepare('SELECT missing_at_ms FROM files').get() as { missing_at_ms: number | null }).missing_at_ms, null);
    assert.equal(db.prepare("SELECT mount_root FROM library_watch_state WHERE library_id='lib' AND mount_root IS NOT NULL").get(), undefined);
    assert.equal((db.prepare("SELECT state FROM library_watch_state WHERE library_id='lib'").get() as {state:string}).state, 'degraded');
    await rename(path.join(dir, 'saved.jpg'), path.join(root, 'a.jpg'));
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], mount: async () => 'nas' });
    assert.deepEqual(db.prepare('SELECT id,missing_at_ms FROM files').get(), { id: original.id, missing_at_ms: null });
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});
