import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaItem } from '@luvia/contracts';
import { GRID_GAP } from '@/components/media/MediaGrid';
import type { JustifiedRow } from '@/components/media/justify';
import { ShuffleWall, fillShuffleRows } from './ShuffleWall';

const fixture = vi.hoisted(() => ({
  data: undefined as { items: MediaItem[] } | undefined,
  isPending: false,
  isError: false,
  error: null as unknown,
  isFetching: false,
  refetch: vi.fn(),
  openViewer: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (original) => ({
  ...await original<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({
    data: fixture.data,
    isPending: fixture.isPending,
    isError: fixture.isError,
    error: fixture.error,
    isFetching: fixture.isFetching,
    refetch: fixture.refetch,
  }),
}));

vi.mock('@/components/media/MediaGrid', () => ({
  GRID_GAP: 4,
  useRowHeight: () => 180,
  useElementWidth: () => [() => {}, 1000],
}));

vi.mock('@/lib/dimensions', () => ({
  useDimensionsVersion: () => 0,
  useWantDimensions: () => {},
}));

vi.mock('@/stores/viewer', () => ({ openViewer: fixture.openViewer }));
vi.mock('@/theme/ThemeProvider', () => ({ setDynamicFrom: () => {} }));
vi.mock('sonner', () => ({ toast: { error: fixture.toastError } }));

function media(id: string, mediaType: MediaItem['mediaType'] = 'image'): MediaItem {
  return {
    id, mediaType, name: id, mime: 'application/octet-stream', folder: 'photos/旅途', size: 1,
    width: 1200, height: 800, durationSec: mediaType === 'video' ? 42 : null,
    takenAt: '2020-11-11T00:00:00Z', takenAtSource: 'metadata', modifiedAt: 0,
    favorite: false, thumbhash: null, thumbVersion: 1, hasLocation: false, playability: null, hasPreview: false,
  };
}

function row(height: number, ids: string[], top: number): JustifiedRow<MediaItem> {
  return {
    height,
    top,
    cells: ids.map((id, index) => ({ item: media(id), index, width: 100, height })),
  };
}

function scrollHarness(height = 900): HTMLElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientHeight', { value: height, configurable: true });
  return element;
}

beforeEach(() => {
  fixture.data = { items: [] };
  fixture.isPending = false;
  fixture.isError = false;
  fixture.error = null;
  fixture.isFetching = false;
  fixture.refetch.mockReset().mockResolvedValue({ isError: false });
  fixture.openViewer.mockClear();
  fixture.toastError.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('fillShuffleRows', () => {
  it('按真实行高补满视口，并把整组行收进屏内', () => {
    const rows = [160, 160, 160, 160, 160, 160].map((height, index) => row(height, [`m${index}`], index * 164));
    const fill = fillShuffleRows(rows, 56, 900, GRID_GAP);
    expect(fill.rows).toHaveLength(6);
    expect(fill.scale).toBeLessThan(1);
    const gaps = GRID_GAP * (fill.rows.length - 1);
    const scaled = fill.rows.reduce((sum, item) => sum + Math.round(item.height * fill.scale), 0) + gaps;
    expect(Math.abs(scaled - (900 - 56))).toBeLessThanOrEqual(2);
    expect(fill.shown.map((item) => item.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5']);
  });

  it('行数不足时不放大，交给区块最小高度补满', () => {
    const fill = fillShuffleRows([row(120, ['a'], 0), row(120, ['b'], 124)], 56, 900, GRID_GAP);
    expect(fill.rows).toHaveLength(2);
    expect(fill.scale).toBe(1);
    expect(fill.shown.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('尚未测量到视口或没有行时返回空，避免首帧错误铺排', () => {
    expect(fillShuffleRows([row(120, ['a'], 0)], 56, 0, GRID_GAP)).toEqual({ rows: [], scale: 1, shown: [] });
    expect(fillShuffleRows([], 56, 900, GRID_GAP)).toEqual({ rows: [], scale: 1, shown: [] });
  });
});

describe('ShuffleWall', () => {
  it('换一批保持旧批次并触发独立随机查询', async () => {
    fixture.data = { items: [media('photo'), media('clip', 'video')] };
    render(<ShuffleWall scrollElement={scrollHarness()} />);
    expect(screen.getByRole('heading', { name: '随便看看' })).toBeTruthy();
    expect(screen.getByText('0:42')).toBeTruthy();
    const button = screen.getByRole('button', { name: '换一批随机照片和视频' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(fixture.refetch).toHaveBeenCalledTimes(1));
  });

  it('换一批失败时保留上一批并提示', async () => {
    fixture.data = { items: [media('photo'), media('clip', 'video')] };
    fixture.refetch.mockResolvedValueOnce({ isError: true, error: new Error('boom') });
    render(<ShuffleWall scrollElement={scrollHarness()} />);
    fireEvent.click(screen.getByRole('button', { name: '换一批随机照片和视频' }));
    await waitFor(() => expect(screen.getByText('换一批失败，已保留上一批')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'photo' })).toBeTruthy();
    expect(fixture.toastError).toHaveBeenCalledWith('没有换成功，请稍后再试');
  });

  it('空媒体库显示空态并禁用换一批', () => {
    fixture.data = { items: [] };
    render(<ShuffleWall scrollElement={scrollHarness()} />);
    expect(screen.getByText('媒体库里还没有照片或视频')).toBeTruthy();
    const button = screen.getByRole('button', { name: '换一批随机照片和视频' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('初次加载失败显示重试入口', () => {
    fixture.data = undefined;
    fixture.isError = true;
    fixture.error = new Error('boom');
    render(<ShuffleWall scrollElement={scrollHarness()} />);
    expect(screen.getByText(/随便看看没有加载出来：boom/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }));
    expect(fixture.refetch).toHaveBeenCalledTimes(1);
  });

  it('点击缩略图以当前可见批次打开查看器', () => {
    fixture.data = { items: [media('photo'), media('clip', 'video')] };
    render(<ShuffleWall scrollElement={scrollHarness()} />);
    fireEvent.click(screen.getByRole('button', { name: 'photo' }));
    const [scope, index] = fixture.openViewer.mock.calls[0] as [{ label: string; items: MediaItem[] }, number];
    expect(scope.label).toBe('随便看看');
    expect(scope.items.map((item) => item.id)).toEqual(['photo', 'clip']);
    expect(index).toBe(0);
  });
});
