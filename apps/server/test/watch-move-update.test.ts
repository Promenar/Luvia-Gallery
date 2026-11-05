import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, link, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WatchCoordinator } from '../src/watch/coordinator.ts';
import { FakeWatcher } from '../src/watch/watcher.ts';
import { sqliteHarness } from './watch-sqlite-harness.ts';

class TestClock {
  time = 0; next = 0; timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.time;
  setTimeout = (fn: () => void, ms: number) => { const id = ++this.next; this.timers.set(id, { at: this.time + ms, fn }); return id; };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  async advance(ms: number, idle: () => Promise<void>) {
    const target = this.time + ms;
    while (true) {
      const first = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > target) break;
      this.time = first[1].at; this.timers.delete(first[0]); first[1].fn();
      for (let i = 0; i < 12; i++) await Promise.resolve(); await idle();
    }
    this.time = target; for (let i = 0; i < 12; i++) await Promise.resolve(); await idle();
  }
}

test('临时新增媒体更新后与原文件配对，保留身份、收藏及相册', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-move-update-')); const clock = new TestClock(); const watcher = new FakeWatcher();
  const port = sqliteHarness(root, clock); const coordinator = new WatchCoordinator({ libraryId: 'lib', root, exclude: [], port, clock, watcher, missingGraceDays: 7 });
  const advance = (ms: number) => clock.advance(ms, () => coordinator.idle());
  try {
    await writeFile(path.join(root, 'old.jpg'), 'initial'); await coordinator.start(); await coordinator.reconcileDirectory(''); await advance(13_000);
    const original = port.records.get('old.jpg')?.mediaId; assert.ok(original);
    port.testDb.prepare("INSERT INTO users(id,username,password_hash,role,preferences,created_at) VALUES ('u','u','x','user','{}',0)").run();
    port.testDb.prepare("INSERT INTO favorites(user_id,item_id,item_type) VALUES ('u',?,'file')").run(original);
    port.testDb.prepare("INSERT INTO albums(id,user_id,name,kind,created_at,updated_at) VALUES ('a','u','相册','manual',0,0)").run();
    port.testDb.prepare("INSERT INTO album_items(album_id,file_id,created_at) VALUES ('a',?,0)").run(original);
    await link(path.join(root, 'old.jpg'), path.join(root, 'new.jpg'));
    watcher.emit({ eventType: 'rename', path: 'new.jpg' }); await coordinator.idle(); await advance(5000);
    const temporary = port.records.get('new.jpg')?.mediaId; assert.ok(temporary); assert.notEqual(temporary, original);
    await writeFile(path.join(root, 'new.jpg'), 'metadata changed');
    watcher.emit({ eventType: 'change', path: 'new.jpg' }); await coordinator.idle(); await advance(5000);
    await unlink(path.join(root, 'old.jpg')); watcher.emit({ eventType: 'rename', path: 'old.jpg' }); await coordinator.idle(); await advance(2000);
    assert.equal(port.records.get('new.jpg')?.mediaId, original); assert.equal(port.records.has('old.jpg'), false);
    assert.ok(port.testDb.prepare("SELECT 1 FROM favorites WHERE item_id=?").get(original));
    assert.ok(port.testDb.prepare("SELECT 1 FROM album_items WHERE file_id=?").get(original));
    assert.equal(port.testDb.prepare('SELECT 1 FROM files WHERE id=?').get(temporary), undefined);
  } finally { await coordinator.stop(); port.close(); await rm(root, { recursive: true, force: true }); }
});

test('消失项早于修改稳定时重新配对并保留原身份', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-move-race-')); const clock = new TestClock(); const watcher = new FakeWatcher();
  const port = sqliteHarness(root, clock); const coordinator = new WatchCoordinator({ libraryId: 'lib', root, exclude: [], port, clock, watcher, missingGraceDays: 7 });
  const advance = (ms: number) => clock.advance(ms, () => coordinator.idle());
  try {
    await writeFile(path.join(root, 'old.jpg'), 'initial'); await coordinator.start(); await coordinator.reconcileDirectory(''); await advance(13_000);
    const original = port.records.get('old.jpg')?.mediaId; assert.ok(original);
    await link(path.join(root, 'old.jpg'), path.join(root, 'new.jpg'));
    watcher.emit({ eventType: 'rename', path: 'new.jpg' }); await coordinator.idle(); await advance(5000);
    await writeFile(path.join(root, 'new.jpg'), 'metadata changed'); await unlink(path.join(root, 'old.jpg'));
    watcher.emit({ eventType: 'change', path: 'new.jpg' }); watcher.emit({ eventType: 'rename', path: 'old.jpg' });
    await coordinator.idle(); await advance(5000);
    assert.equal(port.records.get('new.jpg')?.mediaId, original); assert.equal(port.records.has('old.jpg'), false);
  } finally { await coordinator.stop(); port.close(); await rm(root, { recursive: true, force: true }); }
});
