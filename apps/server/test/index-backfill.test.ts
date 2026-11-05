import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';

test('存量回填按批保存断点，重启后续跑并统计读取失败', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-index-backfill-'));
  const filename = path.join(dir, 'db.sqlite');
  let db = openDatabase(filename);
  try {
    const firstContent = Buffer.concat([Buffer.alloc(65_536, 0x61), Buffer.from('尾部')]);
    await writeFile(path.join(dir, 'a.jpg'), firstContent);
    await writeFile(path.join(dir, 'b.jpg'), '第二张');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(dir);
    const insert = db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES (?,'lib',?,'lib',?,'image/jpeg','image',?,?,1,'mtime')");
    insert.run('a', 'a.jpg', 'a.jpg', firstContent.length, Math.floor((await stat(path.join(dir, 'a.jpg'))).mtimeMs / 1000));
    insert.run('b', 'b.jpg', 'b.jpg', Buffer.byteLength('第二张'), Math.floor((await stat(path.join(dir, 'b.jpg'))).mtimeMs / 1000));
    insert.run('c', 'gone.jpg', 'gone.jpg', 1, 1);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='index_backfill'").get(), '缺少自动排队的存量回填作业');
    const { processIndexBackfillBatch } = await import('../src/worker/index-backfill.ts');
    assert.equal(await processIndexBackfillBatch(db, { allowedRoots: [dir], batchSize: 1 }), false);
    const first = db.prepare("SELECT dev,ino,mtime_ms,head_hash FROM files WHERE id='a'").get() as { dev: string; ino: string; mtime_ms: number; head_hash: string };
    assert.match(first.dev, /^\d+$/); assert.match(first.ino, /^\d+$/); assert.ok(first.mtime_ms > 0);
    assert.equal(first.head_hash, createHash('sha256').update(Buffer.alloc(65_536, 0x61)).digest('hex'));
    db.close(); db = openDatabase(filename);
    assert.equal(await processIndexBackfillBatch(db, { allowedRoots: [dir], batchSize: 1 }), false);
    assert.equal(await processIndexBackfillBatch(db, { allowedRoots: [dir], batchSize: 1 }), false);
    assert.equal(await processIndexBackfillBatch(db, { allowedRoots: [dir], batchSize: 1 }), true);
    assert.deepEqual(db.prepare('SELECT processed,errors,complete FROM index_backfill').get(), { processed: 2, errors: 1, complete: 1 });
    assert.equal((db.prepare("SELECT head_hash FROM files WHERE id='b'").get() as { head_hash: string }).head_hash, createHash('sha256').update('第二张').digest('hex'));
  } finally { if (db.open) db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('回填发现文件与已索引修改时间不符时不写入身份或摘要', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-index-stale-')); const db = openDatabase(':memory:');
  try {
    await writeFile(path.join(dir, 'a.jpg'), 'same');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(dir);
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES ('a','lib','a.jpg','lib','a.jpg','image/jpeg','image',4,1,1,'mtime')").run();
    const { processIndexBackfillBatch } = await import('../src/worker/index-backfill.ts');
    assert.equal(await processIndexBackfillBatch(db, { allowedRoots: [dir], batchSize: 10 }), true);
    assert.deepEqual(db.prepare("SELECT dev,ino,mtime_ms,head_hash FROM files WHERE id='a'").get(), { dev: null, ino: null, mtime_ms: null, head_hash: null });
    assert.deepEqual(db.prepare('SELECT processed,errors FROM index_backfill').get(), { processed: 0, errors: 1 });
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('回填不会把同一秒内发生变化的文件身份写入旧索引', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-index-subsecond-')); const db = openDatabase(':memory:');
  try {
    const filename = path.join(dir, 'a.jpg'); const base = 1_700_000_000;
    await writeFile(filename, 'same'); await utimes(filename, base + 0.9, base + 0.9);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(dir);
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,mtime_ms) VALUES ('a','lib','a.jpg','lib','a.jpg','image/jpeg','image',4,?,1,'mtime',?)").run(base, base * 1000 + 100);
    const { processIndexBackfillBatch } = await import('../src/worker/index-backfill.ts');
    await processIndexBackfillBatch(db, { allowedRoots: [dir] });
    assert.deepEqual(db.prepare("SELECT dev,ino,head_hash FROM files WHERE id='a'").get(), { dev: null, ino: null, head_hash: null });
    assert.equal((db.prepare('SELECT errors FROM index_backfill').get() as { errors: number }).errors, 1);
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});
