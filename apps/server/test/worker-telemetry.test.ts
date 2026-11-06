import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.ts';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('其他进程持有写锁时心跳快速跳过，锁释放后恢复写入', async () => {
  const { writeWorkerHeartbeat } = await import('../src/worker/telemetry.ts');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-heartbeat-lock-')); const filename = path.join(dir, 'db.sqlite');
  const db = openDatabase(filename); const peer = new Database(filename);
  try {
    peer.exec('BEGIN IMMEDIATE');
    const start = performance.now();
    assert.doesNotThrow(() => writeWorkerHeartbeat(db, 20, 100));
    assert.ok(performance.now() - start < 1000, '心跳等待数据库写锁过久');
    assert.equal(db.pragma('busy_timeout', { simple: true }), 5000);
    peer.exec('ROLLBACK');
    writeWorkerHeartbeat(db, 20, 101);
    const row = db.prepare("SELECT value FROM settings WHERE key='worker.heartbeat'").get() as { value: string };
    assert.equal(JSON.parse(row.value).at, 101);
  } finally { if (peer.inTransaction) peer.exec('ROLLBACK'); peer.close(); db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('工作进程心跳记录内存分类及事件循环状态', async () => {
  const module = await import('../src/worker/telemetry.ts').catch(() => null);
  assert.ok(module, '工作进程内存遥测尚未实现');
  const db = openDatabase(':memory:');
  try {
    const memory = { rss: 1000, heapTotal: 500, heapUsed: 300, external: 200, arrayBuffers: 100 };
    const sharp = { queue: 4, process: 3 };
    module.writeWorkerHeartbeat(db, 75, 1234, memory, sharp);
    const row = db.prepare("SELECT value FROM settings WHERE key='worker.heartbeat'").get() as { value: string };
    assert.deepEqual(JSON.parse(row.value), { at: 1234, healthy: false, eventLoopP99Ms: 75, memory, sharp });
    module.writeWorkerHeartbeat(db, 5, 1235, memory);
    const updated = db.prepare("SELECT value FROM settings WHERE key='worker.heartbeat'").get() as { value: string };
    assert.equal(JSON.parse(updated.value).healthy, true);
  } finally { db.close(); }
});
