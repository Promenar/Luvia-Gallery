import { systemClock } from './clock.ts';
import type { Clock } from './clock.ts';

export interface MoveCandidate {
  path: string;
  isDir: boolean;
  mediaId: string | null;
  size: number;
  mtimeMs: number;
  dev: number | string | null;
  ino: number | string | null;
  headHash: string | null;
}
function usable(value: number | string | null): boolean { return value !== null && value !== 0 && value !== '0' && value !== ''; }
export function matchKind(from: MoveCandidate, to: MoveCandidate): 'inode' | 'hash' | null {
  if (from.isDir !== to.isDir) return null;
  if (usable(from.dev) && usable(from.ino) && usable(to.dev) && usable(to.ino) && String(from.dev) === String(to.dev) && String(from.ino) === String(to.ino)) return 'inode';
  if (!from.isDir && from.headHash && to.headHash && from.size === to.size && from.mtimeMs === to.mtimeMs && from.headHash === to.headHash) return 'hash';
  return null;
}
type Held = { item: MoveCandidate; at: number };
export class MoveMatcher {
  private readonly missing = new Map<string, Held>();
  private readonly added = new Map<string, Held>();
  private timer: unknown = null;
  private deadline: number | null = null;
  private readonly clock: Clock;
  private readonly options: { clock?: Clock; onMoved: (from: MoveCandidate, to: MoveCandidate) => void; onMissing: (item: MoveCandidate) => void; onAdded: (item: MoveCandidate) => void };
  constructor(options: { clock?: Clock; onMoved: (from: MoveCandidate, to: MoveCandidate) => void; onMissing: (item: MoveCandidate) => void; onAdded: (item: MoveCandidate) => void }) { this.options = options; this.clock = options.clock ?? systemClock; }
  vanished(item: MoveCandidate): void { this.insert(item, true); }
  appeared(item: MoveCandidate): void { this.insert(item, false); }
  pendingMatchForAdded(item: MoveCandidate): 'inode' | 'hash' | 'ambiguous' | null {
    const kinds = [...this.missing.values()].map((held) => matchKind(held.item, item));
    const inode = kinds.filter((kind) => kind === 'inode').length;
    if (inode) return inode === 1 ? 'inode' : 'ambiguous';
    const hash = kinds.filter((kind) => kind === 'hash').length;
    return hash === 0 ? null : hash === 1 ? 'hash' : 'ambiguous';
  }
  hasAdded(path: string): boolean { return this.added.has(path); }
  hasVanished(path: string): boolean { return this.missing.has(path); }
  cancelAdded(path: string): void { this.added.delete(path); this.schedule(); }
  cancelVanished(path: string): void { this.missing.delete(path); this.schedule(); }
  stop(): void { if (this.timer !== null) this.clock.clearTimeout(this.timer); this.timer = null; this.deadline = null; this.missing.clear(); this.added.clear(); }
  private insert(item: MoveCandidate, missing: boolean): void {
    if (this.deadline !== null && this.clock.now() >= this.deadline) {
      if (this.timer !== null) this.clock.clearTimeout(this.timer);
      this.timer = null; this.deadline = null; this.releaseExpired(); this.schedule();
    }
    const own = missing ? this.missing : this.added; const other = missing ? this.added : this.missing;
    const matches = [...other.values()].map((held) => ({ held, kind: missing ? matchKind(item, held.item) : matchKind(held.item, item) }));
    const inode = matches.filter((match) => match.kind === 'inode');
    const hash = matches.filter((match) => match.kind === 'hash');
    const chosen = inode.length === 1 ? inode[0] : inode.length === 0 && hash.length === 1 ? hash[0] : undefined;
    if (chosen) {
      other.delete(chosen.held.item.path); own.delete(item.path); this.schedule();
      if (missing) this.options.onMoved(item, chosen.held.item); else this.options.onMoved(chosen.held.item, item);
      return;
    }
    own.set(item.path, { item, at: this.clock.now() }); this.schedule();
  }
  private schedule(): void {
    if (this.missing.size === 0 && this.added.size === 0) {
      if (this.timer !== null) this.clock.clearTimeout(this.timer);
      this.timer = null; this.deadline = null; return;
    }
    if (this.timer !== null) return;
    let deadline = Infinity;
    for (const held of this.missing.values()) deadline = Math.min(deadline, held.at + 10_000);
    for (const held of this.added.values()) deadline = Math.min(deadline, held.at + 10_000);
    this.deadline = deadline;
    this.timer = this.clock.setTimeout(() => { this.timer = null; this.deadline = null; this.releaseExpired(); this.schedule(); }, Math.max(0, deadline - this.clock.now()));
  }
  private releaseExpired(): void {
    const now = this.clock.now();
    for (const [path, held] of this.missing) if (now >= held.at + 10_000) { this.missing.delete(path); this.options.onMissing(held.item); }
    for (const [path, held] of this.added) if (now >= held.at + 10_000) { this.added.delete(path); this.options.onAdded(held.item); }
  }
}
