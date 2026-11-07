import path from 'node:path';
import { systemClock } from './clock.ts';
import type { Clock } from './clock.ts';

export function normalizeRelative(value: string): string | null {
  if (value.includes('\0') || path.posix.isAbsolute(value) || value.includes('\\')) return null;
  const normalized = path.posix.normalize(value);
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return normalized === '.' ? '' : normalized;
}

export function excluded(value: string, rules: string[], isDir = false): boolean {
  const normalized = normalizeRelative(value);
  if (normalized === null) return true;
  const parts = normalized ? normalized.split('/') : [];
  const count = isDir ? parts.length : Math.max(0, parts.length - 1);
  for (let i = 0; i < count; i++) {
    const name = parts[i]!; const relative = parts.slice(0, i + 1).join('/');
    if (name.startsWith('.luvia-replace-') || rules.some((rule) => path.matchesGlob(name, rule) || path.matchesGlob(relative, rule))) return true;
  }
  return false;
}

export class DirtyQueue {
  private readonly pending = new Map<string, { firstAt: number; lastAt: number }>();
  private firstAt: number | null = null;
  private timer: unknown = null;
  private readonly clock: Clock;
  private readonly options: { exclude: string[]; clock?: Clock; onReady: (dirs: string[]) => void };
  constructor(options: { exclude: string[]; clock?: Clock; onReady: (dirs: string[]) => void }) {
    this.options = options; this.clock = options.clock ?? systemClock;
  }
  add(relative: string, isDir: boolean): void {
    const normalized = normalizeRelative(relative);
    if (normalized === null || excluded(normalized, this.options.exclude, isDir)) return;
    const dir = isDir ? normalized : path.posix.dirname(normalized);
    const key = dir === '.' ? '' : dir;
    const now = this.clock.now();
    if (this.firstAt === null) this.firstAt = now;
    const firstAt = this.pending.get(key)?.firstAt ?? now;
    this.pending.set(key, { firstAt, lastAt: now }); if (this.timer === null) this.schedule();
  }
  stop(): void { if (this.timer !== null) this.clock.clearTimeout(this.timer); this.timer = null; this.pending.clear(); this.firstAt = null; }
  private schedule(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    if (this.firstAt === null || this.pending.size === 0) { this.timer = null; return; }
    let deadline = this.firstAt + 10_000;
    for (const item of this.pending.values()) deadline = Math.min(deadline, item.lastAt + 2_000);
    this.timer = this.clock.setTimeout(() => this.release(), Math.max(0, deadline - this.clock.now()));
  }
  private release(): void {
    this.timer = null; const now = this.clock.now();
    const forced = this.firstAt !== null && now >= this.firstAt + 10_000;
    const ready: string[] = [];
    for (const [dir, item] of this.pending) if (forced || now >= item.lastAt + 2_000) { this.pending.delete(dir); ready.push(dir); }
    this.firstAt = null;
    for (const item of this.pending.values()) this.firstAt = this.firstAt === null ? item.firstAt : Math.min(this.firstAt, item.firstAt);
    this.schedule();
    if (ready.length) this.options.onReady(ready);
  }
}
