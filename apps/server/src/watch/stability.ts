import { systemClock } from './clock.ts';
import type { Clock } from './clock.ts';

export interface FileSnapshot { size: number; mtimeMs: number }
type Pending = { snapshot: FileSnapshot; since: number; timer: unknown; generation: number };
export class StabilityTracker {
  private readonly pending = new Map<string, Pending>();
  private readonly clock: Clock;
  private sequence = 0;
  private readonly options: { clock?: Clock; stat: (path: string) => Promise<FileSnapshot | null>; onStable: (path: string, snapshot: FileSnapshot) => void; onError?: (error: unknown, path: string) => void; intervalMs?: number };
  constructor(options: { clock?: Clock; stat: (path: string) => Promise<FileSnapshot | null>; onStable: (path: string, snapshot: FileSnapshot) => void; onError?: (error: unknown, path: string) => void; intervalMs?: number }) {
    this.options = options; this.clock = options.clock ?? systemClock;
  }
  track(path: string, snapshot: FileSnapshot): void {
    const old = this.pending.get(path);
    if (old && old.snapshot.size === snapshot.size && old.snapshot.mtimeMs === snapshot.mtimeMs) return;
    if (old) this.clock.clearTimeout(old.timer);
    const pending: Pending = { snapshot, since: this.clock.now(), timer: null, generation: ++this.sequence };
    this.pending.set(path, pending); this.schedule(path, pending);
  }
  has(path: string): boolean { return this.pending.has(path); }
  cancel(path: string): void { const old = this.pending.get(path); if (old) this.clock.clearTimeout(old.timer); this.pending.delete(path); }
  stop(): void { for (const path of this.pending.keys()) this.cancel(path); }
  private schedule(path: string, pending: Pending): void {
    pending.timer = this.clock.setTimeout(() => { void this.check(path, pending.generation); }, this.options.intervalMs ?? 1000);
  }
  private async check(path: string, generation: number): Promise<void> {
    const pending = this.pending.get(path); if (!pending || pending.generation !== generation) return;
    try {
      const snapshot = await this.options.stat(path);
      if (this.pending.get(path) !== pending) return;
      if (snapshot === null) { this.pending.delete(path); return; }
      if (snapshot.size !== pending.snapshot.size || snapshot.mtimeMs !== pending.snapshot.mtimeMs) {
        pending.snapshot = snapshot; pending.since = this.clock.now();
      } else if (this.clock.now() - pending.since >= 3000) {
        this.pending.delete(path); this.options.onStable(path, snapshot); return;
      }
    } catch (error) { this.options.onError?.(error, path); }
    if (this.pending.get(path) === pending) this.schedule(path, pending);
  }
}
