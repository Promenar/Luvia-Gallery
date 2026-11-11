import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { mediaUrls, type MediaItem, type Memories } from '@luvia/contracts';
import MemoriesPage from './MemoriesPage';

const fixture = vi.hoisted(() => ({ data: null as Memories | null, openViewer: vi.fn() }));
vi.mock('@tanstack/react-query', async (original) => ({
  ...await original<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({ data: fixture.data, isPending: false, isError: false }),
}));
vi.mock('./Hero', () => ({ Hero: () => null }));
vi.mock('./hooks', () => ({ useHeroData: () => ({}), useLibraryNames: () => new Map() }));
vi.mock('@/stores/viewer', () => ({ openViewer: fixture.openViewer }));
vi.mock('@/theme/ThemeProvider', () => ({ setDynamicFrom: () => {} }));

function media(id: string, mediaType: MediaItem['mediaType']): MediaItem {
  return {
    id, mediaType, name: id, mime: 'application/octet-stream', folder: 'photos/旅途', size: 1,
    width: null, height: null, durationSec: null, takenAt: '2020-11-11T00:00:00Z', takenAtSource: 'metadata',
    modifiedAt: 0, favorite: false, thumbhash: null, thumbVersion: 1, hasLocation: false, playability: null, hasPreview: false,
  };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); fixture.openViewer.mockClear(); });

it('重新进入首页时抽选照片或视频，重渲染保持封面并从封面位置打开查看器', () => {
  const photo = media('photo', 'image');
  const video = media('video', 'video');
  const items = [photo, video, media('audio', 'audio')];
  fixture.data = { onThisDay: [{ year: 2020, count: 3, items }], recentlyAdded: [], shuffle: [] };
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.9);
  const page = render(<MemoriesPage />);
  const card = () => screen.getByRole('button', { name: /2020 年/ });
  const cover = () => card().querySelector('img')?.getAttribute('src');
  expect(cover()).toBe(mediaUrls.thumb(video.id, 'm', video.thumbVersion));
  random.mockReturnValue(0.1);
  page.rerender(<MemoriesPage />);
  expect(cover()).toBe(mediaUrls.thumb(video.id, 'm', video.thumbVersion));
  fireEvent.click(card());
  expect(fixture.openViewer).toHaveBeenCalledWith(expect.objectContaining({ items }), 1, { originEl: card() });
  page.unmount();
  render(<MemoriesPage />);
  expect(cover()).toBe(mediaUrls.thumb(photo.id, 'm', photo.thumbVersion));
});
