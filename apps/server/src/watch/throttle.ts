import type { LibraryChangedEvent } from '@luvia/contracts';
import { systemClock } from './clock.ts';
import type { Clock } from './clock.ts';

type Delta = { source: LibraryChangedEvent['source']; folders: string[]; added?: number; removed?: number; updated?: number; moved?: number };
export function compressFolders(folders: string[]): string[] {
  const sorted = [...new Set(folders)].sort(); const result: string[] = [];
  for (const folder of sorted) if (!result.some((parent) => folder === parent || folder.startsWith(`${parent}/`))) result.push(folder);
  return result;
}
export class ChangeThrottle {
  private pending: LibraryChangedEvent | null = null;
  private timer: unknown = null;
  private lastPublished: number | null = null;
  private readonly clock: Clock;
  private readonly options: { libraryId: string; clock?: Clock; publish: (event: LibraryChangedEvent) => void };
  constructor(options: { libraryId: string; clock?: Clock; publish: (event: LibraryChangedEvent) => void }) { this.options = options; this.clock = options.clock ?? systemClock; }
  add(delta: Delta): void {
    if (!this.pending) this.pending = { libraryId: this.options.libraryId, source: delta.source, folders: delta.folders, added: 0, removed: 0, updated: 0, moved: 0 };
    else this.pending.folders = this.pending.folders.length === 0 || delta.folders.length === 0 ? [] : [...this.pending.folders, ...delta.folders];
    this.pending.added += delta.added ?? 0; this.pending.removed += delta.removed ?? 0;
    this.pending.updated += delta.updated ?? 0; this.pending.moved += delta.moved ?? 0;
    const wait = this.lastPublished === null ? 0 : Math.max(0, this.lastPublished + 2000 - this.clock.now());
    if (wait === 0) this.flush();
    else if (this.timer === null) this.timer = this.clock.setTimeout(() => this.flush(), wait);
  }
  stop(): void { if (this.timer !== null) this.clock.clearTimeout(this.timer); this.timer = null; this.pending = null; }
  private flush(): void { if (this.timer !== null) this.clock.clearTimeout(this.timer); this.timer = null; const event = this.pending; this.pending = null; if (event) { event.folders = compressFolders(event.folders); this.lastPublished = this.clock.now(); this.options.publish(event); } }
}
