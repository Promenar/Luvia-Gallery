// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { VirtualGallery } from '../components/VirtualGallery';
import { GridViewport } from '../components/gallery/GridViewport';
import { MasonryViewport } from '../components/gallery/MasonryViewport';
import type { ViewportCaptureHandle } from '../components/gallery/viewport-types';
import { MediaItem } from '../types';

// 渲染执行计数探针（React 19 的 Profiler.onRender 在整树 memo 拦截时仍会触发，不可用）：
// - autoSizer：GridViewport 的渲染函数每次执行都会以新的 children 重渲染 AutoSizer；
//   memo 拦截后 GridViewport 渲染函数不执行，该计数不变。
// - folderCard：MasonryViewport 每次渲染都会为 folder 卡片重建 folder 对象字面量，
//   突破 FolderCard 自身的 memo；memo 拦截后 MasonryViewport 渲染函数不执行，该计数不变。
const counters = vi.hoisted(() => ({ autoSizer: 0, folderCard: 0 }));

vi.mock('react-virtualized-auto-sizer', () => {
  return {
    default: (props: any) => {
      counters.autoSizer += 1;
      return props.children({ width: 1000, height: 800 });
    }
  };
});

vi.mock('../components/FolderCard', () => ({
  FolderCard: () => {
    counters.folderCard += 1;
    return null;
  },
}));

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
      return ReactActual.createElement('div', {
        'data-testid': 'mock-list',
        style: { width: props.width, height: props.height },
      }, 'List Mock');
    })
  };
});

vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'zh',
    t: (key: string) => key,
  }),
}));

const mockItems: MediaItem[] = [
  { id: 'folder-1', name: '相册', path: 'folder-1', folderPath: '', size: 0, type: 'application/x-directory', lastModified: 123, mediaType: 'folder', sourceId: 'src1', url: '' },
  { id: '2', name: 'img2.jpg', path: 'img2.jpg', folderPath: '', size: 100, type: 'image/jpeg', lastModified: 123, mediaType: 'image', sourceId: 'src1', url: 'blob:2' },
  { id: '3', name: 'img3.jpg', path: 'img3.jpg', folderPath: '', size: 100, type: 'image/jpeg', lastModified: 123, mediaType: 'image', sourceId: 'src1', url: 'blob:3' },
  { id: '4', name: 'img4.jpg', path: 'img4.jpg', folderPath: '', size: 100, type: 'image/jpeg', lastModified: 123, mediaType: 'image', sourceId: 'src1', url: 'blob:4' },
];

const baseProps = {
  items: mockItems,
  onItemClick: vi.fn(),
  hasNextPage: false,
  isInitialLoading: false,
  isNextPageLoading: false,
  loadNextPage: vi.fn(),
  itemCount: mockItems.length,
  mediaHoverZoomEnabled: true,
  onToggleFavorite: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onRegenerate: vi.fn(),
};

beforeEach(() => {
  counters.autoSizer = 0;
  counters.folderCard = 0;
  (globalThis as any).lastGridInstance = null;
  (globalThis as any).lastGridProps = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('VirtualGallery 视口 memo 性能隔离', () => {
  it('props 不变时父级重复重渲染被 memo 拦截，GridViewport 渲染函数不执行', () => {
    const { rerender } = render(<VirtualGallery {...baseProps} layout="grid" viewKey="memo:grid" />);
    const afterMount = counters.autoSizer;
    expect(afterMount).toBeGreaterThan(0);

    // 模拟播放器 item 切换：父级（GalleryApp 整树）重渲染，但所有 props 引用不变
    rerender(<VirtualGallery {...baseProps} layout="grid" viewKey="memo:grid" />);
    rerender(<VirtualGallery {...baseProps} layout="grid" viewKey="memo:grid" />);
    expect(counters.autoSizer).toBe(afterMount);
  });

  it('items 引用变化时 VirtualGallery 正常重渲染（memo 不会吞掉数据更新）', () => {
    const { rerender } = render(<VirtualGallery {...baseProps} layout="grid" viewKey="memo:grid-update" />);
    const afterMount = counters.autoSizer;

    rerender(<VirtualGallery {...baseProps} items={[...mockItems]} itemCount={mockItems.length + 1} layout="grid" viewKey="memo:grid-update" />);
    expect(counters.autoSizer).toBeGreaterThan(afterMount);
  });

  it('VirtualGallery masonry 路径：props 不变时拦截，items 变化时放行', () => {
    const { rerender } = render(<VirtualGallery {...baseProps} layout="masonry" viewKey="memo:masonry" />);
    const afterMount = counters.folderCard;
    expect(afterMount).toBeGreaterThan(0);

    rerender(<VirtualGallery {...baseProps} layout="masonry" viewKey="memo:masonry" />);
    expect(counters.folderCard).toBe(afterMount);

    rerender(<VirtualGallery {...baseProps} items={[...mockItems]} layout="masonry" viewKey="memo:masonry" />);
    expect(counters.folderCard).toBeGreaterThan(afterMount);
  });

  it('memo 拦截下 ref 透传仍工作：captureSnapshot 可同步取样', () => {
    const galleryRef = React.createRef<ViewportCaptureHandle>();
    const { rerender } = render(
      <VirtualGallery {...baseProps} ref={galleryRef} layout="grid" viewKey="memo:ref" />
    );

    act(() => {
      (globalThis as any).lastGridProps.onItemsRendered({ visibleRowStartIndex: 1, visibleRowStopIndex: 3 });
      (globalThis as any).lastGridProps.onScroll({ scrollTop: 650 });
    });
    expect(galleryRef.current?.captureSnapshot()).toMatchObject({
      locationKey: 'memo:ref',
      anchorItemId: '4',
      anchorIndex: 3,
      fallbackScrollTop: 650,
    });

    // 无关父级重渲染被 memo 拦截后，imperative handle 与快照能力不受影响
    rerender(<VirtualGallery {...baseProps} ref={galleryRef} layout="grid" viewKey="memo:ref" />);
    expect(galleryRef.current?.captureSnapshot()).toMatchObject({
      locationKey: 'memo:ref',
      anchorItemId: '4',
      anchorIndex: 3,
      fallbackScrollTop: 650,
    });
  });

  it('memo 拦截下 restoreCommand 传入路径仍工作：reset 命令回顶并回调 token', () => {
    vi.useFakeTimers();
    const onRestoreComplete = vi.fn();
    const { rerender } = render(
      <VirtualGallery
        {...baseProps}
        layout="grid"
        viewKey="memo:restore"
        restoreCommand={{ token: 7, entryId: 'session:7' }}
        onRestoreComplete={onRestoreComplete}
      />
    );
    expect((globalThis as any).lastGridInstance.scrollTo).toHaveBeenCalledWith({ scrollTop: 0 });

    // 播放器切换期间父级重渲染（props 引用不变），恢复事务不受 memo 拦截影响地完成
    rerender(
      <VirtualGallery
        {...baseProps}
        layout="grid"
        viewKey="memo:restore"
        restoreCommand={{ token: 7, entryId: 'session:7' }}
        onRestoreComplete={onRestoreComplete}
      />
    );
    act(() => vi.advanceTimersByTime(150));
    expect(onRestoreComplete).toHaveBeenCalledTimes(1);
    expect(onRestoreComplete).toHaveBeenLastCalledWith(7);
  });

  it('GridViewport 直接挂载时同样被 memo 拦截无关父级重渲染', () => {
    const props = { ...baseProps, viewKey: 'memo:grid-direct' };
    const { rerender } = render(<GridViewport {...props} />);
    const afterMount = counters.autoSizer;

    rerender(<GridViewport {...props} />);
    expect(counters.autoSizer).toBe(afterMount);

    rerender(<GridViewport {...props} items={[...mockItems]} />);
    expect(counters.autoSizer).toBeGreaterThan(afterMount);
  });

  it('MasonryViewport 直接挂载时同样被 memo 拦截无关父级重渲染', () => {
    const props = { ...baseProps, viewKey: 'memo:masonry-direct' };
    const { rerender } = render(<MasonryViewport {...props} />);
    const afterMount = counters.folderCard;
    expect(afterMount).toBeGreaterThan(0);

    rerender(<MasonryViewport {...props} />);
    expect(counters.folderCard).toBe(afterMount);

    rerender(<MasonryViewport {...props} items={[...mockItems]} />);
    expect(counters.folderCard).toBeGreaterThan(afterMount);
  });
});
