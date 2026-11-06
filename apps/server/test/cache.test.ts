import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, readFile, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import Database from 'better-sqlite3';

test('排他写锁下正在等待的后台统计可被中止', async () => {
  const { readCacheUsage } = await import('../src/worker/cache-usage.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-cache-abort-busy-')); const filename = path.join(root, 'db.sqlite');
  const db = openDatabase(filename); db.pragma('journal_mode = DELETE'); const peer = new Database(filename);
  try {
    peer.exec('BEGIN EXCLUSIVE');
    const controller = new AbortController();
    const pending = readCacheUsage(db, controller.signal).then(() => 'success', (error: Error) => error.name);
    await delay(200);
    const start = performance.now(); controller.abort();
    assert.equal(await pending, 'AbortError');
    assert.ok(performance.now() - start < 700, '取消后等待后台统计时间过长');
  } finally { if (peer.inTransaction) peer.exec('ROLLBACK'); peer.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('后台缓存统计保留 SQLite 繁忙错误码', async () => {
  const { readCacheUsage } = await import('../src/worker/cache-usage.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-cache-busy-')); const filename = path.join(root, 'db.sqlite');
  const db = openDatabase(filename); db.pragma('journal_mode = DELETE'); const peer = new Database(filename);
  try {
    peer.exec('BEGIN EXCLUSIVE');
    await assert.rejects(readCacheUsage(db), (error: unknown) => (error as { code?: string }).code === 'SQLITE_BUSY');
  } finally { if (peer.inTransaction) peer.exec('ROLLBACK'); peer.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('缓存调度遇写锁时快速跳过并在下轮恢复', async () => {
  const scheduler = await import('../src/worker/cache-prune-scheduler.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-cache-lock-')); const filename = path.join(root, 'db.sqlite');
  const db = openDatabase(filename); const peer = new Database(filename);
  try {
    db.prepare("INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at) VALUES ('a','a',?,1)").run(25 * 1024 ** 3);
    peer.exec('BEGIN IMMEDIATE');
    const start = performance.now();
    await assert.doesNotReject(scheduler.scheduleCachePrune(db));
    assert.ok(performance.now() - start < 1000, '缓存调度等待写锁过久');
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='cache_prune'").get() as { n: number }).n, 0);
    assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
    peer.exec('ROLLBACK');
    await scheduler.scheduleCachePrune(db);
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='cache_prune'").get() as { n: number }).n, 1);
  } finally { if (peer.inTransaction) peer.exec('ROLLBACK'); peer.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('取消缓存清理时停止后台查询且不删除缓存', async () => {
  const { pruneCache } = await import('../src/worker/cache-prune.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-cache-cancel-')); const db = openDatabase(path.join(root, 'db.sqlite'));
  try {
    await writeFile(path.join(root, 'a'), 'abcd');
    db.prepare("INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at) VALUES ('a','a',4,1)").run();
    const controller = new AbortController();
    const pending = pruneCache(db, root, 0, () => {}, controller.signal);
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    assert.equal(await readFile(path.join(root, 'a'), 'utf8'), 'abcd');
    assert.ok(db.prepare("SELECT 1 FROM cache_entries WHERE cache_key='a'").get());
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('缓存清理调度在后台读取总量，并且同一时间只排一个作业', async () => {
  const scheduler = await import('../src/worker/cache-prune-scheduler.ts').catch(() => null);
  assert.ok(scheduler, '缺少非阻塞缓存清理调度');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-cache-schedule-')); const db = openDatabase(path.join(root, 'cache.sqlite'));
  try {
    db.prepare("INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at) VALUES ('a','a',?,1)").run(25 * 1024 ** 3);
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      assert.doesNotMatch(sql, /sum\s*\(\s*bytes\s*\).*cache_entries/is, '调度不得在主线程统计总量');
      return prepare(sql);
    }) as typeof db.prepare;
    await scheduler.scheduleCachePrune(db);
    await scheduler.scheduleCachePrune(db);
    const row = db.prepare("SELECT count(*) AS n FROM jobs WHERE type='cache_prune' AND status='queued'").get() as { n: number };
    assert.equal(row.n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('缓存低于上限时总量查询不阻塞工作进程数据库连接', async () => {
  const { pruneCache } = await import('../src/worker/cache-prune.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-cache-fast-')); const db = openDatabase(path.join(root, 'cache.sqlite'));
  try {
    db.prepare("INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at) VALUES ('a','a',4,1)").run();
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      assert.doesNotMatch(sql, /sum\s*\(\s*bytes\s*\).*cache_entries/is, '缓存总量读取不得全表扫描');
      return prepare(sql);
    }) as typeof db.prepare;
    assert.deepEqual(await pruneCache(db, root, 8), { removed: 0, bytes: 0 });
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('缓存淘汰按最近访问时间删除，无法越出缓存根目录', async () => {
  const module = await import('../src/worker/cache-prune.ts').catch(() => null);
  assert.ok(module, '缓存淘汰模块尚未实现');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-cache-'));
  const outside = await mkdtemp(path.join(tmpdir(), 'luvia-cache-outside-'));
  const db = openDatabase(':memory:');
  try {
    await mkdir(path.join(root, 'media'));
    await writeFile(path.join(root, 'media', 'older.webp'), '123456');
    await writeFile(path.join(root, 'media', 'newer.webp'), '123456');
    await writeFile(path.join(outside, 'keep.webp'), '123456');
    db.prepare('INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at) VALUES (?,?,?,?),(?,?,?,?)')
      .run('older', 'media/older.webp', 6, 100, 'newer', 'media/newer.webp', 6, 200);
    db.prepare('INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at) VALUES (?,?,?,?)')
      .run('unsafe', `../${path.basename(outside)}/keep.webp`, 6, 1);
    const result = await module.pruneCache(db, root, 6);
    assert.deepEqual(result, { removed: 1, bytes: 6 });
    await assert.rejects(access(path.join(root, 'media', 'older.webp')));
    await access(path.join(root, 'media', 'newer.webp'));
    await access(path.join(outside, 'keep.webp'));
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('清理失效缓存时在持有写事务和媒体锁期间删除文件', async () => {
  const { cleanupDeletedMediaCache } = await import('../src/worker/cache-prune.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-cache-gc-')); const db = openDatabase(':memory:');
  try {
    await writeFile(path.join(root, 'stale.webp'), 'old');
    db.prepare("INSERT INTO cache_gc(cache_key,relative_path) VALUES ('stale','stale.webp')").run();
    let calls = 0;
    await cleanupDeletedMediaCache(db, root, { owner: 'worker', assertLease: () => {
      calls++; if (calls === 4) assert.equal(db.inTransaction, true, '删除前检查应与文件操作处于同一写事务');
    } });
    assert.ok(calls >= 4);
    await assert.rejects(access(path.join(root, 'stale.webp')));
    assert.equal(db.prepare("SELECT 1 FROM cache_gc WHERE cache_key='stale'").get(), undefined);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('缓存重新访问并更新后，淘汰不得删除新文件或保留失效记录', async () => {
  const { pruneCache } = await import('../src/worker/cache-prune.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-cache-access-race-')); const db = openDatabase(':memory:');
  try {
    await mkdir(path.join(root, 'media')); const filename = path.join(root, 'media', 'preview.mp4');
    await writeFile(filename, 'old');
    db.prepare("INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at) VALUES ('preview','media/preview.mp4',3,100)").run();
    let calls = 0;
    await assert.rejects(pruneCache(db, root, 0, () => {
      calls++;
      if (calls === 2) queueMicrotask(() => {
        db.prepare("UPDATE cache_entries SET last_access_at=200 WHERE cache_key='preview'").run();
        writeFileSync(filename, 'new');
      });
      if (calls === 4) throw new Error('停止采样');
    }), /停止采样/);
    assert.equal(await readFile(filename, 'utf8'), 'new');
    assert.equal((db.prepare("SELECT last_access_at FROM cache_entries WHERE cache_key='preview'").get() as { last_access_at: number }).last_access_at, 200);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
