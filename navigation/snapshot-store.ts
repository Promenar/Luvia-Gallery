import type { ViewportSnapshot } from './types';

const STORAGE_KEY = 'luvia.gallery.viewport-snapshots.v1';
export const MAX_VIEWPORT_SNAPSHOTS = 40;

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const isSnapshot = (value: unknown): value is ViewportSnapshot => {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<ViewportSnapshot>;
  return typeof snapshot.locationKey === 'string'
    && typeof snapshot.offsetWithinItem === 'number'
    && typeof snapshot.fallbackScrollTop === 'number'
    && typeof snapshot.loadedOffset === 'number'
    && typeof snapshot.capturedAt === 'number';
};

const getSessionStorage = (): StorageLike | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

/**
 * 仅保存当前浏览会话可恢复的视口锚点，不保存任何媒体列表或查询结果。
 * saveMemory 不触发同步 I/O，调用方在导航、页面隐藏或防抖计时结束时 flush。
 */
export class SnapshotStore {
  private readonly snapshots = new Map<string, ViewportSnapshot>();
  private readonly storage?: StorageLike;
  private dirty = false;

  constructor(storage: StorageLike | undefined = getSessionStorage()) {
    this.storage = storage;
    this.hydrate();
  }

  get(locationKey: string): ViewportSnapshot | undefined {
    return this.snapshots.get(locationKey);
  }

  saveMemory(snapshot: ViewportSnapshot): ViewportSnapshot | undefined {
    if (!isSnapshot(snapshot)) return undefined;
    const existing = this.snapshots.get(snapshot.locationKey);
    if (existing && existing.capturedAt > snapshot.capturedAt) return existing;

    const stableSnapshot: ViewportSnapshot = { ...snapshot };
    this.snapshots.set(snapshot.locationKey, stableSnapshot);
    this.trim();
    this.dirty = true;
    return stableSnapshot;
  }

  save(snapshot: ViewportSnapshot): void {
    this.saveMemory(snapshot);
    this.flush();
  }

  flush(): void {
    if (!this.dirty) return;
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify([...this.snapshots.values()]));
      this.dirty = false;
    } catch {
      // 写入失败不影响当前页面的内存快照恢复，下次 flush 会继续尝试。
    }
  }

  remove(locationKey: string): void {
    if (!this.snapshots.delete(locationKey)) return;
    this.dirty = true;
    this.flush();
  }

  clear(): void {
    this.snapshots.clear();
    this.dirty = false;
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // sessionStorage 不可用时保留内存降级行为。
    }
  }

  private hydrate(): void {
    try {
      const serialized = this.storage?.getItem(STORAGE_KEY);
      if (!serialized) return;
      const parsed: unknown = JSON.parse(serialized);
      if (!Array.isArray(parsed)) throw new Error('快照存储格式无效');

      for (const candidate of parsed) {
        if (isSnapshot(candidate)) {
          const existing = this.snapshots.get(candidate.locationKey);
          if (!existing || candidate.capturedAt >= existing.capturedAt) {
            this.snapshots.set(candidate.locationKey, { ...candidate });
          }
        }
      }
      this.trim();
    } catch {
      this.snapshots.clear();
      try {
        this.storage?.removeItem(STORAGE_KEY);
      } catch {
        // 损坏存储或受限隐私模式均降级为纯内存快照。
      }
    }
  }

  private trim(): void {
    const entries = [...this.snapshots.entries()].sort(([, left], [, right]) =>
      left.capturedAt - right.capturedAt
    );
    while (entries.length > MAX_VIEWPORT_SNAPSHOTS) {
      const [locationKey] = entries.shift()!;
      this.snapshots.delete(locationKey);
    }
  }
}
