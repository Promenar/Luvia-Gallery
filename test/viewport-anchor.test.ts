// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { resolveAnchorIndex, createViewportSnapshot, ViewportCaptureHandle, ViewportSnapshot } from '../components/gallery/viewport-types';
import { VirtualGallery } from '../components/VirtualGallery';
import { getMasonryInitialSkeletonCount, getMasonryPrefetchRootMargin, isWithinMasonryPrefetchRange } from '../components/gallery/MasonryViewport';
import { getGridEffectiveItemCount, getGridInitialSkeletonItemCount, GRID_SKELETON_CLASSES } from '../components/gallery/GridViewport';
import { MediaItem } from '../types';

// Mock AutoSizer to provide fixed dimensions in JSDOM
vi.mock('react-virtualized-auto-sizer', () => {
  return {
    default: (props: any) => props.children({ width: 1000, height: 800 })
  };
});

// Mock react-window to spy on scrollTo and exposed APIs
vi.mock('react-window', async () => {
  const ReactActual = await vi.importActual('react') as typeof React;
  return {
    FixedSizeGrid: ReactActual.forwardRef((props: any, ref: any) => {
      const mockGrid = {
        scrollTo: vi.fn(),
        scrollToItem: vi.fn(),
      };
      ReactActual.useImperativeHandle(ref, () => mockGrid);
      (globalThis as any).lastGridInstance = mockGrid;
      (globalThis as any).lastGridProps = props;

      // Simulate rendering items to trigger onItemsRendered
      ReactActual.useEffect(() => {
        props.onItemsRendered?.({
          visibleRowStartIndex: 0,
          visibleRowStopIndex: 5,
        });
      }, [props.items]);

      return ReactActual.createElement('div', {
        'data-testid': 'mock-grid',
        style: { width: props.width, height: props.height },
      }, 'Grid Mock');
    }),
    VariableSizeList: ReactActual.forwardRef((props: any, ref: any) => {
      const mockList = {
        scrollTo: vi.fn(),
        scrollToItem: vi.fn(),
        resetAfterIndex: vi.fn(),
      };
      ReactActual.useImperativeHandle(ref, () => mockList);
      (globalThis as any).lastListInstance = mockList;
      (globalThis as any).lastListProps = props;

      // Simulate rendering items to trigger onItemsRendered
      ReactActual.useEffect(() => {
        props.onItemsRendered?.({
          visibleStartIndex: 0,
          visibleStopIndex: 5,
        });
      }, [props.items]);

      return ReactActual.createElement('div', {
        'data-testid': 'mock-list',
        style: { width: props.width, height: props.height },
      }, 'List Mock');
    })
  };
});

// Mock language context
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'zh',
    t: (key: string) => key,
  }),
}));

describe('resolveAnchorIndex 纯函数与共享快照字段测试', () => {
  const mockItems: MediaItem[] = [
    { id: '1', name: 'img1.jpg', path: 'img1.jpg', folderPath: '', size: 100, type: 'image/jpeg', lastModified: 123, mediaType: 'image', sourceId: 'src1', url: '' },
    { id: '2', name: 'img2.jpg', path: 'img2.jpg', folderPath: '', size: 100, type: 'image/jpeg', lastModified: 123, mediaType: 'image', sourceId: 'src1', url: '' },
    { id: '3', name: 'img3.jpg', path: 'img3.jpg', folderPath: '', size: 100, type: 'image/jpeg', lastModified: 123, mediaType: 'image', sourceId: 'src1', url: '' },
    { id: '4', name: 'img4.jpg', path: 'img4.jpg', folderPath: '', size: 100, type: 'image/jpeg', lastModified: 123, mediaType: 'image', sourceId: 'src1', url: '' }
  ];

  it('应该能构造并验证共享快照字段', () => {
    const snapshot = createViewportSnapshot('key1', '3', 2, 30, 500, 10);
    expect(snapshot.locationKey).toBe('key1');
    expect(snapshot.anchorItemId).toBe('3');
    expect(snapshot.anchorIndex).toBe(2);
    expect(snapshot.offsetWithinItem).toBe(30);
    expect(snapshot.fallbackScrollTop).toBe(500);
    expect(snapshot.loadedOffset).toBe(10);
    expect(typeof snapshot.capturedAt).toBe('number');
  });

  it('应该在 snapshot 不存在时返回 0', () => {
    expect(resolveAnchorIndex(mockItems, undefined)).toBe(0);
  });

  it('优先选择 anchorItemId 并返回正确的 index', () => {
    const snapshot = createViewportSnapshot('key1', '3', 1, 30, 500, 10);
    expect(resolveAnchorIndex(mockItems, snapshot)).toBe(2); // '3' is at index 2
  });

  it('如果 anchorItemId 找不到，应 fallback 到 anchorIndex', () => {
    const snapshot = createViewportSnapshot('key1', 'non-existent', 1, 30, 500, 10);
    expect(resolveAnchorIndex(mockItems, snapshot)).toBe(1);
  });

  it('如果 anchorItemId 找不到且 anchorIndex 越界，应使用 fallbackScrollTop 兜底', () => {
    const snapshot = createViewportSnapshot('key1', 'non-existent', 10, 30, 450, 10);
    expect(resolveAnchorIndex(mockItems, snapshot)).toBe(2); // 450 / 200 = 2.25 -> 2
  });
});

describe('VirtualGallery 视口与协议流转测试', () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  const originalScrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
  let elementFromPointDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    (globalThis as any).lastGridInstance = null;
    (globalThis as any).lastListInstance = null;
    (globalThis as any).lastGridProps = null;
    (globalThis as any).lastListProps = null;
    elementFromPointDescriptor = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalScrollTopDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalScrollTopDescriptor);
    } else {
      delete (HTMLElement.prototype as any).scrollTop;
    }
    if (elementFromPointDescriptor) {
      Object.defineProperty(document, 'elementFromPoint', elementFromPointDescriptor);
    } else {
      delete (document as Document & { elementFromPoint?: unknown }).elementFromPoint;
    }
  });

  const mockItems: MediaItem[] = [
    { id: '1', name: 'img1.jpg', path: 'img1.jpg', folderPath: '', size: 100, type: 'image/jpeg', lastModified: 123, mediaType: 'image', sourceId: 'src1', url: 'blob:1' },
    { id: '2', name: 'img2.jpg', path: 'img2.jpg', folderPath: '', size: 100, type: 'image/jpeg', lastModified: 123, mediaType: 'image', sourceId: 'src1', url: 'blob:2' },
    { id: '3', name: 'img3.jpg', path: 'img3.jpg', folderPath: '', size: 100, type: 'image/jpeg', lastModified: 123, mediaType: 'image', sourceId: 'src1', url: 'blob:3' },
    { id: '4', name: 'img4.jpg', path: 'img4.jpg', folderPath: '', size: 100, type: 'image/jpeg', lastModified: 123, mediaType: 'image', sourceId: 'src1', url: 'blob:4' },
    { id: '5', name: 'img5.jpg', path: 'img5.jpg', folderPath: '', size: 100, type: 'image/jpeg', lastModified: 123, mediaType: 'image', sourceId: 'src1', url: 'blob:5' }
  ];

  const defaultProps = {
    items: mockItems,
    onItemClick: vi.fn(),
    hasNextPage: false,
    isInitialLoading: false,
    isNextPageLoading: false,
    loadNextPage: vi.fn(),
    itemCount: mockItems.length,
    onToggleFavorite: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onRegenerate: vi.fn(),
  };

  it('Grid精确offset公式测试：应根据 rowTop + offsetWithinItem 滚动到精确位置', async () => {
    vi.useFakeTimers();
    const onRestoreComplete = vi.fn();

    const snapshot = createViewportSnapshot('test-grid', '5', 4, 30, 500, 10);

    render(
      React.createElement(VirtualGallery, {
        ...defaultProps,
        layout: 'grid',
        viewKey: 'test-grid',
        restoreSnapshot: snapshot,
        onRestoreComplete
      })
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onRestoreComplete).toHaveBeenCalled();
    const gridInstance = (globalThis as any).lastGridInstance;
    expect(gridInstance).not.toBeNull();
    expect(gridInstance.scrollTo).toHaveBeenCalledWith({ scrollTop: 284 });
  });

  it('旧 timeline 输入规范化为 Grid 视口，时间线列表不再可达', async () => {
    vi.useFakeTimers();
    const onRestoreComplete = vi.fn();

    const snapshot = createViewportSnapshot('test-timeline', '2', 1, 20, 500, 10);

    render(
      React.createElement(VirtualGallery, {
        ...defaultProps,
        layout: 'timeline',
        viewKey: 'test-timeline',
        restoreSnapshot: snapshot,
        onRestoreComplete
      })
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onRestoreComplete).toHaveBeenCalled();
    expect((globalThis as any).lastGridInstance).not.toBeNull();
    expect((globalThis as any).lastListInstance).toBeNull();
  });

  it('相同快照内容不同引用只恢复一次，且当 locationKey 变化时允许重新恢复', async () => {
    vi.useFakeTimers();
    const onRestoreComplete = vi.fn();

    const snapshot1 = {
      locationKey: 'key1',
      anchorItemId: '3',
      anchorIndex: 2,
      offsetWithinItem: 30,
      fallbackScrollTop: 500,
      loadedOffset: 10,
      capturedAt: 123456789
    };

    const snapshot2 = { ...snapshot1 };

    const { rerender } = render(
      React.createElement(VirtualGallery, {
        ...defaultProps,
        layout: 'grid',
        viewKey: 'key1',
        restoreSnapshot: snapshot1,
        onRestoreComplete
      })
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onRestoreComplete).toHaveBeenCalledTimes(1);

    const gridInstance = (globalThis as any).lastGridInstance;
    expect(gridInstance.scrollTo).toHaveBeenCalledTimes(1);

    // rerender
    rerender(
      React.createElement(VirtualGallery, {
        ...defaultProps,
        layout: 'grid',
        viewKey: 'key1',
        restoreSnapshot: snapshot2,
        onRestoreComplete
      })
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onRestoreComplete).toHaveBeenCalledTimes(1);
    expect(gridInstance.scrollTo).toHaveBeenCalledTimes(1);

    // viewKey 改变
    rerender(
      React.createElement(VirtualGallery, {
        ...defaultProps,
        layout: 'grid',
        viewKey: 'key2',
        restoreSnapshot: { ...snapshot1, locationKey: 'key2', capturedAt: 999999 },
        onRestoreComplete
      })
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onRestoreComplete).toHaveBeenCalledTimes(2);
  });

  it('三种 viewport 的 reset 命令会回顶，Grid token 事务不会被 items 更新或旧回调打断', () => {
    vi.useFakeTimers();
    const onGridRestoreComplete = vi.fn();
    const onGridSnapshotChange = vi.fn();
    const { rerender: rerenderGrid } = render(React.createElement(VirtualGallery, {
      ...defaultProps,
      layout: 'grid',
      viewKey: 'folder:reset',
      restoreCommand: { token: 1, entryId: 'session:1' },
      onRestoreComplete: onGridRestoreComplete,
      onSnapshotChange: onGridSnapshotChange,
    }));
    expect((globalThis as any).lastGridInstance.scrollTo).toHaveBeenCalledWith({ scrollTop: 0 });

    rerenderGrid(React.createElement(VirtualGallery, {
      ...defaultProps,
      items: [...mockItems],
      layout: 'grid',
      viewKey: 'folder:reset',
      restoreCommand: { token: 2, entryId: 'session:2' },
      onRestoreComplete: onGridRestoreComplete,
      onSnapshotChange: onGridSnapshotChange,
    }));
    rerenderGrid(React.createElement(VirtualGallery, {
      ...defaultProps,
      items: [...mockItems],
      layout: 'grid',
      viewKey: 'folder:reset',
      restoreCommand: { token: 2, entryId: 'session:2' },
      onRestoreComplete: onGridRestoreComplete,
      onSnapshotChange: onGridSnapshotChange,
    }));
    act(() => vi.advanceTimersByTime(150));
    expect(onGridRestoreComplete).toHaveBeenCalledTimes(1);
    expect(onGridRestoreComplete).toHaveBeenLastCalledWith(2);
    act(() => {
      (globalThis as any).lastGridProps.onItemsRendered({ visibleRowStartIndex: 0, visibleRowStopIndex: 1 });
      (globalThis as any).lastGridProps.onScroll({ scrollTop: 40 });
      vi.advanceTimersByTime(250);
    });
    expect(onGridSnapshotChange).toHaveBeenCalled();

    const onLegacyTimelineRestoreComplete = vi.fn();
    const { unmount: unmountLegacyTimeline } = render(React.createElement(VirtualGallery, {
      ...defaultProps,
      layout: 'timeline',
      viewKey: 'folder:timeline-reset',
      restoreCommand: { token: 3, entryId: 'session:3' },
      onRestoreComplete: onLegacyTimelineRestoreComplete,
    }));
    expect((globalThis as any).lastGridInstance).not.toBeNull();
    expect((globalThis as any).lastListInstance).toBeNull();
    act(() => vi.advanceTimersByTime(150));
    expect(onLegacyTimelineRestoreComplete).toHaveBeenLastCalledWith(3);
    unmountLegacyTimeline();

    let resetScrollTop = -1;
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      get: () => resetScrollTop,
      set: (value: number) => { resetScrollTop = value; },
      configurable: true,
    });
    const onMasonryRestoreComplete = vi.fn();
    render(React.createElement(VirtualGallery, {
      ...defaultProps,
      layout: 'masonry',
      viewKey: 'folder:masonry-reset',
      restoreCommand: { token: 4, entryId: 'session:4' },
      onRestoreComplete: onMasonryRestoreComplete,
    }));
    expect(resetScrollTop).toBe(0);
    act(() => vi.advanceTimersByTime(150));
    expect(onMasonryRestoreComplete).toHaveBeenLastCalledWith(4);
  });

  it('Grid 同步捕获会取消待发节流样本，并在 viewKey 切换后清除旧锚点', () => {
    vi.useFakeTimers();
    const galleryRef = React.createRef<ViewportCaptureHandle>();
    const onSnapshotChange = vi.fn();
    const { rerender } = render(
      React.createElement(VirtualGallery, {
        ...defaultProps,
        ref: galleryRef,
        layout: 'grid',
        viewKey: 'folder:albums',
        onSnapshotChange,
      })
    );

    act(() => {
      (globalThis as any).lastGridProps.onItemsRendered({ visibleRowStartIndex: 1, visibleRowStopIndex: 3 });
      (globalThis as any).lastGridProps.onScroll({ scrollTop: 650 });
    });

    expect(galleryRef.current?.captureSnapshot()).toMatchObject({
      locationKey: 'folder:albums',
      anchorItemId: '5',
      anchorIndex: 4,
      fallbackScrollTop: 650,
    });
    act(() => vi.advanceTimersByTime(250));
    expect(onSnapshotChange).not.toHaveBeenCalled();

    rerender(React.createElement(VirtualGallery, {
      ...defaultProps,
      items: [],
      itemCount: 0,
      ref: galleryRef,
      layout: 'grid',
      viewKey: 'folder:albums:media',
      onSnapshotChange,
    }));
    expect(galleryRef.current?.captureSnapshot()).toMatchObject({
      locationKey: 'folder:albums:media',
      anchorItemId: undefined,
      fallbackScrollTop: 0,
    });
  });

  it('旧 timeline 输入使用 Grid 的同步捕获与 reset 协议', () => {
    vi.useFakeTimers();
    const galleryRef = React.createRef<ViewportCaptureHandle>();
    const onSnapshotChange = vi.fn();
    const { rerender } = render(React.createElement(VirtualGallery, {
      ...defaultProps,
      ref: galleryRef,
      layout: 'timeline',
      viewKey: 'folder:timeline',
      onSnapshotChange,
    }));

    act(() => {
      (globalThis as any).lastGridProps.onItemsRendered({ visibleRowStartIndex: 1, visibleRowStopIndex: 2 });
      (globalThis as any).lastGridProps.onScroll({ scrollTop: 420 });
    });

    expect(galleryRef.current?.captureSnapshot()).toMatchObject({
      locationKey: 'folder:timeline',
      fallbackScrollTop: 420,
    });
    act(() => vi.advanceTimersByTime(250));
    expect(onSnapshotChange).not.toHaveBeenCalled();

    rerender(React.createElement(VirtualGallery, { ...defaultProps, items: [], itemCount: 0, ref: galleryRef, layout: 'timeline', viewKey: 'folder:timeline:media', onSnapshotChange }));
    expect(galleryRef.current?.captureSnapshot()).toMatchObject({ locationKey: 'folder:timeline:media', anchorItemId: undefined, fallbackScrollTop: 0 });
    rerender(React.createElement(VirtualGallery, { ...defaultProps, items: [], itemCount: 0, ref: galleryRef, layout: 'timeline', viewKey: 'folder:timeline', onSnapshotChange }));
    expect(galleryRef.current?.captureSnapshot()).toMatchObject({ locationKey: 'folder:timeline', anchorItemId: undefined, fallbackScrollTop: 0 });
  });

  it('Masonry 优先使用 elementFromPoint，深度滚动采样失败时不复用旧锚点', () => {
    vi.useFakeTimers();
    let samplingAvailable = true;
    Element.prototype.getBoundingClientRect = function(this: HTMLElement) {
      if (this.classList.contains('overflow-y-auto')) {
        return { top: 0, bottom: 800, left: 0, right: 1000, width: 1000, height: 800 } as DOMRect;
      }
      if (this.hasAttribute('data-item-id')) {
        const id = this.getAttribute('data-item-id');
        const top = samplingAvailable && id === '2' ? 30 : 1_800;
        return { top, bottom: top + 200, left: 0, right: 200, width: 200, height: 200 } as DOMRect;
      }
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 } as DOMRect;
    };
    const galleryRef = React.createRef<ViewportCaptureHandle>();
    const onSnapshotChange = vi.fn();
    const { rerender } = render(React.createElement(VirtualGallery, {
      ...defaultProps,
      ref: galleryRef,
      layout: 'masonry',
      viewKey: 'folder:masonry',
      onSnapshotChange,
    }));

    const container = document.querySelector('.overflow-y-auto') as HTMLDivElement;
    const sampledItem = container.querySelector('[data-item-id="2"]');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => samplingAvailable ? sampledItem : null),
    });
    fireEvent.scroll(container);

    expect(galleryRef.current?.captureSnapshot()).toMatchObject({
      locationKey: 'folder:masonry',
      anchorItemId: '2',
      anchorIndex: 1,
      fallbackScrollTop: 0,
    });
    expect(document.elementFromPoint).toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    expect(onSnapshotChange).not.toHaveBeenCalled();

    samplingAvailable = false;
    container.scrollTop = 1_200;
    expect(galleryRef.current?.captureSnapshot()).toMatchObject({
      locationKey: 'folder:masonry',
      anchorItemId: undefined,
      anchorIndex: undefined,
      offsetWithinItem: 0,
      fallbackScrollTop: 1_200,
    });

    rerender(React.createElement(VirtualGallery, {
      ...defaultProps,
      items: [],
      itemCount: 0,
      ref: galleryRef,
      layout: 'masonry',
      viewKey: 'folder:masonry:media',
      onSnapshotChange,
    }));
    expect(galleryRef.current?.captureSnapshot()).toMatchObject({
      locationKey: 'folder:masonry:media',
      anchorItemId: undefined,
      offsetWithinItem: 0,
      fallbackScrollTop: 1200,
    });
    rerender(React.createElement(VirtualGallery, { ...defaultProps, items: [], itemCount: 0, ref: galleryRef, layout: 'masonry', viewKey: 'folder:masonry', onSnapshotChange }));
    expect(galleryRef.current?.captureSnapshot()).toMatchObject({ locationKey: 'folder:masonry', anchorItemId: undefined, fallbackScrollTop: 1200 });
  });

  it('Masonry 正负号语义与滚动恢复测试', async () => {
    vi.useFakeTimers();
    const onRestoreComplete = vi.fn();

    // Mock elements client rect for items and container
    Element.prototype.getBoundingClientRect = function(this: HTMLElement) {
      if (this.hasAttribute('data-item-id')) {
        const itemId = this.getAttribute('data-item-id');
        return { top: itemId === '2' ? 120 : 300, bottom: 400, left: 0, right: 0, width: 200, height: 200 } as DOMRect;
      }
      return { top: 0, bottom: 800, left: 0, right: 0, width: 1000, height: 800 } as DOMRect;
    };

    let setScrollTopVal = 0;
    Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
      get: () => 100,
      set: vi.fn((val) => {
        setScrollTopVal = val;
      }),
      configurable: true
    });

    const snapshot = createViewportSnapshot('test-masonry', '2', 1, 15, 500, 10);

    render(
      React.createElement(VirtualGallery, {
        ...defaultProps,
        layout: 'masonry',
        viewKey: 'test-masonry',
        restoreSnapshot: snapshot,
        onRestoreComplete
      })
    );

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onRestoreComplete).toHaveBeenCalled();
    expect(setScrollTopVal).toBe(235);
  });

  it('Masonry 初始加载使用覆盖约两个视口的几何骨架，续页按列保留占位', () => {
    const initial = render(React.createElement(VirtualGallery, {
      ...defaultProps,
      items: [],
      itemCount: 0,
      isInitialLoading: true,
      isNextPageLoading: true,
      layout: 'masonry',
      viewKey: 'all:masonry:initial',
    }));
    expect(initial.queryAllByTestId('masonry-initial-skeleton').length).toBeGreaterThanOrEqual(16);
    expect(initial.queryAllByTestId('masonry-next-skeleton')).toHaveLength(0);
    initial.unmount();

    const continuation = render(React.createElement(VirtualGallery, {
      ...defaultProps,
      isInitialLoading: false,
      isNextPageLoading: true,
      layout: 'masonry',
      viewKey: 'all:masonry:next',
    }));
    expect(continuation.queryAllByTestId('masonry-next-skeleton')).toHaveLength(12);
  });

  it('Masonry 骨架数量随视口和列数计算，并在距离底部 1.5 个视口时预取', () => {
    const count = getMasonryInitialSkeletonCount(5, 900, 1200);
    expect(count % 5).toBe(0);
    expect(count).toBeGreaterThanOrEqual(40);
    expect(isWithinMasonryPrefetchRange(5000, 2400, 1000)).toBe(false);
    expect(isWithinMasonryPrefetchRange(5000, 2500, 1000)).toBe(true);
    expect(getMasonryPrefetchRootMargin(800)).toBe('0px 0px 1200px 0px');
  });

  it('Grid 在总数尚未返回时仍生成至少一个可见视口的骨架行', () => {
    const skeletonCount = getGridInitialSkeletonItemCount(4, 800, 216);
    expect(skeletonCount).toBe(20);

    render(React.createElement(VirtualGallery, {
      ...defaultProps,
      items: [],
      itemCount: 0,
      isInitialLoading: true,
      layout: 'grid',
      viewKey: 'all:grid:initial',
    }));
    expect((globalThis as any).lastGridProps.rowCount).toBeGreaterThan(0);
  });

  it('Grid 首载骨架阶段不触发续页，完整首包出现后才允许近底预取', async () => {
    const loadNextPage = vi.fn().mockResolvedValue(undefined);
    const view = render(React.createElement(VirtualGallery, {
      ...defaultProps,
      items: [],
      itemCount: 0,
      hasNextPage: true,
      isInitialLoading: true,
      loadNextPage,
      layout: 'grid',
      viewKey: 'all:grid:initial-prefetch',
    }));
    await act(async () => Promise.resolve());
    expect(loadNextPage).not.toHaveBeenCalled();

    view.rerender(React.createElement(VirtualGallery, {
      ...defaultProps,
      hasNextPage: true,
      isInitialLoading: false,
      loadNextPage,
      layout: 'grid',
      viewKey: 'all:grid:initial-prefetch',
    }));
    act(() => (globalThis as any).lastGridProps.onItemsRendered({
      visibleRowStartIndex: 0,
      visibleRowStopIndex: 5,
    }));
    await act(async () => Promise.resolve());
    expect(loadNextPage).toHaveBeenCalledTimes(1);
  });

  it('Grid 续页加载时至少在已加载数据后预留两整行骨架', () => {
    expect(getGridEffectiveItemCount(121, 120, 4, true)).toBe(128);
    expect(getGridEffectiveItemCount(900_000, 120, 4, true)).toBe(900_000);
    expect(getGridEffectiveItemCount(121, 120, 4, false)).toBe(121);
    expect(GRID_SKELETON_CLASSES).toContain('bg-white/[0.045]');
    expect(GRID_SKELETON_CLASSES).not.toContain('border');
    expect(GRID_SKELETON_CLASSES).not.toContain('bg-white/3');
  });

  it('Masonry IO 预取失败后，下一次近底滚动可以重新请求', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 16) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => clearTimeout(frameId));
    const loadNextPage = vi.fn()
      .mockRejectedValueOnce(new Error('network failed'))
      .mockResolvedValueOnce(undefined);
    render(React.createElement(VirtualGallery, {
      ...defaultProps,
      hasNextPage: true,
      loadNextPage,
      layout: 'masonry',
      viewKey: 'all:masonry:retry',
    }));
    const container = document.querySelector('.overflow-y-auto') as HTMLDivElement;
    Object.defineProperties(container, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 800 },
      scrollTop: { configurable: true, writable: true, value: 100 },
    });

    fireEvent.scroll(container);
    await act(async () => {
      vi.advanceTimersByTime(20);
      await Promise.resolve();
    });
    expect(loadNextPage).toHaveBeenCalledTimes(1);

    container.scrollTop = 200;
    fireEvent.scroll(container);
    await act(async () => {
      vi.advanceTimersByTime(20);
      await Promise.resolve();
    });
    expect(loadNextPage).toHaveBeenCalledTimes(2);
  });

  it('Masonry 首载阶段忽略 IO，首载结束后重建观察器并恢复预取', async () => {
    const observerCallbacks: IntersectionObserverCallback[] = [];
    class FakeIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds = [0];
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    const loadNextPage = vi.fn().mockResolvedValue(undefined);
    const view = render(React.createElement(VirtualGallery, {
      ...defaultProps,
      items: [],
      itemCount: 0,
      hasNextPage: true,
      isInitialLoading: true,
      loadNextPage,
      layout: 'masonry',
      viewKey: 'all:masonry:initial-prefetch',
    }));
    expect(observerCallbacks.length).toBeGreaterThan(0);
    act(() => observerCallbacks.at(-1)?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(loadNextPage).not.toHaveBeenCalled();

    view.rerender(React.createElement(VirtualGallery, {
      ...defaultProps,
      hasNextPage: true,
      isInitialLoading: false,
      loadNextPage,
      layout: 'masonry',
      viewKey: 'all:masonry:initial-prefetch',
    }));
    await act(async () => Promise.resolve());
    expect(observerCallbacks.length).toBeGreaterThan(1);
    act(() => observerCallbacks.at(-1)?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(loadNextPage).toHaveBeenCalledTimes(1);
  });
});
