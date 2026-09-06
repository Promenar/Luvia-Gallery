import { createHistoryState, type GalleryHistoryState } from './history-state';
import { getParentFolderPath, hasExplicitGalleryLayout, parseGalleryUrl, serializeGalleryUrl } from './location';
import { SnapshotStore, type StorageLike } from './snapshot-store';
import type { GalleryLayout, GalleryLocation, ViewportSnapshot, ViewportSnapshotInput } from './types';

const NAVIGATION_STATE_MARKER = '__luviaGalleryNavigation';
const NAVIGATION_SESSION_STORAGE_KEY = 'luvia.gallery.navigation-session.v1';
const SNAPSHOT_FLUSH_DELAY_MS = 320;

interface NavigationSessionMetadata {
  sessionId: string;
  currentIndex: number;
  maxIndex: number;
}

export interface GalleryNavigationHistoryState extends GalleryHistoryState {
  [NAVIGATION_STATE_MARKER]: true;
  sessionId: string;
  sessionIndex: number;
  sessionMaxIndex: number;
}

export interface NavigationEnvironment {
  history: Pick<History, 'state' | 'pushState' | 'replaceState' | 'back' | 'forward'>;
  location: Pick<Location, 'hash'>;
  storage?: StorageLike;
}

export type NavigationWriteMode = 'push' | 'replace';
export type LocationUpdate = Partial<Omit<GalleryLocation, 'key'>>;

export interface GalleryNavigationControllerOptions {
  environment?: NavigationEnvironment;
  snapshotStore?: SnapshotStore;
  snapshotFlushDelayMs?: number;
}

const getBrowserStorage = (): StorageLike | undefined => {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
};

const getBrowserEnvironment = (): NavigationEnvironment => {
  if (typeof window === 'undefined') {
    throw new Error('GalleryNavigationController 需要浏览器环境');
  }
  return { history: window.history, location: window.location, storage: getBrowserStorage() };
};

const isNavigationState = (value: unknown): value is GalleryNavigationHistoryState => {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<GalleryNavigationHistoryState>;
  return state[NAVIGATION_STATE_MARKER] === true
    && typeof state.sessionIndex === 'number'
    && typeof state.sessionMaxIndex === 'number'
    && !!state.location
    && typeof state.location.key === 'string';
};

const normalizeLocation = (location: GalleryLocation): GalleryLocation =>
  parseGalleryUrl(serializeGalleryUrl(location));

const cloneLocation = (location: GalleryLocation): GalleryLocation => ({ ...location });

const createSessionId = (): string =>
  `gallery-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const isSessionMetadata = (value: unknown): value is NavigationSessionMetadata => {
  if (!value || typeof value !== 'object') return false;
  const metadata = value as Partial<NavigationSessionMetadata>;
  return typeof metadata.sessionId === 'string'
    && typeof metadata.currentIndex === 'number'
    && typeof metadata.maxIndex === 'number';
};

/** 浏览器 History 是导航顺序的唯一事实源；会话元数据只补足刷新后的前进可用性。 */
export class GalleryNavigationController {
  private readonly environment: NavigationEnvironment;
  private readonly snapshotStore: SnapshotStore;
  private readonly storage?: StorageLike;
  private readonly snapshotFlushDelayMs: number;
  private readonly knownLocations = new Map<number, GalleryLocation>();
  private location: GalleryLocation | undefined;
  private sessionId = '';
  private sessionIndex = 0;
  private sessionMaxIndex = 0;
  private snapshotFlushTimer: ReturnType<typeof setTimeout> | undefined;
  private canApplyInitialLayoutPreference = false;

  constructor(options: GalleryNavigationControllerOptions = {}) {
    this.environment = options.environment ?? getBrowserEnvironment();
    this.storage = this.environment.storage ?? getBrowserStorage();
    this.snapshotStore = options.snapshotStore ?? new SnapshotStore(this.storage);
    this.snapshotFlushDelayMs = options.snapshotFlushDelayMs ?? SNAPSHOT_FLUSH_DELAY_MS;
  }

  initialize(): GalleryLocation {
    const currentState = this.environment.history.state;
    if (isNavigationState(currentState)) {
      this.canApplyInitialLayoutPreference = false;
      this.location = normalizeLocation(currentState.location);
      this.sessionId = typeof currentState.sessionId === 'string' ? currentState.sessionId : createSessionId();
      this.sessionIndex = Math.max(0, currentState.sessionIndex);
      const metadata = this.readSessionMetadata(this.sessionId);
      this.sessionMaxIndex = Math.max(this.sessionIndex, metadata?.maxIndex ?? 0, currentState.sessionMaxIndex);
      this.knownLocations.set(this.sessionIndex, cloneLocation(this.location));
      this.snapshotStore.restoreAuthoritative(this.location.key, currentState.snapshot);
      this.snapshotStore.flush();
      this.persistSessionMetadata();
      return cloneLocation(this.location);
    }

    this.location = parseGalleryUrl(this.environment.location.hash);
    this.canApplyInitialLayoutPreference = !hasExplicitGalleryLayout(this.environment.location.hash);
    this.sessionId = createSessionId();
    this.sessionIndex = 0;
    this.sessionMaxIndex = 0;
    this.knownLocations.clear();
    this.knownLocations.set(0, cloneLocation(this.location));
    this.write('replace', this.location);
    return cloneLocation(this.location);
  }

  getLocation(): GalleryLocation {
    return cloneLocation(this.requireLocation());
  }

  canApplyLayoutPreference(): boolean {
    return this.canApplyInitialLayoutPreference;
  }

  /** 仅纯 URL 冷启动可用；受管 History 和显式深链必须保持条目自身的布局。 */
  applyInitialLayoutPreference(layout: GalleryLayout): GalleryLocation {
    const current = this.requireLocation();
    if (!this.canApplyInitialLayoutPreference || (layout !== 'grid' && layout !== 'masonry')) return cloneLocation(current);
    this.canApplyInitialLayoutPreference = false;
    return this.replace({ ...current, key: '', layout });
  }

  /** 同一 locationKey 下仍可区分不同的受管浏览器 History 条目。 */
  getCurrentEntryIdentity(): string {
    this.requireLocation();
    return `${this.sessionId}:${this.sessionIndex}`;
  }

  canGoBack(): boolean {
    return this.sessionIndex > 0;
  }

  canGoForward(): boolean {
    return this.sessionIndex < this.sessionMaxIndex;
  }

  push(location: GalleryLocation): GalleryLocation {
    this.canApplyInitialLayoutPreference = false;
    this.flushCurrentEntry();
    const nextLocation = normalizeLocation(location);
    this.sessionIndex += 1;
    this.sessionMaxIndex = this.sessionIndex;
    for (const index of [...this.knownLocations.keys()]) {
      if (index > this.sessionIndex) this.knownLocations.delete(index);
    }
    this.location = nextLocation;
    this.knownLocations.set(this.sessionIndex, cloneLocation(nextLocation));
    this.write('push', nextLocation);
    return cloneLocation(nextLocation);
  }

  replace(location: GalleryLocation): GalleryLocation {
    this.canApplyInitialLayoutPreference = false;
    this.flushCurrentEntry();
    const nextLocation = normalizeLocation(location);
    this.location = nextLocation;
    this.knownLocations.set(this.sessionIndex, cloneLocation(nextLocation));
    this.write('replace', nextLocation);
    return cloneLocation(nextLocation);
  }

  navigate(location: GalleryLocation, mode: NavigationWriteMode = 'push'): GalleryLocation {
    return mode === 'replace' ? this.replace(location) : this.push(location);
  }

  navigatePath(folderPath: string): GalleryLocation {
    const current = this.requireLocation();
    return this.push({ ...current, key: '', view: 'folders', folderPath });
  }

  updateLocation(update: LocationUpdate, mode?: NavigationWriteMode): GalleryLocation {
    const current = this.requireLocation();
    return this.navigate({ ...current, ...update, key: '' }, mode ?? this.getUpdateMode(update));
  }

  back(): boolean {
    if (!this.canGoBack()) return false;
    this.flushCurrentEntry();
    this.environment.history.back();
    return true;
  }

  forward(): boolean {
    if (!this.canGoForward()) return false;
    this.flushCurrentEntry();
    this.environment.history.forward();
    return true;
  }

  up(): GalleryLocation | undefined {
    const current = this.requireLocation();
    const parentPath = getParentFolderPath(current.folderPath);
    if (!current.folderPath) return undefined;

    this.flushCurrentEntry();
    const previous = this.knownLocations.get(this.sessionIndex - 1);
    if (previous && previous.view === 'folders' && previous.folderPath === parentPath) {
      this.environment.history.back();
      return undefined;
    }

    return this.push({ ...current, key: '', view: 'folders', folderPath: parentPath });
  }

  applyPopState(state: unknown): GalleryLocation {
    this.canApplyInitialLayoutPreference = false;
    this.flushSnapshotStorageOnly();
    if (isNavigationState(state)) {
      const nextLocation = normalizeLocation(state.location);
      this.location = nextLocation;
      this.sessionId = typeof state.sessionId === 'string' ? state.sessionId : this.sessionId || createSessionId();
      this.sessionIndex = Math.max(0, state.sessionIndex);
      const metadata = this.readSessionMetadata(this.sessionId);
      this.sessionMaxIndex = Math.max(this.sessionIndex, metadata?.maxIndex ?? 0, state.sessionMaxIndex);
      this.knownLocations.set(this.sessionIndex, cloneLocation(nextLocation));
      this.snapshotStore.restoreAuthoritative(nextLocation.key, state.snapshot);
      this.snapshotStore.flush();
      this.persistSessionMetadata();
      return cloneLocation(nextLocation);
    }

    const fallback = parseGalleryUrl(this.environment.location.hash);
    this.location = fallback;
    this.knownLocations.set(this.sessionIndex, cloneLocation(fallback));
    return cloneLocation(fallback);
  }

  captureSnapshot(snapshot: ViewportSnapshotInput): ViewportSnapshot | undefined {
    const location = this.requireLocation();
    if (snapshot.locationKey && snapshot.locationKey !== location.key) return undefined;
    return this.saveSnapshot(snapshot);
  }

  /**
   * 查看器打开前使用的同步捕获。它必须胜过已经在节流队列中的旧滚动样本，
   * 因此版本严格领先于调用方时间、当前时钟和现存快照；普通滚动上报仍保持
   * 同时间戳后写覆盖的既有语义。
   */
  captureImmediateSnapshot(snapshot: ViewportSnapshotInput): ViewportSnapshot | undefined {
    const location = this.requireLocation();
    if (snapshot.locationKey && snapshot.locationKey !== location.key) return undefined;
    const existing = this.snapshotStore.get(location.key);
    return this.saveSnapshot({
      ...snapshot,
      capturedAt: Math.max(snapshot.capturedAt ?? -1, Date.now(), existing?.capturedAt ?? -1) + 1,
    });
  }

  private saveSnapshot(snapshot: ViewportSnapshotInput): ViewportSnapshot {
    const location = this.requireLocation();
    const stableSnapshot = this.snapshotStore.saveMemory({
      ...snapshot,
      locationKey: location.key,
      capturedAt: snapshot.capturedAt ?? Date.now(),
    });
    if (!stableSnapshot) throw new Error('视口快照格式无效');
    this.scheduleSnapshotFlush();
    return stableSnapshot;
  }

  getSnapshot(locationKey = this.requireLocation().key): ViewportSnapshot | undefined {
    return this.snapshotStore.get(locationKey);
  }

  flush(): void {
    this.flushCurrentEntry();
  }

  private getUpdateMode(update: LocationUpdate): NavigationWriteMode {
    const shouldPush = Object.prototype.hasOwnProperty.call(update, 'folderPath')
      || Object.prototype.hasOwnProperty.call(update, 'view')
      || Object.prototype.hasOwnProperty.call(update, 'search');
    return shouldPush ? 'push' : 'replace';
  }

  private scheduleSnapshotFlush(): void {
    if (this.snapshotFlushTimer) clearTimeout(this.snapshotFlushTimer);
    this.snapshotFlushTimer = setTimeout(() => this.flushCurrentEntry(), this.snapshotFlushDelayMs);
  }

  private flushCurrentEntry(): void {
    if (this.snapshotFlushTimer) {
      clearTimeout(this.snapshotFlushTimer);
      this.snapshotFlushTimer = undefined;
    }
    if (!this.location) return;
    this.snapshotStore.flush();
    this.write('replace', this.location);
  }

  private flushSnapshotStorageOnly(): void {
    if (this.snapshotFlushTimer) {
      clearTimeout(this.snapshotFlushTimer);
      this.snapshotFlushTimer = undefined;
    }
    this.snapshotStore.flush();
  }

  private write(mode: NavigationWriteMode, location: GalleryLocation): void {
    this.persistSessionMetadata();
    const activeSnapshot = this.snapshotStore.get(location.key);
    const baseState = createHistoryState(location, activeSnapshot ? {
      anchorItemId: activeSnapshot.anchorItemId,
      anchorIndex: activeSnapshot.anchorIndex,
      offsetWithinItem: activeSnapshot.offsetWithinItem,
      fallbackScrollTop: activeSnapshot.fallbackScrollTop,
      loadedOffset: activeSnapshot.loadedOffset,
      capturedAt: activeSnapshot.capturedAt,
    } : undefined);
    const state: GalleryNavigationHistoryState = {
      ...baseState,
      [NAVIGATION_STATE_MARKER]: true,
      sessionId: this.sessionId,
      sessionIndex: this.sessionIndex,
      sessionMaxIndex: this.sessionMaxIndex,
    };
    const url = serializeGalleryUrl(location);
    if (mode === 'push') this.environment.history.pushState(state, '', url);
    else this.environment.history.replaceState(state, '', url);
  }

  private readSessionMetadata(sessionId: string): NavigationSessionMetadata | undefined {
    try {
      const raw = this.storage?.getItem(NAVIGATION_SESSION_STORAGE_KEY);
      if (!raw) return undefined;
      const metadata: unknown = JSON.parse(raw);
      return isSessionMetadata(metadata) && metadata.sessionId === sessionId ? metadata : undefined;
    } catch {
      return undefined;
    }
  }

  private persistSessionMetadata(): void {
    if (!this.sessionId) return;
    try {
      this.storage?.setItem(NAVIGATION_SESSION_STORAGE_KEY, JSON.stringify({
        sessionId: this.sessionId,
        currentIndex: this.sessionIndex,
        maxIndex: this.sessionMaxIndex,
      } satisfies NavigationSessionMetadata));
    } catch {
      // 会话存储受限时退回 History 条目中的兼容字段。
    }
  }

  private requireLocation(): GalleryLocation {
    return this.location ?? this.initialize();
  }
}
