import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/core/database.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { generateMediaCache } from '../src/worker/media-cache.ts';
import { cachePath } from '../src/core/media-cache.ts';

test('旧媒体锁持有者在提交前被接管，不能覆盖新持有者的缓存文件', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-cache-source-')); const cache = await mkdtemp(path.join(tmpdir(), 'luvia-cache-output-'));
  const db = openDatabase(':memory:');
  try {
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#789' } }).jpeg().toFile(path.join(root, 'photo.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare('UPDATE files SET width=64,height=48').run();
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const variant = { kind: 'thumb', size: 's' } as const; const destination = cachePath(cache, row, variant);
    db.prepare("INSERT INTO media_generation_locks(cache_key,owner,lease_token,lease_expires_at) VALUES ('key','old','old-token',0)").run();
    let outsideChecks = 0;
    const assertLease = () => {
      if (!(db.prepare("SELECT 1 FROM media_generation_locks WHERE cache_key='key' AND owner='old' AND lease_token='old-token'").get())) throw new Error('锁已接管');
      if (!db.inTransaction && ++outsideChecks === 2) queueMicrotask(() => {
        db.prepare("UPDATE media_generation_locks SET owner='new',lease_token='new-token' WHERE cache_key='key'").run();
        writeFileSync(destination, 'new-owner');
      });
    };
    await assert.rejects(generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant },
      { owner: 'old', cacheDir: cache, allowedRoots: [root], assertLease }), /锁已接管/);
    assert.equal(await readFile(destination, 'utf8'), 'new-owner');
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('缓存最终提交前收到停止信号时不发布文件', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-abort-source-')); const cache = await mkdtemp(path.join(tmpdir(), 'luvia-abort-cache-'));
  const db = openDatabase(':memory:'); const controller = new AbortController();
  try {
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#789' } }).jpeg().toFile(path.join(root, 'photo.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] }); db.prepare('UPDATE files SET width=64,height=48').run();
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const variant = { kind: 'thumb', size: 's' } as const; let checks = 0;
    await assert.rejects(generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant },
      { owner: 'worker', cacheDir: cache, allowedRoots: [root], signal: controller.signal,
        assertLease: () => { if (!db.inTransaction && ++checks === 2) queueMicrotask(() => controller.abort()); } }));
    await assert.rejects(access(cachePath(cache, row, variant)));
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
