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
    writeSettings(first, { scan: { mode: 'manual', intervalMinutes: 60, dailyAt: '04:00' } });
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

test('每日扫描采用服务器本地时间，多 worker 每日只排队一次，错过多日只补一次', async () => {
  const { scheduleScans } = await import('../src/worker/schedule.ts');
  const { readSettings } = await import('../src/core/settings.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-daily-'));
  const first = openDatabase(path.join(root, 'db.sqlite')); const second = openDatabase(path.join(root, 'db.sqlite'));
  const at = (day: number, hour: number, minute = 0) => Math.floor(new Date(2026, 0, day, hour, minute).getTime() / 1000);
  try {
    first.prepare("INSERT INTO libraries(id,name,root,enabled) VALUES ('on','启用','/on',1)").run();
    assert.deepEqual(readSettings(first).scan, { mode: 'daily', intervalMinutes: 60, dailyAt: '04:00' });
    assert.equal(scheduleScans(first, at(1, 3, 59)), 0);
    assert.equal(scheduleScans(first, at(1, 4)), 1);
    assert.equal(scheduleScans(second, at(1, 4)), 0);
    first.prepare("UPDATE jobs SET status='succeeded'").run();
    assert.equal(scheduleScans(second, at(5, 5)), 1);
    assert.equal(scheduleScans(first, at(5, 5)), 0);
    first.prepare("UPDATE jobs SET status='succeeded'").run();
    assert.equal(scheduleScans(first, at(6, 3, 59)), 0);
    assert.equal(scheduleScans(second, at(6, 4)), 1);
  } finally { first.close(); second.close(); await rm(root, { recursive: true, force: true }); }
});
