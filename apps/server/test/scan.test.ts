import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink, rm, opendir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { scanLibrary } from '../src/worker/scan.ts';

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
    const cancelled = new AbortController();
    cancelled.abort();
    await assert.rejects(scanLibrary(db, { id: 'lib1', root }, { signal: cancelled.signal, allowedRoots: [root] }));
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 2);
    const complete = await scanLibrary(db, { id: 'lib1', root }, { allowedRoots: [root] });
    assert.equal(complete.removed, 1);
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 1);
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
