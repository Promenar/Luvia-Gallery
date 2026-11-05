import { test as nodeTest } from 'node:test';
import { AsyncLocalStorage } from 'node:async_hooks';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, rm, stat, writeFile, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LibraryChangedEvent } from '@luvia/contracts';
import type { IndexedRecord, LibraryIndexPort, WatchLibraryChange } from '../src/watch/coordinator.ts';
import type { MoveCandidate } from '../src/watch/move-matcher.ts';
import { FakeWatcher } from '../src/watch/watcher.ts';
import { sqliteHarness } from './watch-sqlite-harness.ts';

const backend = new AsyncLocalStorage<'memory' | 'sqlite'>();
function test(name: string, run: () => Promise<void>): void {
  for (const kind of ['memory', 'sqlite'] as const) nodeTest(`${name} [${kind}]`, () => backend.run(kind, run));
}

class TestClock {
  time = 0; next = 0; timers = new Map<number, { at: number; fn: () => void }>();
  now = () => this.time;
  setTimeout = (fn: () => void, ms: number) => { const id = ++this.next; this.timers.set(id, { at: this.time + ms, fn }); return id; };
  clearTimeout = (id: unknown) => { this.timers.delete(id as number); };
  async advance(ms: number, idle: () => Promise<void>) {
    const target = this.time + ms;
    while (true) {
      const first = [...this.timers].sort((a, b) => a[1].at - b[1].at)[0]; if (!first || first[1].at > target) break;
      this.time = first[1].at; this.timers.delete(first[0]); first[1].fn();
      for (let i = 0; i < 12; i++) await Promise.resolve(); await idle();
    }
    this.time = target; for (let i = 0; i < 12; i++) await Promise.resolve(); await idle();
  }
}
class MemoryIndex implements LibraryIndexPort {
  records = new Map<string, IndexedRecord>(); events: LibraryChangedEvent[] = []; changes: WatchLibraryChange[] = []; requests: string[] = []; nextId = 0;
  async readDirectory(dir: string) { return [...this.records.values()].filter((v) => { const parent = path.posix.dirname(v.path); return (parent === '.' ? '' : parent) === dir; }).map((v) => ({ ...v })); }
  async readSubdirectories(dir: string) { return [...this.records.values()].filter((v) => v.isDir && v.path.startsWith(`${dir}/`)).map((v) => v.path); }
  async findMissingCandidates(_candidate: MoveCandidate) { return [...this.records.values()].filter((v) => v.missingAt !== null).map((v) => ({ ...v })); }
  async writeAdded(entry: MoveCandidate) { const id = entry.isDir ? null : `media-${++this.nextId}`; this.records.set(entry.path, { ...entry, mediaId: id, missingAt: null }); return id; }
  async writeUpdated(old: IndexedRecord, entry: MoveCandidate) { this.records.set(entry.path, { ...entry, mediaId: old.mediaId, missingAt: null }); }
  async writeMoved(old: IndexedRecord, entry: MoveCandidate) { if (entry.mediaId) this.records.delete(entry.path); this.relocate(old, entry); return 0; }
  async writeMissing(old: IndexedRecord, at: number) { let count = 0; for (const value of this.records.values()) if (value.path === old.path || (old.isDir && value.path.startsWith(`${old.path}/`))) { if (!value.isDir && value.missingAt === null) count++; value.missingAt = at; } return count; }
  async writeRestored(old: IndexedRecord, entry: MoveCandidate) { if (entry.mediaId) this.records.delete(entry.path); this.relocate(old, entry); return 0; }
  async writeRemoved(old: IndexedRecord) { for (const p of this.records.keys()) if (p === old.path || (old.isDir && p.startsWith(`${old.path}/`))) this.records.delete(p); }
  async appendChange(change: WatchLibraryChange) { this.changes.push(change); }
  async requestFullReconcile(reason: string) { this.requests.push(reason); }
  async publishEvent(event: LibraryChangedEvent) { this.events.push(event); }
  close() {}
  private relocate(old: IndexedRecord, entry: MoveCandidate) {
    for (const [p, value] of [...this.records]) if (p === old.path || (old.isDir && p.startsWith(`${old.path}/`))) {
      const next = entry.path + p.slice(old.path.length); this.records.delete(p);
      this.records.set(next, p === old.path ? { ...entry, mediaId: old.mediaId, missingAt: null } : { ...value, path: next });
    }
  }
}
function makeIndex(root: string, clock: TestClock) { return backend.getStore() === 'sqlite' ? sqliteHarness(root, clock) : new MemoryIndex(); }

async function setup() {
  const m = await import('../src/watch/coordinator.ts'); assert.ok(m, '协调器尚未实现');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-watch-core-')); const clock = new TestClock();
  const watcher = new FakeWatcher(); const port = makeIndex(root, clock);
  const coordinator = new m.WatchCoordinator({ libraryId: 'lib', root, exclude: ['@eaDir', '.*'], watcher, port, clock, missingGraceDays: 7 });
  await coordinator.start(); const advance = (ms: number) => clock.advance(ms, () => coordinator.idle());
  return { root, clock, watcher, port, coordinator, advance };
}

test('协调器新增文件稳定后写入和推送，移动保留 ID，删除转为 missing', async () => {
  const s = await setup();
  try {
    await writeFile(path.join(s.root, 'a.jpg'), 'photo'); s.watcher.emit({ eventType: 'rename', path: 'a.jpg' }); await s.coordinator.idle();
    await s.advance(2000); await s.advance(2999); assert.equal(s.port.records.size, 0);
    await s.advance(1); await s.advance(10000); const id = s.port.records.get('a.jpg')?.mediaId; assert.ok(id);
    await s.advance(2000); assert.equal(s.port.events.at(-1)?.added, 1);
    await rename(path.join(s.root, 'a.jpg'), path.join(s.root, 'b.jpg'));
    s.watcher.emit({ eventType: 'rename', path: 'a.jpg' }); s.watcher.emit({ eventType: 'rename', path: 'b.jpg' }); await s.coordinator.idle();
    await s.advance(2000); await s.advance(3000);
    assert.equal(s.port.records.get('b.jpg')?.mediaId, id); assert.equal(s.port.records.has('a.jpg'), false);
    assert.ok(s.port.changes.some((v) => v.kind === 'moved' && v.path === 'b.jpg' && v.fromPath === 'a.jpg'));
    await rm(path.join(s.root, 'b.jpg')); s.watcher.emit({ eventType: 'rename', path: 'b.jpg' }); await s.coordinator.idle();
    await s.advance(2000); await s.advance(10000);
    assert.equal(typeof s.port.records.get('b.jpg')?.missingAt, 'number'); assert.ok(s.port.changes.some((v) => v.kind === 'missing' && v.path === 'b.jpg'));
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); }
});

test('监视错误、溢出、根目录恢复各自请求全量对账；不可用时不标记缺失', async () => {
  const s = await setup();
  try {
    await writeFile(path.join(s.root, 'a.jpg'), 'a'); await s.coordinator.reconcileDirectory(''); await s.advance(3000); await s.advance(10000);
    s.watcher.overflow(); s.watcher.fail(new Error('watch failed')); await s.coordinator.idle();
    assert.ok(s.port.requests.includes('overflow')); assert.ok(s.port.requests.includes('watch-error'));
    await rename(s.root, `${s.root}-away`); await s.coordinator.reconcileDirectory('');
    assert.equal(s.port.records.get('a.jpg')?.missingAt, null); assert.equal(s.port.changes.filter((v) => v.kind === 'missing').length, 0);
    await rename(`${s.root}-away`, s.root); await s.coordinator.checkRoot();
    assert.ok(s.port.requests.includes('root-recovered'));
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); await rm(`${s.root}-away`, { recursive: true, force: true }); }
});

test('同一媒体库的目录对账串行运行', async () => {
  const s = await setup();
  try {
    await mkdir(path.join(s.root, 'a')); await mkdir(path.join(s.root, 'b'));
    const original = s.port.readDirectory.bind(s.port); let running = 0; let peak = 0; let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; }); let entered!: () => void;
    const enteredFirst = new Promise<void>((resolve) => { entered = resolve; }); let first = true;
    s.port.readDirectory = async (dir) => { running++; peak = Math.max(peak, running); if (first) { first = false; entered(); await blocked; } const result = await original(dir); running--; return result; };
    const a = s.coordinator.reconcileDirectory('a'); const b = s.coordinator.reconcileDirectory('b');
    await enteredFirst; try { assert.equal(peak, 1); } finally { release(); } await Promise.all([a, b]); assert.equal(peak, 1);
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); }
});

test('停止等待中的对账后清除新登记的全部定时器', async () => {
  const s = await setup();
  let release!: () => void; const blocked = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void; const ready = new Promise<void>((resolve) => { entered = resolve; });
  const original = s.port.readDirectory.bind(s.port);
  s.port.readDirectory = async (dir) => { entered(); await blocked; return original(dir); };
  try {
    await writeFile(path.join(s.root, 'a.jpg'), 'a');
    const work = s.coordinator.reconcileDirectory(''); await ready;
    const stopping = s.coordinator.stop(); release(); await work; await stopping;
    assert.equal(s.clock.timers.size, 0);
  } finally { release(); await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); }
});

test('移动窗口到期后的宽限期恢复保留 ID，过期记录在后续对账清理', async () => {
  const s = await setup();
  try {
    await writeFile(path.join(s.root, 'a.jpg'), 'a'); await s.coordinator.reconcileDirectory(''); await s.advance(3000); await s.advance(10000);
    const id = s.port.records.get('a.jpg')?.mediaId; assert.ok(id);
    await rename(path.join(s.root, 'a.jpg'), `${s.root}-parked.jpg`); await s.coordinator.reconcileDirectory(''); await s.advance(10000);
    assert.equal(typeof s.port.records.get('a.jpg')?.missingAt, 'number');
    await rename(`${s.root}-parked.jpg`, path.join(s.root, 'b.jpg')); await s.coordinator.reconcileDirectory(''); await s.advance(3000);
    assert.equal(s.port.records.get('b.jpg')?.mediaId, id); assert.ok(s.port.changes.some((v) => v.kind === 'restored'));
    await rm(path.join(s.root, 'b.jpg')); await s.coordinator.reconcileDirectory(''); await s.advance(10000);
    await s.advance(7 * 86_400_000 + 1); await s.coordinator.reconcileDirectory('');
    assert.equal(s.port.records.has('b.jpg'), false); assert.ok(s.port.changes.some((v) => v.kind === 'removed'));
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); }
});

test('新建多层目录立即扫描，目录改名只记录目录级移动并保留子文件 ID', async () => {
  const s = await setup();
  try {
    await mkdir(path.join(s.root, 'album/a/b'), { recursive: true });
    await writeFile(path.join(s.root, 'album/a/b/pic.jpg'), 'one');
    s.watcher.emit({ eventType: 'rename', path: 'album' }); await s.coordinator.idle();
    await s.advance(2000); await s.advance(3000); await s.advance(10000);
    const id = s.port.records.get('album/a/b/pic.jpg')?.mediaId; assert.ok(id);
    await rename(path.join(s.root, 'album'), path.join(s.root, 'vacay'));
    s.watcher.emit({ eventType: 'rename', path: 'album' }); s.watcher.emit({ eventType: 'rename', path: 'vacay' }); await s.coordinator.idle();
    await s.advance(2000); await s.advance(13000);
    assert.equal(s.port.records.get('vacay/a/b/pic.jpg')?.mediaId, id);
    assert.deepEqual(s.port.changes.filter((v) => v.kind === 'moved').map((v) => [v.fromPath, v.path, v.isDir]), [['album', 'vacay', true]]);
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); }
});

nodeTest('新目录中文件稳定后目录统计与完整扫描一致', async () => {
  const { WatchCoordinator } = await import('../src/watch/coordinator.ts');
  const { scanLibrary } = await import('../src/worker/scan.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-watch-new-folder-')); const clock = new TestClock();
  const port = sqliteHarness(root, clock); const watcher = new FakeWatcher();
  const coordinator = new WatchCoordinator({ libraryId: 'lib', root, exclude: [], watcher, port, clock, missingGraceDays: 7 });
  try {
    await coordinator.start(); await mkdir(path.join(root, 'trip')); await writeFile(path.join(root, 'trip/a.jpg'), 'photo');
    watcher.emit({ eventType: 'rename', path: 'trip' }); await coordinator.idle();
    await clock.advance(2000, () => coordinator.idle()); await clock.advance(3000, () => coordinator.idle());
    assert.ok(port.records.get('trip/a.jpg'));
    port.testDb.prepare("UPDATE files SET thumb_ready=1 WHERE relative_path='trip/a.jpg'").run();
    const file = port.records.get('trip/a.jpg')!;
    await port.writeUpdated(file, file);
    await port.appendChange({ ts: new Date(clock.now()).toISOString(), kind: 'updated', path: file.path, fromPath: null, isDir: false, mediaId: file.mediaId, source: 'watch' });
    const query = () => port.testDb.prepare('SELECT path,parent,direct_media_count,media_count,child_count,cover_file_id,latest_at FROM folders ORDER BY path').all();
    const realtime = query();
    assert.equal((realtime[1] as { cover_file_id: string }).cover_file_id, file.mediaId);
    await scanLibrary(port.testDb, { id: 'lib', root }, { allowedRoots: [root] });
    assert.deepEqual(realtime, query());
  } finally { await coordinator.stop(); port.close(); await rm(root, { recursive: true, force: true }); }
});

nodeTest('目标目录先写入子媒体后配对目录移动，保留原媒体 ID', async () => {
  const { WatchCoordinator } = await import('../src/watch/coordinator.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-watch-dir-move-')); const clock = new TestClock();
  const port = sqliteHarness(root, clock); const watcher = new FakeWatcher();
  const coordinator = new WatchCoordinator({ libraryId: 'lib', root, exclude: [], watcher, port, clock, missingGraceDays: 7 });
  const advance = (ms: number) => clock.advance(ms, () => coordinator.idle());
  try {
    await mkdir(path.join(root, 'a')); await mkdir(path.join(root, 'b')); await mkdir(path.join(root, 'a/trip'));
    await writeFile(path.join(root, 'a/trip/pic.jpg'), 'photo');
    await coordinator.start(); await coordinator.reconcileDirectory('', 'watch'); await advance(13_000);
    const id = port.records.get('a/trip/pic.jpg')?.mediaId; assert.ok(id);
    await rename(path.join(root, 'a/trip'), path.join(root, 'b/trip'));
    watcher.emit({ eventType: 'rename', path: 'b/trip' }); await coordinator.idle(); await advance(5000);
    assert.ok(port.records.get('b/trip/pic.jpg'));
    watcher.emit({ eventType: 'rename', path: 'a/trip' }); await coordinator.idle(); await advance(2000);
    assert.equal(port.records.get('b/trip/pic.jpg')?.mediaId, id);
    assert.equal(port.records.has('a/trip/pic.jpg'), false);
    assert.equal(port.events.reduce((sum, event) => sum + event.added - event.removed, 0), 1);
  } finally { await coordinator.stop(); port.close(); await rm(root, { recursive: true, force: true }); }
});

nodeTest('相同拍摄时间的目录封面在实时刷新与全量扫描间一致', async () => {
  const { WatchCoordinator } = await import('../src/watch/coordinator.ts');
  const { scanLibrary } = await import('../src/worker/scan.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-watch-cover-')); const clock = new TestClock();
  const port = sqliteHarness(root, clock); const coordinator = new WatchCoordinator({ libraryId: 'lib', root, exclude: [], port, clock, missingGraceDays: 7, watcher: new FakeWatcher() });
  try {
    await mkdir(path.join(root, 'a')); await mkdir(path.join(root, 'b'));
    await writeFile(path.join(root, 'a/a.jpg'), 'a'); await writeFile(path.join(root, 'b/b.jpg'), 'b');
    await coordinator.start(); await coordinator.reconcileDirectory(''); await clock.advance(3000, () => coordinator.idle());
    port.testDb.prepare("UPDATE files SET id='z',taken_at=100,thumb_ready=1 WHERE relative_path='a/a.jpg'").run();
    port.testDb.prepare("UPDATE files SET id='a',taken_at=100,thumb_ready=1 WHERE relative_path='b/b.jpg'").run();
    for (const name of ['a/a.jpg', 'b/b.jpg']) {
      const file = port.records.get(name)!; await port.writeUpdated(file, file);
      await port.appendChange({ ts: new Date(clock.now()).toISOString(), kind: 'updated', path: name, fromPath: null, isDir: false, mediaId: file.mediaId, source: 'watch' });
    }
    const query = () => port.testDb.prepare('SELECT path,cover_file_id,latest_at FROM folders ORDER BY path').all();
    const realtime = query(); assert.equal((realtime[0] as {cover_file_id:string}).cover_file_id, 'a');
    await scanLibrary(port.testDb, { id: 'lib', root }, { allowedRoots: [root] });
    assert.deepEqual(query(), realtime);
  } finally { await coordinator.stop(); port.close(); await rm(root, { recursive: true, force: true }); }
});

test('目录消失进入宽限期后以新路径恢复，保留全部子孙的 ID', async () => {
  const s = await setup(); const parked = `${s.root}-parked`;
  try {
    await mkdir(path.join(s.root, 'album')); await writeFile(path.join(s.root, 'album/pic.jpg'), 'one');
    await s.coordinator.reconcileDirectory(''); await s.advance(3000); await s.advance(10000);
    const id = s.port.records.get('album/pic.jpg')?.mediaId; assert.ok(id);
    await rename(path.join(s.root, 'album'), parked); await s.coordinator.reconcileDirectory(''); await s.advance(10000);
    assert.equal(typeof s.port.records.get('album')?.missingAt, 'number');
    await rename(parked, path.join(s.root, 'restored')); await s.coordinator.reconcileDirectory(''); await s.advance(13000);
    assert.equal(s.port.records.get('restored/pic.jpg')?.mediaId, id);
    assert.ok(s.port.changes.some((v) => v.kind === 'restored' && v.path === 'restored' && v.isDir));
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); await rm(parked, { recursive: true, force: true }); }
});

test('等待配对期间根目录不可用时不标记缺失，恢复时请求全量对账', async () => {
  const s = await setup();
  try {
    await writeFile(path.join(s.root, 'a.jpg'), 'a'); await s.coordinator.reconcileDirectory(''); await s.advance(13000);
    await rm(path.join(s.root, 'a.jpg')); await s.coordinator.reconcileDirectory(''); await s.advance(5000);
    await rename(s.root, `${s.root}-away`); await s.advance(5000);
    assert.equal(s.port.records.get('a.jpg')?.missingAt, null);
    await rename(`${s.root}-away`, s.root); await s.coordinator.checkRoot(); assert.ok(s.port.requests.includes('root-recovered'));
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); await rm(`${s.root}-away`, { recursive: true, force: true }); }
});

test('自动模式在网络文件系统按配置周期请求轮询，全程不启动监视器', async () => {
  const m = await import('../src/watch/coordinator.ts'); const root = await mkdtemp(path.join(tmpdir(), 'luvia-watch-poll-'));
  const clock = new TestClock(); const watcher = new FakeWatcher(); const port = makeIndex(root, clock);
  const coordinator = new m.WatchCoordinator({ libraryId: 'lib', root, exclude: [], watcher, port, clock, missingGraceDays: 7, fsType: 'cifs', pollIntervalSec: 60 });
  try {
    await coordinator.start(); assert.equal((await coordinator.status()).state, 'polling'); assert.ok(port.requests.includes('startup'));
    watcher.overflow(); await coordinator.idle(); assert.equal(port.requests.includes('overflow'), false);
    await clock.advance(60_000, () => coordinator.idle()); assert.ok(port.requests.includes('poll'));
  } finally { await coordinator.stop(); port.close(); await rm(root, { recursive: true, force: true }); }
});

test('启动时根目录不可用，恢复监视后不再周期请求全量扫描', async () => {
  const { WatchCoordinator } = await import('../src/watch/coordinator.ts');
  const { RootGuard } = await import('../src/watch/root-guard.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-poll-recovery-')); const clock = new TestClock();
  const watcher = new FakeWatcher(); const port = makeIndex(root, clock); let available = false;
  const guard = new RootGuard({ root, probe: async () => available, mount: async () => null });
  const coordinator = new WatchCoordinator({ libraryId: 'lib', root, exclude: [], watcher, port, clock, guard, missingGraceDays: 7, pollIntervalSec: 60 });
  try {
    await coordinator.start(); available = true; await coordinator.checkRoot();
    assert.equal((await coordinator.status()).state, 'watching');
    await clock.advance(120_000, () => coordinator.idle());
    assert.equal(port.requests.includes('poll'), false);
  } finally { await coordinator.stop(); port.close(); await rm(root, { recursive: true, force: true }); }
});

test('零天宽限期在标记缺失后的下一次对账清理', async () => {
  const m = await import('../src/watch/coordinator.ts'); const root = await mkdtemp(path.join(tmpdir(), 'luvia-watch-zero-'));
  const clock = new TestClock(); const watcher = new FakeWatcher(); const port = makeIndex(root, clock);
  const coordinator = new m.WatchCoordinator({ libraryId: 'lib', root, exclude: [], watcher, port, clock, missingGraceDays: 0 });
  const advance = (ms: number) => clock.advance(ms, () => coordinator.idle());
  try {
    await coordinator.start(); await writeFile(path.join(root, 'a.jpg'), 'a'); await coordinator.reconcileDirectory(''); await advance(13000);
    await rm(path.join(root, 'a.jpg')); await coordinator.reconcileDirectory(''); await advance(10000);
    assert.equal(typeof port.records.get('a.jpg')?.missingAt, 'number');
    await coordinator.reconcileDirectory(''); assert.equal(port.records.has('a.jpg'), false);
  } finally { await coordinator.stop(); port.close(); await rm(root, { recursive: true, force: true }); }
});

test('排除目录不被递归索引；现有文件变更稳定后才更新', async () => {
  const s = await setup();
  try {
    await mkdir(path.join(s.root, '@eaDir')); await writeFile(path.join(s.root, '@eaDir/ignore.jpg'), 'excluded');
    await writeFile(path.join(s.root, 'a.jpg'), 'original'); await s.coordinator.reconcileDirectory(''); await s.advance(13000);
    assert.equal(s.port.records.has('@eaDir'), false); assert.equal(s.port.records.has('@eaDir/ignore.jpg'), false);
    await writeFile(path.join(s.root, 'a.jpg'), 'larger changed content');
    s.watcher.emit({ eventType: 'change', path: 'a.jpg' }); await s.coordinator.idle(); await s.advance(2000); await s.advance(2999);
    assert.equal(s.port.changes.filter((c) => c.kind === 'updated').length, 0);
    await s.advance(1); assert.equal(s.port.changes.filter((c) => c.kind === 'updated').length, 1);
    assert.equal(s.port.records.get('a.jpg')?.size, 22);
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); }
});

test('设备或 inode 改变时，协调器按已缓存头部哈希保留移动文件的 ID', async () => {
  const s = await setup();
  try {
    await writeFile(path.join(s.root, 'a.jpg'), 'same-content'); await s.coordinator.reconcileDirectory(''); await s.advance(13000);
    const old = s.port.records.get('a.jpg')!; assert.ok(old.headHash); old.dev = -1; old.ino = -1;
    await rename(path.join(s.root, 'a.jpg'), path.join(s.root, 'b.jpg')); await s.coordinator.reconcileDirectory(''); await s.advance(3000);
    assert.equal(s.port.records.get('b.jpg')?.mediaId, old.mediaId); assert.equal(s.port.records.has('a.jpg'), false);
    assert.ok(s.port.changes.some((c) => c.kind === 'moved' && c.fromPath === 'a.jpg' && c.path === 'b.jpg'));
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); }
});

test('实时待配对 inode 命中优先于历史缺失文件的相同内容哈希', async () => {
  const s = await setup();
  try {
    await writeFile(path.join(s.root, 'a.jpg'), 'duplicate-content'); await s.coordinator.reconcileDirectory(''); await s.advance(13000);
    const original = s.port.records.get('a.jpg')!; assert.ok(original.headHash);
    s.port.records.set('ghost.jpg', { ...original, path: 'ghost.jpg', dev: -1, ino: -1, mediaId: 'other-media', missingAt: 1 });
    await rename(path.join(s.root, 'a.jpg'), path.join(s.root, 'c.jpg')); await s.coordinator.reconcileDirectory(''); await s.advance(3000);
    assert.equal(s.port.records.get('c.jpg')?.mediaId, original.mediaId);
    assert.equal(s.port.records.get('ghost.jpg')?.mediaId, 'other-media');
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); }
});

test('缺失目录在原路径恢复时递归发现离线期间新增的文件', async () => {
  const s = await setup(); const parked = `${s.root}-parked`;
  try {
    await mkdir(path.join(s.root, 'album/nested'), { recursive: true }); await writeFile(path.join(s.root, 'album/nested/old.jpg'), 'old');
    await s.coordinator.reconcileDirectory(''); await s.advance(13000);
    const id = s.port.records.get('album/nested/old.jpg')?.mediaId; assert.ok(id);
    await rename(path.join(s.root, 'album'), parked); await s.coordinator.reconcileDirectory(''); await s.advance(10000);
    await writeFile(path.join(parked, 'nested/new.jpg'), 'new'); await rename(parked, path.join(s.root, 'album'));
    await s.coordinator.reconcileDirectory('');
    assert.equal(typeof s.port.records.get('album/nested/old.jpg')?.missingAt, 'number');
    await s.advance(3000); assert.equal(s.port.records.get('album/nested/old.jpg')?.missingAt, null); await s.advance(10000);
    assert.equal(s.port.records.get('album/nested/old.jpg')?.mediaId, id); assert.ok(s.port.records.get('album/nested/new.jpg')?.mediaId);
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); await rm(parked, { recursive: true, force: true }); }
});

test('新增候选等待期间出现持久化缺失记录时，释放前仍能恢复原媒体 ID', async () => {
  const s = await setup();
  try {
    await writeFile(path.join(s.root, 'new.jpg'), 'same'); await s.coordinator.reconcileDirectory(''); await s.advance(3000);
    const info = await stat(path.join(s.root, 'new.jpg'));
    s.port.records.set('old.jpg', { path: 'old.jpg', isDir: false, mediaId: 'prior-id', size: info.size,
      mtimeMs: info.mtimeMs, dev: info.dev, ino: info.ino, headHash: null, missingAt: s.clock.now() });
    await s.advance(10000);
    assert.equal(s.port.records.get('new.jpg')?.mediaId, 'prior-id'); assert.equal(s.port.records.has('old.jpg'), false);
    assert.ok(s.port.changes.some((change) => change.kind === 'restored' && change.path === 'new.jpg'));
    const totals = s.port.events.reduce((sum, event) => ({ added: sum.added + event.added, removed: sum.removed + event.removed }), { added: 0, removed: 0 });
    assert.deepEqual(totals, { added: 1, removed: 0 });
    assert.ok(s.port.events.every((event) => event.added >= 0));
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); }
});


test('新增文件七秒内通知，随后出现的消失项合并为移动并保留原 ID', async () => {
  const s = await setup();
  try {
    await writeFile(path.join(s.root, 'old.jpg'), 'photo');
    s.watcher.emit({ eventType: 'rename', path: 'old.jpg' }); await s.coordinator.idle();
    await s.advance(4999); assert.equal(s.port.events.length, 0);
    await s.advance(1);
    const original = s.port.records.get('old.jpg')?.mediaId; assert.ok(original);
    assert.equal(s.port.events.at(-1)?.added, 1);
    if ('testDb' in s.port) {
      s.port.testDb.prepare("INSERT INTO users(id,username,password_hash,role,preferences,created_at) VALUES ('u','u','x','user','{}',0)").run();
      s.port.testDb.prepare("INSERT INTO favorites(user_id,item_id,item_type) VALUES ('u',?,'file')").run(original);
    }
    await s.advance(10000);
    await link(path.join(s.root, 'old.jpg'), path.join(s.root, 'new.jpg'));
    s.watcher.emit({ eventType: 'rename', path: 'new.jpg' }); await s.coordinator.idle();
    await s.advance(7000);
    const temporary = s.port.records.get('new.jpg')?.mediaId; assert.ok(temporary); assert.notEqual(temporary, original);
    await rm(path.join(s.root, 'old.jpg'));
    s.watcher.emit({ eventType: 'rename', path: 'old.jpg' }); await s.coordinator.idle();
    await s.advance(2000); await s.advance(2000);
    assert.equal(s.port.records.get('new.jpg')?.mediaId, original); assert.equal(s.port.records.has('old.jpg'), false);
    const moved = s.port.events.at(-1); assert.equal(moved?.moved, 1); assert.equal(moved?.added, 0); assert.equal(moved?.removed, 1);
    const net = s.port.events.reduce((sum, event) => sum + event.added - event.removed, 0);
    assert.equal(net, 1);
    if ('testDb' in s.port) {
      assert.equal((s.port.testDb.prepare("SELECT count(*) n FROM favorites WHERE item_id=?").get(original) as { n: number }).n, 1);
      assert.equal((s.port.testDb.prepare("SELECT count(*) n FROM files WHERE id=?").get(temporary) as { n: number }).n, 0);
    }
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); }
});

test('空目录新增、移动和缺失不增加媒体事件计数', async () => {
  const s = await setup();
  try {
    await mkdir(path.join(s.root, 'empty')); await s.coordinator.reconcileDirectory(''); await s.advance(10_000);
    await rename(path.join(s.root, 'empty'), path.join(s.root, 'renamed')); await s.coordinator.reconcileDirectory(''); await s.advance(10_000);
    await rm(path.join(s.root, 'renamed'), { recursive: true }); await s.coordinator.reconcileDirectory(''); await s.advance(12_000);
    for (const event of s.port.events) assert.deepEqual([event.added, event.removed, event.updated, event.moved], [0, 0, 0, 0]);
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); }
});

test('目录整体缺失与恢复时媒体事件净计数匹配可见文件', async () => {
  const s = await setup(); const parked = `${s.root}-parked`;
  try {
    await mkdir(path.join(s.root, 'trip')); await writeFile(path.join(s.root, 'trip/a.jpg'), 'photo');
    await s.coordinator.reconcileDirectory(''); await s.advance(13_000);
    await rename(path.join(s.root, 'trip'), parked); await s.coordinator.reconcileDirectory(''); await s.advance(10_000);
    await rename(parked, path.join(s.root, 'trip')); await s.coordinator.reconcileDirectory(''); await s.advance(15_000);
    const totals = s.port.events.reduce((sum, event) => ({ added: sum.added + event.added, removed: sum.removed + event.removed }), { added: 0, removed: 0 });
    assert.equal(totals.added - totals.removed, s.port.records.get('trip/a.jpg')?.missingAt === null ? 1 : 0);
    assert.equal(totals.removed, 1);
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); await rm(parked, { recursive: true, force: true }); }
});

test('目录整体缺失事件保留受影响的深层目录', async () => {
  const s = await setup(); const parked = `${s.root}-parked`;
  try {
    await mkdir(path.join(s.root, 'trip/nested'), { recursive: true }); await writeFile(path.join(s.root, 'trip/nested/a.jpg'), 'photo');
    await s.coordinator.reconcileDirectory(''); await s.advance(13_000);
    await rename(path.join(s.root, 'trip'), parked); await s.coordinator.reconcileDirectory(''); await s.advance(12_000);
    const event = s.port.events.find((value) => value.removed === 1); assert.ok(event);
    assert.ok(event.folders.includes('lib/trip/nested'));
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); await rm(parked, { recursive: true, force: true }); }
});

test('移动候选存在歧义时稳定的新文件仍即时可见', async () => {
  const s = await setup();
  try {
    await writeFile(path.join(s.root, 'a.jpg'), 'same'); await link(path.join(s.root, 'a.jpg'), path.join(s.root, 'b.jpg'));
    s.watcher.emit({ eventType: 'rename', path: 'a.jpg' }); await s.coordinator.idle(); await s.advance(16000);
    assert.ok(s.port.records.get('a.jpg')); assert.ok(s.port.records.get('b.jpg'));
    await link(path.join(s.root, 'a.jpg'), path.join(s.root, 'c.jpg')); await rm(path.join(s.root, 'a.jpg')); await rm(path.join(s.root, 'b.jpg'));
    s.watcher.emit({ eventType: 'rename', path: 'a.jpg' }); s.watcher.emit({ eventType: 'rename', path: 'b.jpg' }); await s.coordinator.idle();
    await s.advance(5000); assert.ok(s.port.records.get('c.jpg')); assert.ok(s.port.changes.some((change) => change.kind === 'added' && change.path === 'c.jpg'));
  } finally { await s.coordinator.stop(); s.port.close(); await rm(s.root, { recursive: true, force: true }); }
});
