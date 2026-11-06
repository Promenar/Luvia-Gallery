import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../src/core/database.ts';
import Database from 'better-sqlite3';
import { startWalCheckpointer, waitForWalCapacity } from '../src/worker/wal-checkpoint.ts';

test('写连接不在提交时自动检查点，由后台线程把 WAL 写回主库', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-wal-')); const filename = path.join(root, 'luvia.db');
  const db = openDatabase(filename);
  try {
    assert.equal(db.pragma('wal_autocheckpoint', { simple: true }), 0);
    db.exec('CREATE TABLE IF NOT EXISTS sample(id INTEGER PRIMARY KEY, value BLOB)');
    const insert = db.prepare('INSERT INTO sample(value) VALUES (randomblob(8192))');
    // 远超默认 1000 页的自动检查点阈值，主库文件仍不增长
    db.transaction(() => { for (let i = 0; i < 1500; i++) insert.run(); })();
    const before = (await stat(filename)).size;
    assert.ok((await stat(`${filename}-wal`)).size > 8192 * 1500);
    const stop = startWalCheckpointer(filename, { intervalMs: 20 });
    try {
      for (let i = 0; i < 250 && (await stat(filename)).size <= before + 8192 * 1000; i++) await delay(20);
      assert.ok((await stat(filename)).size > before + 8192 * 1000);
    } finally { await stop(); }
    assert.equal((db.prepare('SELECT count(*) AS n FROM sample').get() as { n: number }).n, 1500);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('WAL 积压时后台作业让路，读者结束、写回追平后截断 WAL 并恢复', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-wal-')); const filename = path.join(root, 'luvia.db');
  const db = openDatabase(filename); const reader = new Database(filename, { readonly: true });
  try {
    db.exec('CREATE TABLE IF NOT EXISTS sample(id INTEGER PRIMARY KEY, value BLOB)');
    // 读事务在写入前开始，写回只能停在它的快照之前，WAL 无法截断
    reader.exec('BEGIN'); reader.prepare('SELECT count(*) FROM sample').get();
    const insert = db.prepare('INSERT INTO sample(value) VALUES (randomblob(8192))');
    db.transaction(() => { for (let i = 0; i < 1500; i++) insert.run(); })();
    const stop = startWalCheckpointer(filename, { intervalMs: 20, truncateFrames: 256, pressureFrames: 1024 });
    try {
      let waited = 0;
      for (let i = 0; i < 50 && waited < 150; i++) { const started = Date.now(); await waitForWalCapacity(undefined, 200); waited = Date.now() - started; if (waited < 150) await delay(20); }
      assert.ok(waited >= 150, '积压时应等待');
      reader.exec('COMMIT');
      for (let i = 0; i < 250 && (await stat(`${filename}-wal`)).size > 0; i++) await delay(20);
      assert.equal((await stat(`${filename}-wal`)).size, 0);
      const started = Date.now(); await waitForWalCapacity(undefined, 5000);
      assert.ok(Date.now() - started < 200, '截断后不再等待');
    } finally { await stop(); }
    assert.equal((db.prepare('SELECT count(*) AS n FROM sample').get() as { n: number }).n, 1500);
  } finally { reader.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});
