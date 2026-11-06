import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../src/core/database.ts';
import { startWalCheckpointer } from '../src/worker/wal-checkpoint.ts';

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
