import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('虚拟监控器传递事件、错误与溢出，停止后忽略注入', async () => {
  const m = await import('../src/watch/watcher.ts'); assert.ok(m, '监控器尚未实现');
  const seen: string[] = []; const watcher = new m.FakeWatcher();
  watcher.start({ onEvent: (event) => seen.push(`${event.eventType}:${event.path}`), onError: (error) => seen.push(error.message), onOverflow: () => seen.push('overflow') });
  watcher.emit({ eventType: 'rename', path: 'a/b.jpg' }); watcher.fail(new Error('broken')); watcher.overflow();
  watcher.stop(); watcher.emit({ eventType: 'change', path: 'ignored' });
  assert.deepEqual(seen, ['rename:a/b.jpg', 'broken', 'overflow']);
});

test('非 Linux 下不伪造已建立的监视数', async () => {
  const m = await import('../src/watch/watcher.ts'); assert.ok(m);
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-watcher-'));
  try {
    const watcher = new m.NodeFsWatcher(root); watcher.start({ onEvent: () => {}, onError: () => {}, onOverflow: () => {} });
    if (process.platform !== 'linux') assert.equal(await watcher.watchedCount(), null);
    else assert.ok((await watcher.watchedCount())! >= 1);
    watcher.stop();
  } finally { await rm(root, { recursive: true, force: true }); }
});
