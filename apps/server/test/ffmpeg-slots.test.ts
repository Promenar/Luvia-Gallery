import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../src/core/database.ts';
import { writeSettings } from '../src/core/settings.ts';

test('多个 worker 共享 FFmpeg 槽位上限，等待可取消且不会抢占有效租约', async () => {
  const module = await import('../src/worker/ffmpeg-slots.ts').catch(() => null);
  assert.ok(module, 'FFmpeg 全局槽位尚未实现');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-ffmpeg-slots-'));
  const first = openDatabase(path.join(dir, 'db.sqlite')); const second = openDatabase(path.join(dir, 'db.sqlite'));
  try {
    writeSettings(first, { workers: { thumbnailConcurrency: 4, ffmpegConcurrency: 1 } });
    let active = 0; let maximum = 0; let started = 0;
    const operation = async () => { active++; started++; maximum = Math.max(maximum, active); await delay(150); active--; };
    const a = module.withFfmpegSlot(first, 'a', operation);
    await delay(20);
    const b = module.withFfmpegSlot(second, 'b', operation);
    await delay(50);
    assert.equal(started, 1); assert.equal((second.prepare('SELECT count(*) AS n FROM ffmpeg_slots').get() as { n: number }).n, 1);
    const abort = new AbortController();
    const waiting = module.withFfmpegSlot(second, 'c', operation, { signal: abort.signal });
    abort.abort(); await assert.rejects(waiting);
    await Promise.all([a, b]);
    assert.equal(maximum, 1); assert.equal(started, 2);
    assert.equal((first.prepare('SELECT count(*) AS n FROM ffmpeg_slots').get() as { n: number }).n, 0);
    first.prepare("INSERT INTO ffmpeg_slots(id,owner,lease_expires_at) VALUES ('stale','crashed',0)").run();
    await module.withFfmpegSlot(second, 'recovered', async () => { assert.equal((second.prepare("SELECT count(*) AS n FROM ffmpeg_slots WHERE id='stale'").get() as { n: number }).n, 0); });
  } finally { first.close(); second.close(); await rm(dir, { recursive: true, force: true }); }
});

test('取消 FFmpeg 执行会停止进程并释放共享槽位', async () => {
  const { runFfmpeg } = await import('../src/worker/ffmpeg-slots.ts');
  const db = openDatabase(':memory:'); const abort = new AbortController();
  try {
    const running = runFfmpeg(db, 'worker', ['-re', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=10', '-t', '30', '-f', 'null', '-'], { signal: abort.signal, timeoutMs: 5000 });
    await delay(100); abort.abort();
    await assert.rejects(running);
    assert.equal((db.prepare('SELECT count(*) AS n FROM ffmpeg_slots').get() as { n: number }).n, 0);
  } finally { db.close(); }
});

test('缩略图槽位按设置限制多个 worker 的并发', async () => {
  const { withThumbnailSlot } = await import('../src/worker/ffmpeg-slots.ts');
  const db = openDatabase(':memory:');
  try {
    writeSettings(db, { workers: { thumbnailConcurrency: 1, ffmpegConcurrency: 2 } });
    let active = 0; let peak = 0;
    const run = () => withThumbnailSlot(db, 'worker', async () => { active++; peak = Math.max(peak, active); await delay(60); active--; });
    await Promise.all([run(), run(), run()]);
    assert.equal(peak, 1);
    assert.equal((db.prepare("SELECT count(*) AS n FROM ffmpeg_slots WHERE kind='thumbnail'").get() as { n: number }).n, 0);
  } finally { db.close(); }
});
