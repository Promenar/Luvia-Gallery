// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import { resolveAnchorIndex, createViewportSnapshot, ViewportSnapshot } from '../components/gallery/viewport-types';
import { VirtualGallery } from '../components/VirtualGallery';
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

  beforeEach(() => {
    (globalThis as any).lastGridInstance = null;
    (globalThis as any).lastListInstance = null;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalScrollTopDescriptor) {
      Object.defineProperty(HTMLElement.prototype, 'scrollTop', originalScrollTopDescriptor);
    } else {
      delete (HTMLElement.prototype as any).scrollTop;
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

  it('Timeline精确offset公式测试：应累加视觉行前缀高度滚动到精确位置', async () => {
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
    const listInstance = (globalThis as any).lastListInstance;
    expect(listInstance).not.toBeNull();
    expect(listInstance.scrollTo).toHaveBeenCalledWith(70);
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
});
