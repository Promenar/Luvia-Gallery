import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LibraryChangedEvent } from '@luvia/contracts';
import { WatchCoordinator } from '../src/watch/coordinator.ts';
import type { IndexedRecord, LibraryIndexPort, WatchLibraryChange } from '../src/watch/coordinator.ts';
import type { MoveCandidate } from '../src/watch/move-matcher.ts';
import { NodeFsWatcher } from '../src/watch/watcher.ts';
import type { PathEvent, WatchHandlers, Watcher } from '../src/watch/watcher.ts';

class Clock {
  time = 0; next = 0; timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.time;
  setTimeout = (fn: () => void, ms: number) => { const id = ++this.next; this.timers.set(id, { at: this.time + ms, fn }); return id; };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  async advance(ms: number, idle: () => Promise<void>) {
    const target = this.time + ms;
    while (true) { const first = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!first || first[1].at > target) break;
      this.time = first[1].at; this.timers.delete(first[0]); first[1].fn(); for (let i = 0; i < 12; i++) await Promise.resolve(); await idle(); }
    this.time = target; for (let i = 0; i < 12; i++) await Promise.resolve(); await idle();
  }
}
class Index implements LibraryIndexPort {
  rows = new Map<string, IndexedRecord>(); changes: WatchLibraryChange[] = []; next = 0;
  async readDirectory(dir: string) { return [...this.rows.values()].filter((v) => (path.posix.dirname(v.path) === '.' ? '' : path.posix.dirname(v.path)) === dir); }
  async findMissingCandidates(_entry: MoveCandidate) { return [...this.rows.values()].filter((v) => v.missingAt !== null); }
  async writeAdded(entry: MoveCandidate) { const id = entry.isDir ? null : `id-${++this.next}`; this.rows.set(entry.path, { ...entry, mediaId: id, missingAt: null }); return id; }
  async writeUpdated(old: IndexedRecord, entry: MoveCandidate) { this.rows.set(entry.path, { ...entry, mediaId: old.mediaId, missingAt: null }); }
  async writeMoved(old: IndexedRecord, entry: MoveCandidate) { this.move(old, entry); return 0; }
  async readSubdirectories(dir: string) { return [...this.rows.values()].filter((row) => row.isDir && row.path.startsWith(`${dir}/`)).map((row) => row.path); }
  async writeMissing(old: IndexedRecord, at: number) { let count = 0; for (const row of this.rows.values()) if (row.path === old.path || (old.isDir && row.path.startsWith(`${old.path}/`))) { if (!row.isDir && row.missingAt === null) count++; row.missingAt = at; } return count; }
  async writeRestored(old: IndexedRecord, entry: MoveCandidate) { this.move(old, entry); return 0; }
  async writeRemoved(old: IndexedRecord) { for (const p of this.rows.keys()) if (p === old.path || (old.isDir && p.startsWith(`${old.path}/`))) this.rows.delete(p); }
  async appendChange(change: WatchLibraryChange) { this.changes.push(change); }
  async requestFullReconcile(_reason: string) {}
  async publishEvent(_event: LibraryChangedEvent) {}
  private move(old: IndexedRecord, entry: MoveCandidate) {
    for (const [p, row] of [...this.rows]) if (p === old.path || (old.isDir && p.startsWith(`${old.path}/`))) {
      this.rows.delete(p); const next = entry.path + p.slice(old.path.length);
      this.rows.set(next, p === old.path ? { ...entry, mediaId: old.mediaId, missingAt: null } : { ...row, path: next });
    }
  }
}
class RecordingWatcher implements Watcher {
  readonly events: PathEvent[] = [];
  private readonly inner: NodeFsWatcher;
  constructor(root: string) { this.inner = new NodeFsWatcher(root); }
  start(handlers: WatchHandlers) { this.inner.start({ ...handlers, onEvent: (event) => { this.events.push(event); handlers.onEvent(event); } }); }
  stop() { this.inner.stop(); }
  watchedCount() { return this.inner.watchedCount(); }
}
async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const end = Date.now() + 10_000;
  while (!(await predicate())) { if (Date.now() >= end) throw new Error('等待 Linux 文件系统监视事件超时'); await new Promise((resolve) => setTimeout(resolve, 25)); }
}

test('Linux 递归监视捕获多层新目录写入、跨目录移动、改名与删除', { skip: process.platform !== 'linux', timeout: 60_000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-watch-linux-')); const clock = new Clock(); const port = new Index(); const watcher = new RecordingWatcher(root);
  const coordinator = new WatchCoordinator({ libraryId: 'lib', root, exclude: [], port, watcher, clock, missingGraceDays: 7 });
  const advance = (ms: number) => clock.advance(ms, () => coordinator.idle());
  try {
    await coordinator.start();
    await mkdir(path.join(root, 'one/two'), { recursive: true }); await writeFile(path.join(root, 'one/two/a.jpg'), 'created immediately');
    await waitUntil(() => watcher.events.some((event) => event.path === 'one'));
    await coordinator.idle(); await advance(2000); await advance(13000);
    const id = port.rows.get('one/two/a.jpg')?.mediaId; assert.ok(id);
    await waitUntil(async () => (await watcher.watchedCount() ?? 0) >= 3);
    const beforeMove = watcher.events.length; await rename(path.join(root, 'one/two/a.jpg'), path.join(root, 'b.jpg'));
    await waitUntil(() => watcher.events.slice(beforeMove).some((event) => event.path === 'b.jpg') && watcher.events.slice(beforeMove).some((event) => event.path === 'one/two/a.jpg'));
    await coordinator.idle(); await advance(2000); await advance(3000); assert.equal(port.rows.get('b.jpg')?.mediaId, id);
    const beforeRename = watcher.events.length; await rename(path.join(root, 'b.jpg'), path.join(root, 'c.jpg'));
    await waitUntil(() => watcher.events.slice(beforeRename).some((event) => event.path === 'c.jpg'));
    await coordinator.idle(); await advance(2000); await advance(3000); assert.equal(port.rows.get('c.jpg')?.mediaId, id);
    const beforeDelete = watcher.events.length; await rm(path.join(root, 'c.jpg'));
    await waitUntil(() => watcher.events.slice(beforeDelete).some((event) => event.path === 'c.jpg'));
    await coordinator.idle(); await advance(2000); await advance(10000);
    assert.equal(typeof port.rows.get('c.jpg')?.missingAt, 'number'); assert.ok(port.changes.some((change) => change.kind === 'missing' && change.path === 'c.jpg'));
  } finally { await coordinator.stop(); await rm(root, { recursive: true, force: true }); }
});
