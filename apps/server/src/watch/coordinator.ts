import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { LibraryChangedEvent, LibraryChange as LibraryChangeSchema, LibraryWatch } from '@luvia/contracts';
import type { z } from 'zod';
export type WatchLibraryChange = z.infer<typeof LibraryChangeSchema>;
import { systemClock } from './clock.ts';
import type { Clock } from './clock.ts';
import { DirtyQueue, excluded, normalizeRelative } from './dirty-queue.ts';
import { classifyMissing } from './grace.ts';
import { statFields } from './file-info.ts';
import { decideWatchMode } from './mode.ts';
import { matchKind, MoveMatcher } from './move-matcher.ts';
import type { MoveCandidate } from './move-matcher.ts';
import { diffDirectory } from './reconcile-dir.ts';
import type { DirectoryEntry } from './reconcile-dir.ts';
import { RootGuard } from './root-guard.ts';
import { StabilityTracker } from './stability.ts';
import type { FileSnapshot } from './stability.ts';
import { ChangeThrottle } from './throttle.ts';
import { NodeFsWatcher } from './watcher.ts';
import type { PathEvent, Watcher } from './watcher.ts';
import { ScanLockedError } from './scan-lock-error.ts';

export interface IndexedRecord extends MoveCandidate { missingAt: number | null }
export interface LibraryIndexPort {
  /** 路径均为媒体库内相对路径；目录读取包含缺失记录。 */
  readDirectory(directory: string): Promise<IndexedRecord[]>;
  readSubdirectories(directory: string): Promise<string[]>;
  /** 更新已核验身份的目录自身修改时间。 */
  writeDirectoryMtime(entry: MoveCandidate): Promise<boolean>;
  findMissingCandidates(candidate: MoveCandidate): Promise<IndexedRecord[]>;
  writeAdded(entry: MoveCandidate): Promise<string | null>;
  writeUpdated(old: IndexedRecord, entry: MoveCandidate): Promise<void>;
  /** 目录移动须原子改写子孙路径并保留各自缺失状态。 */
  writeMoved(old: IndexedRecord, entry: MoveCandidate): Promise<number>;
  /** 目录缺失须使所有子孙进入不可见的缺失状态。 */
  writeMissing(old: IndexedRecord, at: number): Promise<number>;
  /** 目录恢复时保留子孙缺失状态，直至各子项重新被对账确认。 */
  writeRestored(old: IndexedRecord, entry: MoveCandidate): Promise<number>;
  /** 目录清理须同时清理其仍缺失的子孙。 */
  writeRemoved(old: IndexedRecord): Promise<void>;
  appendChange(change: WatchLibraryChange): Promise<void>;
  requestFullReconcile(reason: string): Promise<void>;
  publishEvent(event: LibraryChangedEvent, channel?: 'folder-time'): Promise<void>;
}

type Source = WatchLibraryChange['source'];
type Candidate = MoveCandidate & { source: Source };
type Options = {
  libraryId: string; root: string; exclude: string[]; port: LibraryIndexPort; missingGraceDays: number;
  requested?: LibraryWatch['mode']; fsType?: string | null; dirCount?: number; quota?: number | null; pollIntervalSec?: number;
  currentFsType?: () => string | null;
  clock?: Clock; watcher?: Watcher; guard?: RootGuard; onError?: (error: unknown) => void;
};
const extensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif', '.tif', '.tiff', '.bmp', '.mp4', '.m4v', '.mkv', '.mov', '.webm', '.avi', '.wmv', '.mpeg', '.mpg', '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma', '.opus']);
function parentOf(relative: string): string { const parent = path.posix.dirname(relative); return parent === '.' ? '' : parent; }
function inside(root: string, target: string): boolean { const rel = path.relative(root, target); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); }
function missingError(error: unknown): boolean { return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? ''); }

export class WatchCoordinator {
  private readonly options: Options;
  private readonly clock: Clock;
  private readonly watcher: Watcher;
  private readonly guard: RootGuard;
  private readonly dirty: DirtyQueue;
  private readonly stable: StabilityTracker;
  private readonly matcher: MoveMatcher;
  private readonly throttle: ChangeThrottle;
  private readonly folderTimeThrottle: ChangeThrottle;
  private tail: Promise<void> = Promise.resolve();
  private diskTail: Promise<void> = Promise.resolve();
  private started = false;
  private stopping = false;
  private pollTimer: unknown = null;
  private state: LibraryWatch['state'] = 'starting';
  private selectedState: LibraryWatch['state'] = 'starting';
  private selectedReason: string | null = null;
  private fsType: string | null;
  private rootUnavailable = false;
  private watcherActive = false;
  private degradedReason: string | null = null;
  private lastEventAt: string | null = null;
  private lastReconcileAt: string | null = null;
  private readonly pendingSources = new Map<string, Source>();
  private readonly provisionalRetries = new Set<string>();

  constructor(options: Options) {
    this.options = options; this.clock = options.clock ?? systemClock; this.fsType = options.fsType ?? null;
    this.watcher = options.watcher ?? new NodeFsWatcher(options.root);
    this.guard = options.guard ?? new RootGuard({ root: options.root });
    this.dirty = new DirtyQueue({ exclude: options.exclude, clock: this.clock, onReady: (dirs) => {
      for (const dir of dirs) void this.reconcileDirectory(dir, 'watch').catch(() => {});
    } });
    this.stable = new StabilityTracker({ clock: this.clock,
      stat: async (relative) => { const item = await this.statEntry(relative); return item && !item.isDir ? item : null; },
      onStable: (relative, snapshot) => { void this.run(() => this.onStable(relative, snapshot), [parentOf(relative)]).catch(() => {}); },
      onDropped: (relative) => { this.pendingSources.delete(relative); this.provisionalRetries.delete(relative); },
      onError: (error) => this.options.onError?.(error),
    });
    this.matcher = new MoveMatcher({ clock: this.clock,
      onMoved: (from, to) => { void this.run(() => this.applyMoved(from as Candidate, to as Candidate), [parentOf(from.path), parentOf(to.path)]).catch(() => {}); },
      onMissing: (item) => { void this.run(() => this.applyMissing(item as Candidate), [parentOf(item.path)]).catch(() => {}); },
      onAdded: (item) => { void this.run(() => item.mediaId === null ? this.applyAdded(item as Candidate) : this.finalizeAdded(item as Candidate), [parentOf(item.path)]).catch(() => {}); },
    });
    this.throttle = new ChangeThrottle({ libraryId: options.libraryId, clock: this.clock,
      publish: (event) => { void this.run(() => this.options.port.publishEvent(event)).catch(() => {}); },
    });
    this.folderTimeThrottle = new ChangeThrottle({ libraryId: options.libraryId, clock: this.clock,
      publish: (event) => { void this.run(() => this.options.port.publishEvent(event, 'folder-time')).catch(() => {}); },
    });
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('协调器已启动');
    this.started = true; this.stopping = false;
    const decision = decideWatchMode({ requested: this.options.requested ?? 'auto', fsType: this.options.fsType ?? null,
      dirCount: this.options.dirCount ?? 0, quota: this.options.quota ?? null, pollIntervalSec: this.options.pollIntervalSec });
    this.state = decision.state; this.degradedReason = decision.degradedReason; this.selectedState = decision.state; this.selectedReason = decision.degradedReason;
    if (!(await this.checkRoot())) {
      if (this.selectedState !== 'off') this.schedulePoll();
      return;
    }
    if (this.state !== 'off') await this.options.port.requestFullReconcile('startup');
    if (this.state === 'watching') {
      await this.startWatcher();
    } else if (this.state === 'polling' || this.state === 'degraded') this.schedulePoll();
  }
  async stop(): Promise<void> {
    this.stopping = true; this.watcher.stop(); this.watcherActive = false;
    await this.idle();
    this.dirty.stop(); this.stable.stop(); this.matcher.stop(); this.throttle.stop(); this.folderTimeThrottle.stop();
    if (this.pollTimer !== null) this.clock.clearTimeout(this.pollTimer); this.pollTimer = null;
    this.pendingSources.clear(); this.provisionalRetries.clear(); this.started = false;
  }
  async idle(): Promise<void> {
    while (true) { await this.stable.idle(); const current = this.tail; await current; await this.stable.idle(); if (this.tail === current) return; }
  }
  async status(): Promise<LibraryWatch> {
    return { mode: this.options.requested ?? 'auto', pollIntervalSec: this.options.pollIntervalSec ?? 300, state: this.state,
      watchedDirs: this.state === 'watching' ? await this.watcher.watchedCount() : null, lastEventAt: this.lastEventAt,
      lastReconcileAt: this.lastReconcileAt, degradedReason: this.degradedReason };
  }
  async checkRoot(): Promise<boolean> {
    const status = await this.guard.check();
    if (this.stopping) return false;
    if (status.state === 'unavailable') {
      this.rootUnavailable = true; this.state = 'degraded'; this.degradedReason = '媒体库根目录不可用或挂载身份不符，等待恢复';
      if (this.watcherActive) { this.watcher.stop(); this.watcherActive = false; }
      return false;
    }
    const fsType = this.options.currentFsType?.() ?? this.fsType;
    if (fsType !== this.fsType) {
      this.fsType = fsType;
      const decision = decideWatchMode({ requested: this.options.requested ?? 'auto', fsType,
        dirCount: this.options.dirCount ?? 0, quota: this.options.quota ?? null, pollIntervalSec: this.options.pollIntervalSec });
      this.selectedState = decision.state; this.selectedReason = decision.degradedReason;
      if (this.watcherActive && decision.state !== 'watching') { this.watcher.stop(); this.watcherActive = false; }
      this.rootUnavailable = true;
    }
    if (this.rootUnavailable) {
      this.rootUnavailable = false; this.state = this.selectedState; this.degradedReason = this.selectedReason;
      if (this.state === 'watching') {
        if (this.pollTimer !== null) this.clock.clearTimeout(this.pollTimer);
        this.pollTimer = null;
        if (this.started && !this.stopping) await this.startWatcher();
      } else if (this.started && !this.stopping && this.state !== 'off') this.schedulePoll();
    }
    if (status.needsFullReconcile) await this.options.port.requestFullReconcile('root-recovered');
    return status.state === 'available';
  }
  private async startWatcher(): Promise<void> {
    if (this.watcherActive) return;
    try {
      this.watcherActive = true;
      this.watcher.start({ onEvent: (event) => { const relative = event.path === null ? null : normalizeRelative(event.path);
        void this.run(() => this.onEvent(event), relative === null ? [] : [parentOf(relative)]).catch(() => {}); },
        onError: (error) => { void this.run(() => this.watchError(error)).catch(() => {}); },
        onOverflow: () => { void this.run(() => this.options.port.requestFullReconcile('overflow')).catch(() => {}); } });
    } catch (error) { this.watcherActive = false; await this.watchError(error); }
  }
  reconcileDirectory(directory: string, source: Source = 'watch'): Promise<void> {
    const relative = normalizeRelative(directory);
    if (relative === null || excluded(relative, this.options.exclude, true)) return Promise.reject(new Error('无效的对账目录'));
    return this.run(() => this.reconcile(relative, source), [relative]);
  }
  private run(work: () => Promise<void>, dirtyDirectories: string[] = []): Promise<void> {
    const task = this.tail.then(async () => { if (!this.stopping) await work(); });
    this.tail = task.catch(async (error: unknown) => {
      if (this.stopping) return;
      if (dirtyDirectories.length) {
        for (const directory of dirtyDirectories) this.dirty.add(directory, true);
        if (!(error instanceof ScanLockedError)) this.options.onError?.(error);
        return;
      }
      this.options.onError?.(error);
    });
    return task;
  }
  private schedulePoll(): void {
    if (this.pollTimer !== null || this.stopping) return;
    this.pollTimer = this.clock.setTimeout(() => {
      this.pollTimer = null;
      void this.run(async () => {
        const available = await this.checkRoot();
        if (this.state !== 'watching' && this.state !== 'off') {
          if (available) await this.options.port.requestFullReconcile('poll');
          this.schedulePoll();
        }
      }).catch(() => {});
    }, (this.options.pollIntervalSec ?? 300) * 1000);
  }
  private async watchError(error: unknown): Promise<void> {
    this.options.onError?.(error); this.watcher.stop(); this.watcherActive = false;
    this.state = this.options.requested === 'watch' ? 'degraded' : 'polling';
    this.degradedReason = '实时监视发生错误，已改为轮询并请求全量对账';
    this.selectedState = this.state; this.selectedReason = this.degradedReason;
    this.schedulePoll(); await this.options.port.requestFullReconcile('watch-error');
  }
  private async onEvent(event: PathEvent): Promise<void> {
    this.lastEventAt = new Date(this.clock.now()).toISOString();
    if (!(await this.checkRoot())) return;
    if (event.path === null) { await this.options.port.requestFullReconcile('overflow'); return; }
    const relative = normalizeRelative(event.path);
    if (relative === null) { await this.options.port.requestFullReconcile('overflow'); return; }
    const stat = await this.statEntry(relative);
    if (stat?.isDir) { this.dirty.add(relative, true); if (relative) this.dirty.add(relative, false); }
    else this.dirty.add(relative, false);
  }
  private async checkedPath(relative: string): Promise<string> {
    const root = await realpath(this.options.root); const full = path.join(root, relative);
    const actual = await realpath(full);
    if (!inside(root, actual)) throw new Error('路径越出媒体库根目录');
    return full;
  }
  private disk<T>(work: () => Promise<T>): Promise<T> {
    const task = this.diskTail.then(() => { if (this.stopping) throw new Error('实时监控已停止'); return work(); });
    this.diskTail = task.then(() => {}, () => {});
    return task;
  }
  private async statEntry(relative: string): Promise<MoveCandidate | null> {
    return this.disk(async () => { try {
      const full = await this.checkedPath(relative); const info = await lstat(full, { bigint: true });
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) return null;
      return { path: relative, isDir: info.isDirectory(), ...statFields(info), mediaId: null, headHash: null };
    } catch (error) { if (missingError(error)) return null; throw error; } });
  }
  private async readDisk(directory: string): Promise<DirectoryEntry[]> {
    return this.disk(async () => {
    const full = await realpath(await this.checkedPath(directory)); const entries = await readdir(full, { withFileTypes: true }); const result: DirectoryEntry[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      const info = await lstat(path.join(full, entry.name), { bigint: true });
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) continue;
      const isDir = info.isDirectory();
      if (excluded(relative, this.options.exclude, isDir)) continue;
      if (!isDir && !extensions.has(path.posix.extname(relative).toLowerCase())) continue;
      result.push({ name: entry.name, isDir, ...statFields(info) });
    }
    return result;
    });
  }
  private async hashHead(relative: string): Promise<string> {
    return this.disk(async () => {
    const full = await this.checkedPath(relative); const file = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { const buffer = Buffer.alloc(65_536); const { bytesRead } = await file.read(buffer, 0, buffer.length, 0); return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex'); }
    finally { await file.close(); }
    });
  }
  private async countDirectoryMoved(from: string, to: string): Promise<number> {
    const pending = [{ from, to }]; let count = 0;
    for (let offset = 0; offset < pending.length; offset++) {
      if (this.stopping) throw new Error('实时监控已停止');
      const current = pending[offset]!;
      const [entries, indexed] = await Promise.all([this.readDisk(current.to), this.options.port.readDirectory(current.from)]);
      const byName = new Map(indexed.map((item) => [path.posix.basename(item.path), item]));
      for (const entry of entries) {
        const old = byName.get(entry.name); if (!old || old.isDir !== entry.isDir) continue;
        if (entry.isDir) {
          pending.push({ from: `${current.from}/${entry.name}`, to: `${current.to}/${entry.name}` });
        } else {
          const hasIdentity = old.dev !== null && old.ino !== null && String(old.dev) !== '0' && String(old.ino) !== '0';
          if (hasIdentity ? String(old.dev) === String(entry.dev) && String(old.ino) === String(entry.ino)
            : old.size === entry.size && old.mtimeMs === entry.mtimeMs) count++;
        }
      }
    }
    return count;
  }
  private async reconcile(directory: string, source: Source, recursive = false): Promise<void> {
    const directories = [{ path: directory, recursive }];
    for (let offset = 0; offset < directories.length; offset++) {
      const { path: current, recursive: scanChildren } = directories[offset]!;
      if (!(await this.checkRoot())) return;
      let entries: DirectoryEntry[]; let indexed: IndexedRecord[];
      try {
        [entries, indexed] = await Promise.all([this.readDisk(current), this.options.port.readDirectory(current)]);
      } catch (error) {
        if (!(await this.checkRoot())) return;
        throw error;
      }
      if (!(await this.checkRoot())) return;
      const currentDirectory = await this.statEntry(current);
      if (currentDirectory?.isDir) {
        try {
          if (await this.options.port.writeDirectoryMtime(currentDirectory)) {
            const parent = parentOf(current);
            this.folderTimeThrottle.add({ source, folders: [current, parent].map((dir) => dir ? `${this.options.libraryId}/${dir}` : this.options.libraryId) });
          }
        } catch (error) {
          if (!(error instanceof ScanLockedError)) throw error;
          this.dirty.add(current, true);
        }
      }
      indexed = indexed.filter((item) => !excluded(item.path, this.options.exclude, item.isDir));
      const known = indexed.map((item) => ({ ...item, name: path.posix.basename(item.path) }));
      const diff = diffDirectory(entries, known);
      const byName = new Map(known.map((item) => [item.name, item]));
      const changedNames = new Set(diff.changed.map((item) => item.name));
      for (const old of diff.vanished) {
        if (old.missingAt !== null) {
          if (classifyMissing({ missingAt: old.missingAt, now: this.clock.now(), missingGraceDays: this.options.missingGraceDays, present: false, nextReconcile: true }) === 'removed') {
            await this.options.port.writeRemoved(old); await this.record('removed', old.path, null, old.isDir, old.mediaId, source);
          }
          continue;
        }
        this.stable.cancel(old.path); this.matcher.cancelAdded(old.path); this.pendingSources.delete(old.path); this.provisionalRetries.delete(old.path);
        if (!this.matcher.hasVanished(old.path)) { const vanished: Candidate = { ...old, source }; this.matcher.vanished(vanished); }
      }
      for (const entry of entries) {
        const relative = current ? `${current}/${entry.name}` : entry.name; const old = byName.get(entry.name);
        const observed: Candidate = { path: relative, isDir: entry.isDir, size: entry.size, mtimeMs: entry.mtimeMs,
          dev: entry.dev, ino: entry.ino, headHash: null, mediaId: null, source };
        if (entry.isDir) {
          if (old?.missingAt !== null && old?.missingAt !== undefined) { await this.restorePresent(old, observed); directories.push({ path: relative, recursive: true }); }
          else if (!old || !old.isDir) {
            const restored = await this.findMissingMatch(observed);
            if (restored) {
              const movedMedia = restored.path !== relative ? await this.countDirectoryMoved(restored.path, relative) : 0;
              if (!(await this.checkRoot())) return;
              await this.options.port.writeRestored(restored, observed);
              await this.record('restored', relative, null, true, restored.mediaId, source);
              if (restored.path !== relative) await this.record('moved', relative, restored.path, true, restored.mediaId, source, true, 0, 0, movedMedia);
            } else if (!this.matcher.hasAdded(relative)) this.matcher.appeared(observed);
            directories.push({ path: relative, recursive: true });
          } else if (scanChildren) directories.push({ path: relative, recursive: true });
        } else if (!old || old.isDir || old.missingAt !== null || changedNames.has(entry.name)) {
          this.pendingSources.set(relative, source); this.stable.track(relative, entry);
        }
      }
      this.lastReconcileAt = new Date(this.clock.now()).toISOString();
    }
  }
  private async onStable(relative: string, snapshot: FileSnapshot): Promise<void> {
    const source = this.pendingSources.get(relative) ?? 'watch'; this.pendingSources.delete(relative);
    if (!(await this.checkRoot())) return;
    let observed = await this.statEntry(relative); if (!observed || observed.isDir) return;
    if (observed.size !== snapshot.size || observed.mtimeMs !== snapshot.mtimeMs) { this.pendingSources.set(relative, source); this.stable.track(relative, observed); return; }
    try { observed.headHash = await this.hashHead(relative); } catch (error) { if (missingError(error)) return; throw error; }
    const checked = await this.statEntry(relative); if (!checked || checked.isDir) return;
    if (checked.size !== observed.size || checked.mtimeMs !== observed.mtimeMs || checked.dev !== observed.dev || checked.ino !== observed.ino) {
      this.pendingSources.set(relative, source); this.stable.track(relative, checked); return;
    }
    const candidate: Candidate = { ...observed, source };
    const existing = (await this.options.port.readDirectory(parentOf(relative))).find((item) => item.path === relative);
    if (existing && existing.isDir === candidate.isDir) {
      if (existing.missingAt !== null) { await this.restorePresent(existing, candidate); return; }
      this.matcher.cancelVanished(relative);
      if (existing.size !== candidate.size || existing.mtimeMs !== candidate.mtimeMs || existing.dev !== candidate.dev || existing.ino !== candidate.ino ||
        (existing.headHash !== null && existing.headHash !== candidate.headHash)) {
        await this.options.port.writeUpdated(existing, candidate); await this.record('updated', relative, null, false, existing.mediaId, source);
      }
      const refreshed: Candidate = { ...candidate, mediaId: existing.mediaId };
      if (!this.matcher.refreshAdded(refreshed) && this.provisionalRetries.delete(relative)) this.matcher.appeared(refreshed);
      return;
    }
    const pendingKind = this.matcher.pendingMatchForAdded(candidate);
    const match = await this.findMissingMatch(candidate);
    if (pendingKind === 'ambiguous') {
      await this.applyAdded(candidate);
      if (candidate.mediaId !== null) this.matcher.appeared(candidate);
      return;
    }
    if (pendingKind === 'inode' || (pendingKind === 'hash' && (!match || matchKind(match, candidate) !== 'inode'))) {
      this.matcher.appeared(candidate); return;
    }
    if (match) { await this.options.port.writeRestored(match, candidate); await this.record('restored', relative, null, false, match.mediaId, source);
      if (match.path !== relative) await this.record('moved', relative, match.path, false, match.mediaId, source, false);
      return;
    }
    if (!this.matcher.hasAdded(relative)) {
      await this.applyAdded(candidate);
      if (candidate.mediaId !== null) this.matcher.appeared(candidate);
    }
  }
  private async findMissingMatch(candidate: Candidate): Promise<IndexedRecord | undefined> {
    const missing = await this.options.port.findMissingCandidates(candidate);
    const valid = missing.filter((item) => item.missingAt !== null && classifyMissing({ missingAt: item.missingAt, now: this.clock.now(),
      missingGraceDays: this.options.missingGraceDays, present: true, nextReconcile: true }) === 'restored');
    const inode = valid.filter((item) => matchKind(item, candidate) === 'inode');
    const hash = valid.filter((item) => matchKind(item, candidate) === 'hash');
    return inode.length === 1 ? inode[0] : inode.length === 0 && hash.length === 1 ? hash[0] : undefined;
  }
  private async restorePresent(old: IndexedRecord, candidate: Candidate): Promise<void> {
    if (old.missingAt === null) return;
    const outcome = classifyMissing({ missingAt: old.missingAt, now: this.clock.now(), missingGraceDays: this.options.missingGraceDays, present: true, nextReconcile: true });
    if (outcome === 'restored') {
      await this.options.port.writeRestored(old, candidate); await this.record('restored', candidate.path, null, candidate.isDir, old.mediaId, candidate.source);
    } else if (outcome === 'removed') {
      await this.options.port.writeRemoved(old); await this.record('removed', old.path, null, old.isDir, old.mediaId, candidate.source);
      this.matcher.appeared(candidate);
    }
  }
  private async applyMoved(from: Candidate, to: Candidate): Promise<void> {
    if (!(await this.checkRoot())) return;
    const old = (await this.options.port.readDirectory(parentOf(from.path))).find((item) => item.path === from.path);
    const target = await this.statEntry(to.path); const source = await this.statEntry(from.path);
    if (!old || !target || source || target.isDir !== to.isDir) {
      this.dirty.add(parentOf(from.path), true); this.dirty.add(parentOf(to.path), true); return;
    }
    if (target.dev !== to.dev || target.ino !== to.ino || (!target.isDir && (target.size !== to.size || target.mtimeMs !== to.mtimeMs))) {
      this.matcher.vanished(from); if (!target.isDir) {
        if (to.mediaId !== null) this.provisionalRetries.add(to.path);
        this.pendingSources.set(to.path, to.source); this.stable.track(to.path, target);
      }
      else { this.dirty.add(parentOf(from.path), true); this.dirty.add(parentOf(to.path), true); }
      return;
    }
    const movedMedia = to.isDir ? await this.countDirectoryMoved(from.path, to.path) : 1;
    if (!(await this.checkRoot())) return;
    let removedProvisional = 0;
    if (old.missingAt !== null) {
      removedProvisional = await this.options.port.writeRestored(old, to);
      await this.record('restored', to.path, null, to.isDir, old.mediaId, to.source, to.mediaId === null);
    } else removedProvisional = await this.options.port.writeMoved(old, to);
    const removed = to.isDir ? removedProvisional : to.mediaId !== null && old.missingAt === null ? 1 : 0;
    await this.record('moved', to.path, from.path, to.isDir, old.mediaId, to.source, true, removed, 0, movedMedia);
    if (to.isDir) await this.reconcile(to.path, to.source, true);
  }
  private async applyMissing(item: Candidate): Promise<void> {
    if (!(await this.checkRoot())) return;
    if (await this.statEntry(item.path)) { this.dirty.add(item.path, item.isDir); return; }
    const old = (await this.options.port.readDirectory(parentOf(item.path))).find((value) => value.path === item.path);
    if (!old || old.missingAt !== null) return;
    if (!(await this.checkRoot())) return;
    const missingMedia = await this.options.port.writeMissing(old, this.clock.now());
    await this.record('missing', old.path, null, old.isDir, old.mediaId, item.source, true, 0, missingMedia);
  }
  private async finalizeAdded(item: Candidate): Promise<void> {
    const match = await this.findMissingMatch(item);
    if (match) await this.applyMoved({ ...match, source: item.source }, item);
  }
  private async applyAdded(item: Candidate): Promise<void> {
    if (!(await this.checkRoot())) return;
    const current = await this.statEntry(item.path); if (!current || current.isDir !== item.isDir) return;
    if (current.isDir && (current.dev !== item.dev || current.ino !== item.ino)) { this.dirty.add(item.path, false); return; }
    if (!current.isDir && (current.size !== item.size || current.mtimeMs !== item.mtimeMs || current.dev !== item.dev || current.ino !== item.ino)) {
      this.pendingSources.set(item.path, item.source); this.stable.track(item.path, current); return;
    }
    if (current.isDir) item = { ...item, mtimeMs: current.mtimeMs };
    const old = (await this.options.port.readDirectory(parentOf(item.path))).find((value) => value.path === item.path);
    if (old) { await this.reconcile(parentOf(item.path), item.source); return; }
    const restored = await this.findMissingMatch(item);
    if (restored) {
      await this.options.port.writeRestored(restored, item);
      await this.record('restored', item.path, null, item.isDir, restored.mediaId, item.source);
      if (restored.path !== item.path) await this.record('moved', item.path, restored.path, item.isDir, restored.mediaId, item.source, false);
      if (item.isDir) await this.reconcile(item.path, item.source, true);
      return;
    }
    const mediaId = await this.options.port.writeAdded(item); item.mediaId = mediaId;
    await this.record('added', item.path, null, item.isDir, mediaId, item.source);
  }
  private async record(kind: WatchLibraryChange['kind'], relative: string, fromPath: string | null, isDir: boolean, mediaId: string | null, source: Source, notify = true, removeProvisional = 0, missingMedia = 0, movedMedia = 0): Promise<void> {
    await this.options.port.appendChange({ ts: new Date(this.clock.now()).toISOString(), kind, path: relative, fromPath, isDir, mediaId, source });
    if (!notify || kind === 'removed') return;
    const paths = [parentOf(relative), ...(fromPath === null ? [] : [parentOf(fromPath)])];
    if (isDir) {
      const affected = await this.options.port.readSubdirectories(relative);
      paths.push(relative, ...affected);
      if (fromPath !== null) paths.push(fromPath, ...affected.map((dir) => fromPath + dir.slice(relative.length)));
    }
    const folders = paths.map((dir) => dir ? `${this.options.libraryId}/${dir}` : this.options.libraryId);
    this.throttle.add({ source, folders, added: !isDir && (kind === 'added' || kind === 'restored') ? 1 : 0,
      updated: !isDir && kind === 'updated' ? 1 : 0, moved: kind === 'moved' ? (isDir ? movedMedia : 1) : 0, removed: kind === 'missing' ? missingMedia : removeProvisional });
  }
}
