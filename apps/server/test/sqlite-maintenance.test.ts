import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runSqliteMaintenance } from '../src/worker/sqlite-maintenance.ts';

test('SQLite 维护不等待活跃读取者，读取结束后可截断 WAL', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-maintenance-')); const filename = path.join(root, 'fixture.db');
  const writer = new Database(filename); const reader = new Database(filename);
  try {
    writer.pragma('journal_mode=WAL'); writer.pragma('wal_autocheckpoint=0');
    writer.exec('CREATE TABLE example(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO example(value) VALUES (\'first\')');
    reader.exec('BEGIN'); reader.prepare('SELECT * FROM example').all();
    writer.prepare("INSERT INTO example(value) VALUES ('second')").run();
    const started = Date.now(); const busy = await runSqliteMaintenance(filename);
    assert.equal(busy.busy, 1); assert.ok(Date.now() - started < 3000);
    reader.exec('COMMIT');
    const complete = await runSqliteMaintenance(filename);
    assert.equal(complete.busy, 0);
    assert.equal((await stat(`${filename}-wal`)).size, 0);
    assert.equal((writer.prepare('SELECT count(*) AS n FROM example').get() as { n: number }).n, 2);
  } finally { if (reader.inTransaction) reader.exec('ROLLBACK'); reader.close(); writer.close(); await rm(root, { recursive: true, force: true }); }
});
