import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink, rm, opendir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { JobQueue } from '../src/core/jobs.ts';

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
