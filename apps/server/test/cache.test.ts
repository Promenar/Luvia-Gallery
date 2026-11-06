import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, readFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';

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
