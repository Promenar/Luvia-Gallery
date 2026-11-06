import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.ts';

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
