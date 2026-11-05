import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

class TestClock {
  time = 0;
  next = 0;
  timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.time;
  setTimeout = (fn: () => void, delay: number) => { const id = ++this.next; this.timers.set(id, { at: this.time + delay, fn }); return id; };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  async advance(ms: number) {
    const target = this.time + ms;
    while (true) {
      const first = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > target) break;
      this.time = first[1].at; this.timers.delete(first[0]); first[1].fn();
      for (let i = 0; i < 12; i++) await Promise.resolve();
    }
    this.time = target;
    for (let i = 0; i < 12; i++) await Promise.resolve();
  }
}

test('模式根据网络文件系统和剩余额度选择轮询，保留中文原因', async () => {
  const m = await import('../src/watch/mode.ts'); assert.ok(m, '模式模块尚未实现');
  assert.deepEqual(m.decideWatchMode({ requested: 'auto', fsType: 'cifs', dirCount: 10, quota: 100 }),
    { state: 'polling', degradedReason: '网络文件系统 cifs 不支持实时事件，已改为每 5 分钟对账' });
  assert.equal(m.decideWatchMode({ requested: 'auto', fsType: 'fuse.sshfs', dirCount: 1, quota: 100 }).state, 'polling');
  assert.equal(m.decideWatchMode({ requested: 'auto', fsType: 'zfs', dirCount: 80, quota: 100 }).state, 'watching');
  const low = m.decideWatchMode({ requested: 'watch', fsType: 'btrfs', dirCount: 81, quota: 100 });
  assert.equal(low.state, 'degraded'); assert.match(low.degradedReason!, /80%/); assert.match(low.degradedReason!, /fs\.inotify\.max_user_watches/);
  assert.equal(m.decideWatchMode({ requested: 'poll', fsType: 'cifs', dirCount: 999, quota: 1 }).state, 'polling');
  assert.equal(m.decideWatchMode({ requested: 'off', fsType: 'cifs', dirCount: 999, quota: 1 }).state, 'off');
  if (process.platform !== 'linux') assert.equal(await m.readInotifyQuota(), null);
});

test('目录事件去重、过滤排除目录，并在静默两秒后释放', async () => {
  const m = await import('../src/watch/dirty-queue.ts'); assert.ok(m, '目录队列尚未实现');
  const clock = new TestClock(); const released: string[] = [];
  const q = new m.DirtyQueue({ exclude: ['@eaDir', '.*', 'private/**'], clock, onReady: (dirs) => released.push(...dirs) });
  q.add('album/a.jpg', false); q.add('album/b.jpg', false); q.add('album/@eaDir/a.jpg', false);
  q.add('private/a/b.jpg', false); q.add('.hidden/a.jpg', false); q.add('photos', true);
  await clock.advance(1999); assert.deepEqual(released, []);
  await clock.advance(1); assert.deepEqual(released.sort(), ['album', 'photos']);
});

test('持续写入在十秒强制释放，跨目录共用首个事件期限', async () => {
  const m = await import('../src/watch/dirty-queue.ts'); assert.ok(m);
  const clock = new TestClock(); const released: string[] = [];
  const q = new m.DirtyQueue({ exclude: [], clock, onReady: (dirs) => released.push(...dirs) });
  q.add('a/x.jpg', false);
  for (let i = 0; i < 9; i++) { await clock.advance(1000); q.add('a/x.jpg', false); q.add('b/y.jpg', false); }
  await clock.advance(999); assert.deepEqual(released, []);
  await clock.advance(1); assert.deepEqual(released.sort(), ['a', 'b']);
});

test('目录差异识别变更、消失和新子目录', async () => {
  const m = await import('../src/watch/reconcile-dir.ts'); assert.ok(m, '对账模块尚未实现');
  const indexed = [
    { name: 'old.jpg', isDir: false, size: 1, mtimeMs: 10, dev: 1, ino: 11 },
    { name: 'change.jpg', isDir: false, size: 1, mtimeMs: 10, dev: 1, ino: 12 },
  ];
  const entries = [
    { name: 'change.jpg', isDir: false, size: 2, mtimeMs: 11, dev: 1, ino: 12 },
    { name: 'new.jpg', isDir: false, size: 3, mtimeMs: 12, dev: 1, ino: 13 },
    { name: 'nested', isDir: true, size: 0, mtimeMs: 12, dev: 1, ino: 14 },
  ];
  const diff = m.diffDirectory(entries, indexed);
  assert.deepEqual(diff.added.map((v) => v.name), ['new.jpg', 'nested']);
  assert.deepEqual(diff.changed.map((v) => v.name), ['change.jpg']);
  assert.deepEqual(diff.vanished.map((v) => v.name), ['old.jpg']);
  assert.deepEqual(diff.newSubdirs.map((v) => v.name), ['nested']);
});

test('文件每次变化后重新等待三秒，待定期间消失时不产出', async () => {
  const m = await import('../src/watch/stability.ts'); assert.ok(m, '稳定性模块尚未实现');
  const clock = new TestClock(); const stable: string[] = [];
  const files = new Map([['a.jpg', { size: 1, mtimeMs: 10 }], ['gone.jpg', { size: 1, mtimeMs: 10 }]]);
  const tracker = new m.StabilityTracker({ clock, stat: async (p) => files.get(p) ?? null, onStable: (p) => { stable.push(p); } });
  tracker.track('a.jpg', files.get('a.jpg')!); tracker.track('gone.jpg', files.get('gone.jpg')!);
  await clock.advance(2000); assert.deepEqual(stable, []);
  files.set('a.jpg', { size: 2, mtimeMs: 11 }); files.delete('gone.jpg');
  await clock.advance(1000); assert.deepEqual(stable, []);
  await clock.advance(2999); assert.deepEqual(stable, []);
  await clock.advance(1); assert.deepEqual(stable, ['a.jpg']);
});

test('宽限期支持恢复、到期移除以及零天时下一次对账清理', async () => {
  const m = await import('../src/watch/grace.ts'); assert.ok(m, '宽限期模块尚未实现');
  const day = 86_400_000;
  assert.equal(m.classifyMissing({ missingAt: 100, now: day, missingGraceDays: 2, present: true, nextReconcile: true }), 'restored');
  assert.equal(m.classifyMissing({ missingAt: 100, now: 2 * day + 101, missingGraceDays: 2, present: false, nextReconcile: true }), 'removed');
  assert.equal(m.classifyMissing({ missingAt: 100, now: 100, missingGraceDays: 0, present: false, nextReconcile: false }), 'pending');
  assert.equal(m.classifyMissing({ missingAt: 100, now: 101, missingGraceDays: 0, present: false, nextReconcile: true }), 'removed');
});

test('根目录不可读或挂载消失时不可用，恢复触发全量对账', async () => {
  const m = await import('../src/watch/root-guard.ts'); assert.ok(m, '根目录保护模块尚未实现');
  let readable = true; let mount = 'mount-1';
  const guard = new m.RootGuard({ root: '/media/lib', probe: async () => readable, mount: async () => mount });
  assert.deepEqual(await guard.check(), { state: 'available', needsFullReconcile: false });
  readable = false; assert.equal((await guard.check()).state, 'unavailable');
  readable = true; assert.deepEqual(await guard.check(), { state: 'available', needsFullReconcile: true });
  mount = 'parent'; assert.equal((await guard.check()).state, 'unavailable');
  mount = 'mount-1'; assert.deepEqual(await guard.check(), { state: 'available', needsFullReconcile: true });
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-watch-guard-'));
  try { await mkdir(path.join(root, 'lib')); const real = new m.RootGuard({ root: path.join(root, 'lib') });
    assert.equal((await real.check()).state, 'available'); await rm(path.join(root, 'lib'), { recursive: true });
    assert.equal((await real.check()).state, 'unavailable'); await writeFile(path.join(root, 'lib'), 'file');
    assert.equal((await real.check()).state, 'unavailable');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('变更通知按媒体库节流并压缩完整路径段前缀', async () => {
  const m = await import('../src/watch/throttle.ts'); assert.ok(m, '通知节流模块尚未实现');
  const clock = new TestClock(); const events: unknown[] = [];
  const t = new m.ChangeThrottle({ libraryId: 'lib', clock, publish: (event) => events.push(event) });
  t.add({ source: 'watch', folders: ['lib/a/b', 'lib/a', 'lib/abc'], added: 1 });
  t.add({ source: 'watch', folders: ['lib/a/c'], moved: 1 });
  await clock.advance(1999); assert.deepEqual(events, []); await clock.advance(1);
  assert.deepEqual(events, [{ libraryId: 'lib', source: 'watch', folders: ['lib/a', 'lib/abc'], added: 1, removed: 0, updated: 0, moved: 1 }]);
  t.add({ source: 'watch', folders: ['lib/a'], updated: 2 }); await clock.advance(1999); assert.equal(events.length, 1);
  await clock.advance(1); assert.equal(events.length, 2);
});
