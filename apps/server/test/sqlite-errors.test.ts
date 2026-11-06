import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/core/database.ts';
import { renewLease } from '../src/core/sqlite-errors.ts';

test('续租遇到数据库暂时繁忙时跳过而不中止，租约被收回或其它错误时中止', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-lease-')); const filename = path.join(root, 'luvia.db');
  const db = openDatabase(filename); const other = new Database(filename);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS leases(id TEXT PRIMARY KEY, expires INTEGER)'); db.prepare("INSERT INTO leases VALUES ('a', 1)").run();
    db.pragma('busy_timeout = 0');
    const renew = () => db.prepare("UPDATE leases SET expires=expires+1 WHERE id='a'").run().changes > 0;
    let aborted = 0; const abort = () => { aborted++; };
    // 另一连接（例如截断 WAL 的检查点线程）占住写锁，续租抛出 SQLITE_BUSY
    other.exec('BEGIN IMMEDIATE');
    assert.throws(renew, { code: 'SQLITE_BUSY' });
    renewLease(renew, abort);
    assert.equal(aborted, 0);
    other.exec('COMMIT');
    renewLease(renew, abort);
    assert.equal(aborted, 0);
    assert.equal(db.prepare("SELECT expires FROM leases WHERE id='a'").pluck().get(), 2);
    renewLease(() => false, abort);
    assert.equal(aborted, 1);
    renewLease(() => { throw new Error('作业租约已失效'); }, abort);
    assert.equal(aborted, 2);
  } finally { if (other.inTransaction) other.exec('ROLLBACK'); other.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});
