import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
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
