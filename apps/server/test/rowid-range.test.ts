import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { rowIdRange } from '../src/core/rowid-range.ts';

test('随机抽样边界正确处理空表和稀疏 rowid', () => {
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE files(value TEXT)');
    assert.deepEqual(rowIdRange(db), { min: null, max: null });
    db.prepare('INSERT INTO files(rowid,value) VALUES (?,?)').run(7, 'a');
    db.prepare('INSERT INTO files(rowid,value) VALUES (?,?)').run(1_000_000_000, 'b');
    assert.deepEqual(rowIdRange(db), { min: 7, max: 1_000_000_000 });
    db.prepare('DELETE FROM files WHERE rowid=7').run();
    assert.deepEqual(rowIdRange(db), { min: 1_000_000_000, max: 1_000_000_000 });
  } finally { db.close(); }
});
