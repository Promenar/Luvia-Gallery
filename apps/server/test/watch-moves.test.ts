import { test } from 'node:test';
import assert from 'node:assert/strict';

class TestClock {
  time = 0; next = 0; timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.time;
  setTimeout = (fn: () => void, ms: number) => { const id = ++this.next; this.timers.set(id, { at: this.time + ms, fn }); return id; };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  async advance(ms: number) { const target = this.time + ms; while (true) {
    const first = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!first || first[1].at > target) break;
    this.time = first[1].at; this.timers.delete(first[0]); first[1].fn(); for (let i = 0; i < 8; i++) await Promise.resolve();
  } this.time = target; for (let i = 0; i < 8; i++) await Promise.resolve(); }
}
const item = (p: string, changes: Record<string, unknown> = {}) => ({ path: p, isDir: false, mediaId: 'id1', size: 100, mtimeMs: 123, dev: 1, ino: 9, headHash: 'sha', ...changes });

test('按 inode 和内容头哈希配对移动，目录改名只输出一条', async () => {
  const m = await import('../src/watch/move-matcher.ts'); assert.ok(m, '移动匹配模块尚未实现');
  const clock = new TestClock(); const moved: unknown[] = []; const missing: string[] = []; const added: string[] = [];
  const matcher = new m.MoveMatcher({ clock, onMoved: (from, to) => moved.push([from.path, to.path, from.mediaId, from.isDir]),
    onMissing: (v) => missing.push(v.path), onAdded: (v) => added.push(v.path) });
  matcher.vanished(item('a.jpg')); matcher.appeared(item('b.jpg', { mediaId: null }));
  matcher.appeared(item('d.jpg', { mediaId: null, dev: 2, ino: 20 })); matcher.vanished(item('c.jpg', { dev: 1, ino: 19 }));
  matcher.vanished(item('dir-old', { isDir: true, mediaId: null, dev: 1, ino: 44 }));
  matcher.appeared(item('dir-new', { isDir: true, mediaId: null, dev: 1, ino: 44 }));
  assert.deepEqual(moved, [['a.jpg', 'b.jpg', 'id1', false], ['c.jpg', 'd.jpg', 'id1', false], ['dir-old', 'dir-new', null, true]]);
  await clock.advance(10000); assert.deepEqual(missing, []); assert.deepEqual(added, []);
});

test('未配对的消失和新增在十秒后分别释放；不同摘要不能配对', async () => {
  const m = await import('../src/watch/move-matcher.ts'); assert.ok(m);
  const clock = new TestClock(); const moved: unknown[] = []; const missing: string[] = []; const added: string[] = [];
  const matcher = new m.MoveMatcher({ clock, onMoved: (from, to) => moved.push([from.path, to.path]),
    onMissing: (v) => missing.push(v.path), onAdded: (v) => added.push(v.path) });
  matcher.vanished(item('gone.jpg')); matcher.appeared(item('other.jpg', { ino: 50, headHash: 'different' }));
  await clock.advance(9999); assert.deepEqual(missing, []); await clock.advance(1);
  assert.deepEqual(moved, []); assert.deepEqual(missing, ['gone.jpg']); assert.deepEqual(added, ['other.jpg']);
});
