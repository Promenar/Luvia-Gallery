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

  it('popstate 命中旧快照只发布一次，消费后清空恢复命令', () => {
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
    expect(restored?.capturedAt).toBe(600);
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state })));
    expect(api!.restoreSnapshot).toBe(restored);
    act(() => api!.consumeRestoreSnapshot());
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
    const requested = api!.restoreSnapshot;
    expect(requested?.capturedAt).toBe(700);
    act(() => api!.requestRestore(makeSnapshot(700)));
    expect(api!.restoreSnapshot).toBe(requested);
    act(() => api!.captureSnapshot(makeSnapshot(701)));
    expect(api!.restoreSnapshot).toBe(requested);
    act(() => root.unmount());
  });
});
