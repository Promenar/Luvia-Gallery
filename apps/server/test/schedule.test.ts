import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { writeSettings } from '../src/core/settings.ts';

test('间隔扫描按设置排队，仅启用的媒体库参与且多个 worker 不重复排队', async () => {
  const module = await import('../src/worker/schedule.ts').catch(() => null);
  assert.ok(module, '扫描调度尚未实现');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-schedule-'));
  const first = openDatabase(path.join(root, 'db.sqlite')); const second = openDatabase(path.join(root, 'db.sqlite'));
  try {
    first.prepare("INSERT INTO libraries(id,name,root,enabled) VALUES ('on','启用','/on',1),('off','禁用','/off',0)").run();
    assert.equal(module.scheduleScans(first, 1000), 0);
    writeSettings(first, { scan: { mode: 'interval', intervalMinutes: 15, dailyAt: '04:00' } });
    assert.equal(module.scheduleScans(first, 1000), 1);
    assert.equal(module.scheduleScans(second, 1000), 0);
    const active = first.prepare("SELECT id,payload FROM jobs WHERE type='scan' AND status='queued'").get() as { id: string; payload: string };
    assert.equal(JSON.parse(active.payload).libraryId, 'on');
    first.prepare("UPDATE jobs SET status='succeeded' WHERE id=?").run(active.id);
    assert.equal(module.scheduleScans(second, 1899), 0);
    assert.equal(module.scheduleScans(first, 1900), 1);
    assert.equal(module.scheduleScans(second, 1900), 0);
    writeSettings(first, { scan: { mode: 'manual', intervalMinutes: 15, dailyAt: '04:00' } });
    assert.equal(module.scheduleScans(second, 2800), 0);
  } finally { first.close(); second.close(); await rm(root, { recursive: true, force: true }); }
});
