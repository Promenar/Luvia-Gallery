import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    const insert = db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES (?,'lib',?,'lib',?,'image/jpeg','image',?,1,1,'mtime')");
    insert.run('a', 'a.jpg', 'a.jpg', firstContent.length);
    insert.run('b', 'b.jpg', 'b.jpg', Buffer.byteLength('第二张'));
    insert.run('c', 'gone.jpg', 'gone.jpg', 1);
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
