import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useGalleryNavigation, type GalleryNavigationApi } from '../hooks/useGalleryNavigation';
import { GalleryNavigationController, type NavigationEnvironment } from '../navigation/navigation-controller';
import { SnapshotStore, type StorageLike } from '../navigation/snapshot-store';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const createEnvironment = (storage = new MemoryStorage()): NavigationEnvironment => ({
  history: window.history,
  location: window.location,
  storage,
});

const createController = (storage = new MemoryStorage(), snapshotFlushDelayMs = 320) => {
  const environment = createEnvironment(storage);
  return new GalleryNavigationController({
    environment,
    snapshotStore: new SnapshotStore(storage),
    snapshotFlushDelayMs,
  });
};

const makeSnapshot = (capturedAt: number) => ({
  anchorItemId: 'media-1',
  anchorIndex: 8,
  offsetWithinItem: 12,
  fallbackScrollTop: 420,
  loadedOffset: 100,
  capturedAt,
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', '#folder=Albums');
});

describe('GalleryNavigationController', () => {
  it('回退后刷新仍从独立会话元数据正确判断可以前进', () => {
    const storage = new MemoryStorage();
    const controller = createController(storage);
    controller.initialize();
    controller.navigatePath('Albums/2026');
    const parentState = window.history.state;
    controller.updateLocation({ search: 'sunset' });

    const reloaded = createController(storage);
    reloaded.applyPopState(parentState);
    expect(reloaded.canGoBack()).toBe(true);
    expect(reloaded.canGoForward()).toBe(true);
  });

  it('目录与搜索使用 push，排序筛选布局使用 replace', () => {
    const controller = createController();
    controller.initialize();
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    controller.navigatePath('A\\B');
    controller.updateLocation({ search: 'cat' });
    controller.updateLocation({ sort: 'nameAsc' });
    controller.updateLocation({ filter: 'video' });
    controller.updateLocation({ layout: 'masonry' });
    expect(controller.getLocation().folderPath).toBe('A/B');
    expect(push).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledTimes(8);
  });

  it('仅无受管 History 且 URL 未显式指定布局的冷启动可应用偏好', () => {
    window.history.replaceState(null, '', '#');
    const coldStart = createController();
    coldStart.initialize();
    expect(coldStart.applyInitialLayoutPreference('masonry').layout).toBe('masonry');

    const managed = createController();
    managed.initialize();
    expect(managed.applyInitialLayoutPreference('grid').layout).toBe('masonry');

    window.history.replaceState(null, '', '#layout=masonry');
    const explicitUrl = createController();
    explicitUrl.initialize();
    expect(explicitUrl.applyInitialLayoutPreference('grid').layout).toBe('masonry');
  });

  it('上一级的上一条是父目录时优先使用浏览器后退', () => {
    window.history.replaceState(null, '', '#folder=A');
    const controller = createController();
    controller.initialize();
    controller.navigatePath('A/B');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    controller.up();
    expect(back).toHaveBeenCalledOnce();
  });

  it('上一级的上一条不是父目录时创建父目录位置', () => {
    const controller = createController();
    controller.initialize();
    controller.updateLocation({ search: 'cat' }, 'push');
    controller.navigatePath('A/B');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    controller.up();
    expect(back).not.toHaveBeenCalled();
    expect(controller.getLocation().folderPath).toBe('A');
  });

  it('快照捕获只更新内存，并在 trailing debounce 后一并写入 History 与存储', () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const controller = createController(storage, 300);
    controller.initialize();
    const replace = vi.spyOn(window.history, 'replaceState');
    replace.mockClear();
    controller.captureSnapshot(makeSnapshot(100));
    controller.captureSnapshot(makeSnapshot(101));
    expect(replace).not.toHaveBeenCalled();
    expect(storage.getItem('luvia.gallery.viewport-snapshots.v1')).toBeNull();
    vi.advanceTimersByTime(299);
    expect(replace).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(replace).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.getItem('luvia.gallery.viewport-snapshots.v1')!)[0].capturedAt).toBe(101);
  });

  it('导航前会同步 flush，确保最新离开位置不丢失', () => {
    vi.useFakeTimers();
    const storage = new MemoryStorage();
    const controller = createController(storage, 400);
    controller.initialize();
    controller.captureSnapshot(makeSnapshot(222));
    controller.navigatePath('Albums/child');
    expect(JSON.parse(storage.getItem('luvia.gallery.viewport-snapshots.v1')!)[0].capturedAt).toBe(222);
    expect(window.history.state.location.folderPath).toBe('Albums/child');
  });

  it('普通异步捕获拒绝来源 locationKey 与当前目录不一致的样本', () => {
    const controller = createController();
    controller.initialize();

    expect(controller.captureSnapshot({ ...makeSnapshot(300), locationKey: 'folders:stale' })).toBeUndefined();
    expect(controller.captureImmediateSnapshot({ ...makeSnapshot(300), locationKey: 'folders:stale' })).toBeUndefined();
    expect(controller.getSnapshot()).toBeUndefined();
  });

  it('受管 History 空快照或错 key 会清除目标路径的旧缓存', () => {
    const controller = createController();
    controller.initialize();
    controller.captureSnapshot(makeSnapshot(800));
    controller.flush();
    const state = window.history.state;

    controller.applyPopState({ ...state, snapshot: undefined });
    expect(controller.getSnapshot()).toBeUndefined();

    controller.captureSnapshot(makeSnapshot(900));
    controller.applyPopState({ ...state, snapshot: { ...state.snapshot, locationKey: 'folders:wrong' } });
    expect(controller.getSnapshot()).toBeUndefined();
  });

  it('受管 History 初始化覆盖 sessionStorage 的较新快照并立即持久化', () => {
    const storage = new MemoryStorage();
    const original = createController(storage);
    const location = original.initialize();
    original.captureSnapshot(makeSnapshot(100));
    original.flush();
    const historyState = window.history.state;
    new SnapshotStore(storage).save({ ...makeSnapshot(900), locationKey: location.key });

    const refreshed = createController(storage);
    refreshed.initialize();
    expect(refreshed.getSnapshot()).toMatchObject({ capturedAt: 100 });

    const reloaded = createController(storage);
    reloaded.initialize();
    expect(reloaded.getSnapshot()).toMatchObject({ capturedAt: 100 });
    expect(historyState.snapshot.capturedAt).toBe(100);
  });

  it('popstate 使用目标 History 条目的快照覆盖同 key 的较新全局样本', () => {
    const controller = createController();
    controller.initialize();
    controller.captureSnapshot(makeSnapshot(100));
    controller.flush();
    const targetState = window.history.state;
    controller.captureSnapshot(makeSnapshot(900));
    expect(controller.getSnapshot()?.capturedAt).toBe(900);

    controller.applyPopState(targetState);
    expect(controller.getSnapshot()).toMatchObject({ capturedAt: 100, fallbackScrollTop: 420 });
  });

  it('同一路径两次打开查看器分别恢复打开前位置，旧节流快照不能覆盖第二次捕获', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
    const controller = createController();
    const directory = controller.initialize();
    const replace = vi.spyOn(window.history, 'replaceState');

    controller.captureImmediateSnapshot({ ...makeSnapshot(1_000), anchorItemId: 'media-a', fallbackScrollTop: 120 });
    controller.updateLocation({ mediaId: 'viewer-a' }, 'push');
    const firstDirectoryState = replace.mock.calls.at(-1)![0];
    controller.applyPopState(firstDirectoryState);
    expect(controller.getSnapshot(directory.key)).toMatchObject({ anchorItemId: 'media-a', fallbackScrollTop: 120 });

    controller.captureImmediateSnapshot({ ...makeSnapshot(1_000), anchorItemId: 'media-b', fallbackScrollTop: 860 });
    controller.captureSnapshot({ ...makeSnapshot(1_000), anchorItemId: 'stale-media', fallbackScrollTop: 420 });
    controller.updateLocation({ mediaId: 'viewer-b' }, 'push');
    const secondDirectoryState = replace.mock.calls.at(-1)![0];
    controller.applyPopState(secondDirectoryState);

    expect(controller.getSnapshot(directory.key)).toMatchObject({ anchorItemId: 'media-b', fallbackScrollTop: 860 });
    expect((secondDirectoryState as { snapshot?: { anchorItemId?: string } }).snapshot?.anchorItemId).toBe('media-b');
  });

  it('首次即时捕获即使没有现存快照，也会领先同毫秒的旧节流样本', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2_000));
    const controller = createController();
    controller.initialize();

    const immediate = controller.captureImmediateSnapshot({ ...makeSnapshot(2_000), anchorItemId: 'opened-media', fallbackScrollTop: 720 });
    controller.captureSnapshot({ ...makeSnapshot(2_000), anchorItemId: 'pending-media', fallbackScrollTop: 360 });

    expect(immediate).toMatchObject({ capturedAt: 2_001 });
    expect(controller.getSnapshot()).toMatchObject({ anchorItemId: 'opened-media', fallbackScrollTop: 720, capturedAt: 2_001 });
  });

  it('连续捕获快照不会发布恢复命令或触发 Hook 重渲染，并在卸载时清理监听和 flush', () => {
    let api: GalleryNavigationApi | undefined;
    let renders = 0;
    const storage = new MemoryStorage();
    const controller = createController(storage, 10_000);
    const host = document.createElement('div');
    const root: Root = createRoot(host);
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const Probe = () => {
      renders += 1;
      api = useGalleryNavigation({ controller });
      return null;
    };

    act(() => root.render(createElement(Probe)));
    const before = api!.restoreSnapshot;
    const renderCount = renders;
    act(() => { api!.captureSnapshot(makeSnapshot(500)); });
    act(() => { api!.captureSnapshot({ ...makeSnapshot(500), fallbackScrollTop: 999 }); });
    expect(renders).toBe(renderCount);
    expect(before).toBeUndefined();
    expect(api!.restoreSnapshot).toBeUndefined();
    expect(api!.currentSnapshot).toBeUndefined();
    expect(api!.getSnapshot()?.fallbackScrollTop).toBe(999);
    act(() => root.unmount());
    expect(JSON.parse(storage.getItem('luvia.gallery.viewport-snapshots.v1')!)[0].capturedAt).toBe(500);
    expect(removeListener).toHaveBeenCalledWith('popstate', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('pagehide', expect.any(Function));
  });

  it('每次 popstate 都发布独立恢复命令，消费后清空恢复命令', () => {
    let api: GalleryNavigationApi | undefined;
    const controller = createController();
    controller.initialize();
    controller.captureSnapshot(makeSnapshot(600));
    controller.flush();
    const state = window.history.state;
    controller.navigatePath('Albums/child');
    const host = document.createElement('div');
    const root: Root = createRoot(host);
    const Probe = () => {
      api = useGalleryNavigation({ controller });
      return null;
    };

    act(() => root.render(createElement(Probe)));
    expect(api!.restoreSnapshot).toBeUndefined();
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state })));
    const restored = api!.restoreSnapshot;
    const firstCommand = api!.restoreCommand;
    expect(restored?.capturedAt).toBe(600);
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state })));
    expect(api!.restoreSnapshot).toMatchObject({ capturedAt: 600 });
    expect(api!.restoreCommand?.token).toBeGreaterThan(firstCommand!.token);
    act(() => api!.consumeRestoreSnapshot(api!.restoreCommand!.token));
    expect(api!.restoreSnapshot).toBeUndefined();
    expect(api!.currentSnapshot).toBeUndefined();
    act(() => root.unmount());
  });

  it('requestRestore 显式发布一次恢复命令，普通捕获不会覆盖它', () => {
    let api: GalleryNavigationApi | undefined;
    const controller = createController();
    const host = document.createElement('div');
    const root: Root = createRoot(host);
    const Probe = () => {
      api = useGalleryNavigation({ controller });
      return null;
    };

    act(() => root.render(createElement(Probe)));
    act(() => api!.requestRestore(makeSnapshot(700)));
    const firstCommand = api!.restoreCommand;
    act(() => api!.requestRestore({ ...makeSnapshot(700), fallbackScrollTop: 999 }));
    const requested = api!.restoreSnapshot;
    expect(requested).toMatchObject({ capturedAt: 700, fallbackScrollTop: 999 });
    expect(api!.restoreCommand?.token).toBeGreaterThan(firstCommand!.token);
    act(() => api!.consumeRestoreSnapshot(firstCommand!.token));
    expect(api!.restoreSnapshot).toBe(requested);
    act(() => api!.captureSnapshot(makeSnapshot(701)));
    expect(api!.restoreSnapshot).toBe(requested);
    expect(api!.requestRestore({ ...makeSnapshot(702), locationKey: 'folders:stale' })).toBeUndefined();
    expect(api!.restoreSnapshot).toBe(requested);
    act(() => root.unmount());
  });

  it('普通跨目录进入无快照位置时仍发布 reset 命令', () => {
    let api: GalleryNavigationApi | undefined;
    const controller = createController();
    const host = document.createElement('div');
    const root: Root = createRoot(host);
    const Probe = () => {
      api = useGalleryNavigation({ controller });
      return null;
    };
    act(() => root.render(createElement(Probe)));

    act(() => api!.navigatePath('Albums/empty-child'));
    expect(api!.restoreCommand).toMatchObject({
      entryId: expect.stringContaining(':1'),
      snapshot: undefined,
    });
    expect(api!.restoreSnapshot).toBeUndefined();
    act(() => root.unmount());
  });

  it('SnapshotStore 拒绝损坏数值字段并保留合法的小数与负偏移', () => {
    const store = new SnapshotStore(new MemoryStorage());
    const valid = {
      locationKey: 'folders:valid',
      anchorIndex: 2,
      offsetWithinItem: -12.5,
      fallbackScrollTop: 420.25,
      loadedOffset: 100,
      capturedAt: 800,
    };
    expect(store.saveMemory(valid)).toMatchObject(valid);
    expect(store.saveMemory({ ...valid, capturedAt: Number.NaN })).toBeUndefined();
    expect(store.saveMemory({ ...valid, fallbackScrollTop: Infinity })).toBeUndefined();
    expect(store.saveMemory({ ...valid, anchorIndex: -1 })).toBeUndefined();
    expect(store.saveMemory({ ...valid, anchorIndex: 1.5 })).toBeUndefined();
    expect(store.saveMemory({ ...valid, loadedOffset: -1 })).toBeUndefined();
    expect(store.saveMemory({ ...valid, loadedOffset: 1.5 })).toBeUndefined();
    expect(store.saveMemory({ ...valid, capturedAt: -1 })).toBeUndefined();
    expect(store.saveMemory({ ...valid, capturedAt: 1.5 })).toBeUndefined();
  });

  it('同一路径的不同受管 History 条目在 popstate 时分别恢复，空快照发布 reset 命令', () => {
    let api: GalleryNavigationApi | undefined;
    const controller = createController();
    const location = controller.initialize();
    controller.captureSnapshot({ ...makeSnapshot(800), anchorItemId: 'entry-a', fallbackScrollTop: 120 });
    controller.flush();
    const firstEntry = window.history.state;

    controller.navigate(controller.getLocation(), 'push');
    controller.captureSnapshot({ ...makeSnapshot(800), anchorItemId: 'entry-b', fallbackScrollTop: 880 });
    controller.flush();
    const secondEntry = window.history.state;
    expect(firstEntry.location.key).toBe(secondEntry.location.key);

    const host = document.createElement('div');
    const root: Root = createRoot(host);
    const Probe = () => {
      api = useGalleryNavigation({ controller });
      return null;
    };
    act(() => root.render(createElement(Probe)));

    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: firstEntry })));
    const firstCommand = api!.restoreCommand;
    expect(firstCommand).toMatchObject({
      entryId: `${firstEntry.sessionId}:${firstEntry.sessionIndex}`,
      snapshot: { locationKey: location.key, anchorItemId: 'entry-a', fallbackScrollTop: 120 },
    });

    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: secondEntry })));
    const secondCommand = api!.restoreCommand;
    expect(secondCommand).toMatchObject({
      entryId: `${secondEntry.sessionId}:${secondEntry.sessionIndex}`,
      snapshot: { locationKey: location.key, anchorItemId: 'entry-b', fallbackScrollTop: 880 },
    });
    expect(secondCommand!.token).toBeGreaterThan(firstCommand!.token);

    act(() => window.dispatchEvent(new PopStateEvent('popstate', {
      state: { ...firstEntry, snapshot: undefined },
    })));
    expect(api!.restoreCommand).toMatchObject({
      entryId: `${firstEntry.sessionId}:${firstEntry.sessionIndex}`,
      snapshot: undefined,
    });
    expect(api!.restoreCommand!.token).toBeGreaterThan(secondCommand!.token);
    expect(api!.restoreSnapshot).toBeUndefined();
    act(() => root.unmount());
  });
});
