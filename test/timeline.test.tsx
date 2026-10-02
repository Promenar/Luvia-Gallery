import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TIMELINE_HEADER_HEIGHT,
  TIMELINE_PAGE_SIZE,
  buildTimelineRows,
  buildYearMarks,
  collectNeededPages,
  computeRowOffsets,
  findHeaderRows,
  findRowAtOffset,
  formatBucketLabel,
  resolveTimelineGrid,
  type TimelineBucket,
} from '../components/gallery/timeline-layout';
import { buildTimelineScopeQuery } from '../App';
import { readGalleryLayoutPreference, writeGalleryLayoutPreference } from '../navigation/layout-preference';
import { getAvailableLayouts, normalizeLayoutForView } from '../navigation/location';
import { GalleryNavigationBar } from '../components/navigation/GalleryNavigationBar';
import { TimelineScrubber } from '../components/TimelineScrubber';
import { LanguageProvider } from '../contexts/LanguageContext';

afterEach(() => cleanup());

const bucket = (key: string, count: number): TimelineBucket => ({ key, count, start: 0, end: 1 });

describe('时间线几何', () => {
  it('每月一个标题行加 ceil(数量/列数) 个媒体行，空月跳过', () => {
    const rows = buildTimelineRows([bucket('2026-09', 7), bucket('2026-08', 0), bucket('2026-07', 3)], 3);
    expect(rows.map(row => row.kind === 'header' ? `H${row.bucketIndex}` : `M${row.bucketIndex}:${row.startIndex}+${row.length}`))
      .toEqual(['H0', 'M0:0+3', 'M0:3+3', 'M0:6+1', 'H2', 'M2:0+3']);
  });

  it('百万级计数只生成行描述，不依赖媒体条目', () => {
    const rows = buildTimelineRows([bucket('2026-01', 1_000_000)], 6);
    expect(rows).toHaveLength(1 + Math.ceil(1_000_000 / 6));
  });

  it('偏移前缀和与二分定位一致', () => {
    const rows = buildTimelineRows([bucket('2026-09', 4), bucket('2026-08', 2)], 2);
    const offsets = computeRowOffsets(rows, 100);
    expect(offsets).toEqual([0, TIMELINE_HEADER_HEIGHT, TIMELINE_HEADER_HEIGHT + 100, TIMELINE_HEADER_HEIGHT + 200, 2 * TIMELINE_HEADER_HEIGHT + 200, 2 * TIMELINE_HEADER_HEIGHT + 300]);
    expect(findRowAtOffset(offsets, 0)).toBe(0);
    expect(findRowAtOffset(offsets, TIMELINE_HEADER_HEIGHT + 150)).toBe(2);
    expect(findRowAtOffset(offsets, 10_000)).toBe(rows.length - 1);
    expect(findHeaderRows(rows).get(1)).toBe(3);
  });

  it('可见行映射到去重的“月 + 页”，跨页的行同时请求两页', () => {
    const rows = buildTimelineRows([bucket('2026-09', TIMELINE_PAGE_SIZE + 10)], 7);
    const crossing = rows.findIndex(row => row.kind === 'media' && row.startIndex <= TIMELINE_PAGE_SIZE - 1 && row.startIndex + row.length > TIMELINE_PAGE_SIZE);
    expect(collectNeededPages(rows, 0, 2)).toEqual([{ bucketIndex: 0, page: 0 }]);
    expect(collectNeededPages(rows, crossing, crossing)).toEqual([{ bucketIndex: 0, page: 0 }, { bucketIndex: 0, page: 1 }]);
  });

  it('网格列数：手机至少 3 列，桌面按目标列宽', () => {
    expect(resolveTimelineGrid(343).columns).toBe(3);
    expect(resolveTimelineGrid(343).gap).toBe(4);
    expect(resolveTimelineGrid(1200).columns).toBe(6);
  });

  it('年份刻度落在每年首个章节位置，章节文案中英文正确', () => {
    const buckets = [bucket('2026-09', 3), bucket('2026-01', 3), bucket('2025-12', 3)];
    const rows = buildTimelineRows(buckets, 3);
    const offsets = computeRowOffsets(rows, 100);
    const marks = buildYearMarks(buckets, rows, offsets);
    expect(marks.map(mark => mark.year)).toEqual(['2026', '2025']);
    expect(marks[0].ratio).toBe(0);
    expect(marks[1].ratio).toBeGreaterThan(0.5);
    expect(formatBucketLabel('2026-09', 'zh')).toBe('2026 年 9 月');
    expect(formatBucketLabel('2026-09', 'en')).toBe('September 2026');
  });
});

describe('时间线范围与布局开关', () => {
  it('范围查询串包含收藏、媒体类型与搜索', () => {
    expect(buildTimelineScopeQuery({ view: 'all', filter: 'all', search: '' })).toBe('');
    expect(buildTimelineScopeQuery({ view: 'favorites', filter: 'video', search: ' 海边 ' }))
      .toBe(`&favorites=true&mediaType=video&search=${encodeURIComponent('海边')}`);
  });

  it('时间线只在全部照片与收藏夹可用', () => {
    expect(getAvailableLayouts('all')).toContain('timeline');
    expect(getAvailableLayouts('folders')).not.toContain('timeline');
    expect(normalizeLayoutForView('timeline', 'folders')).toBe('grid');
    expect(normalizeLayoutForView('timeline', 'favorites')).toBe('timeline');
  });

  it('作用域布局偏好可记住时间线，文件夹视图不写入', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
    writeGalleryLayoutPreference(storage, { serverId: 's', userId: 'u', view: 'all' }, 'timeline');
    expect(readGalleryLayoutPreference(storage, { serverId: 's', userId: 'u', view: 'all' })).toBe('timeline');
    writeGalleryLayoutPreference(storage, { serverId: 's', userId: 'u', view: 'folders' }, 'timeline');
    expect(readGalleryLayoutPreference(storage, { serverId: 's', userId: 'u', view: 'folders' })).toBeUndefined();
  });

  it('全部照片视图的布局菜单提供时间线', () => {
    const onLayoutChange = vi.fn();
    render(
      <GalleryNavigationBar
        canGoBack canGoForward={false} onBack={vi.fn()} onForward={vi.fn()} onUp={vi.fn()} onScrollToTop={vi.fn()}
        view="all" layoutMode="grid" onLayoutChange={onLayoutChange} onSearch={vi.fn()} onSortChange={vi.fn()}
      />,
      { wrapper: LanguageProvider },
    );
    fireEvent.click(screen.getByLabelText(/切换布局|Change layout/));
    fireEvent.click(screen.getByText(/^(时间线|Timeline)$/));
    expect(onLayoutChange).toHaveBeenCalledWith('timeline');
  });
});

describe('时间拖动条', () => {
  it('键盘上下键按步长跳转，Home/End 到两端', () => {
    const onScrub = vi.fn();
    render(<TimelineScrubber marks={[{ year: '2026', ratio: 0 }]} progress={0.5} onScrub={onScrub} labelAt={() => '2026 年 9 月'} ariaLabel="时间线拖动条" />);
    const scrubber = screen.getByRole('scrollbar', { name: '时间线拖动条' });
    fireEvent.keyDown(scrubber, { key: 'ArrowDown' });
    fireEvent.keyDown(scrubber, { key: 'PageUp' });
    fireEvent.keyDown(scrubber, { key: 'End' });
    expect(onScrub.mock.calls.map(([ratio]) => Number(ratio.toFixed(2)))).toEqual([0.52, 0.4, 1]);
    expect(scrubber.getAttribute('aria-valuetext')).toBe('2026 年 9 月');
  });
});
