import { describe, expect, it } from 'vitest';
import {
  buildHomeFeaturedQuery,
  composeGalleryFolderItems,
  resolveGalleryRandomSeed,
  withGalleryRandomSeed,
} from '../App';
import { selectHomeFeaturedItems } from '../components/Home';
import { cleanTokenFromUrl, seededShuffle } from '../utils/fileUtils';
import type { MediaItem } from '../types';

const media = (id: string, overrides: Partial<MediaItem> = {}): MediaItem => ({
  id,
  name: `${id}.jpg`,
  path: `/library/${id}.jpg`,
  folderPath: '/library',
  url: `/api/file/${id}`,
  type: 'image/jpeg',
  mediaType: 'image',
  size: 1,
  lastModified: 1,
  sourceId: 'local',
  ...overrides,
});

describe('随机排序种子', () => {
  it('切到随机排序生成新种子，离开随机排序清除种子，其它更新不受影响', () => {
    expect(withGalleryRandomSeed({ sort: 'random' }, () => '99')).toEqual({ sort: 'random', randomSeed: '99' });
    expect(withGalleryRandomSeed({ sort: 'dateDesc' }, () => '99')).toEqual({ sort: 'dateDesc', randomSeed: undefined });
    expect(withGalleryRandomSeed({ search: 'cat' }, () => '99')).toEqual({ search: 'cat' });
  });

  it('非法种子回退为 0', () => {
    expect(resolveGalleryRandomSeed('123')).toBe(123);
    expect(resolveGalleryRandomSeed(undefined)).toBe(0);
    expect(resolveGalleryRandomSeed('-1')).toBe(0);
    expect(resolveGalleryRandomSeed('abc')).toBe(0);
  });

  it('确定性洗牌同种子同结果且不丢项', () => {
    const items = Array.from({ length: 20 }, (_, index) => media(`m${index}`));
    const first = seededShuffle(items, 5).map(item => item.id);
    expect(seededShuffle(items, 5).map(item => item.id)).toEqual(first);
    expect(new Set(first).size).toBe(20);
    expect(seededShuffle(items, 6).map(item => item.id)).not.toEqual(first);
  });
});

describe('目录视图组合顺序', () => {
  it('文件夹恒定置顶，媒体保持数据源顺序，追加分页不改变文件夹位置', () => {
    const folders = [
      media('folder-b', { name: 'b', mediaType: 'folder', lastModified: 5 }),
      media('folder-a', { name: 'a', mediaType: 'folder', lastModified: 9 }),
    ];
    const firstPage = [media('new', { lastModified: 10 }), media('old', { lastModified: 1 })];
    const ids = composeGalleryFolderItems(folders, firstPage, 'dateDesc').map(item => item.id);
    expect(ids).toEqual(['folder-a', 'folder-b', 'new', 'old']);

    const withNextPage = composeGalleryFolderItems(folders, [...firstPage, media('older', { lastModified: 0 })], 'dateDesc');
    expect(withNextPage.slice(0, 2).map(item => item.id)).toEqual(['folder-a', 'folder-b']);
  });

  it('随机排序时文件夹按名称排列', () => {
    const folders = [media('f2', { name: 'zeta', mediaType: 'folder' }), media('f1', { name: 'alpha', mediaType: 'folder' })];
    expect(composeGalleryFolderItems(folders, [], 'random').map(item => item.id)).toEqual(['f1', 'f2']);
  });
});

describe('首页轮播', () => {
  it('按首页模式生成服务端取样查询并排除音频', () => {
    expect(buildHomeFeaturedQuery({ mode: 'random' })).toBe('/api/scan/results?offset=0&limit=24&excludeMediaType=audio&random=true');
    expect(buildHomeFeaturedQuery({ mode: 'favorites' })).toContain('&favorites=true&random=true');
    expect(buildHomeFeaturedQuery({ mode: 'folder', path: '/library/旅行' })).toContain(`&folder=${encodeURIComponent('/library/旅行')}&recursive=true`);
    expect(buildHomeFeaturedQuery({ mode: 'single', path: '/library/a/b.jpg' })).toContain('&search=b.jpg');
    expect(buildHomeFeaturedQuery({ mode: 'folder' })).toContain('&random=true');
  });

  it('选择素材时排除音频，单图模式精确命中，收藏为空时不回退全库', () => {
    const items = [
      media('a', { path: '/library/x/a.jpg', folderPath: '/library/x' }),
      media('b', { path: '/library/y/b.jpg', folderPath: '/library/y', isFavorite: true }),
      media('song', { mediaType: 'audio' }),
    ];
    expect(selectHomeFeaturedItems(items, { mode: 'random' }, 1).map(item => item.id).sort()).toEqual(['a', 'b']);
    expect(selectHomeFeaturedItems(items, { mode: 'single', path: '/library/y/b.jpg' }, 1).map(item => item.id)).toEqual(['b']);
    expect(selectHomeFeaturedItems(items, { mode: 'folder', path: '/library/x' }, 1).map(item => item.id)).toEqual(['a']);
    expect(selectHomeFeaturedItems(items, { mode: 'favorites' }, 1).map(item => item.id)).toEqual(['b']);
    expect(selectHomeFeaturedItems([items[0]], { mode: 'favorites' }, 1)).toEqual([]);
  });

  it('同一会话种子下轮播顺序稳定', () => {
    const items = Array.from({ length: 15 }, (_, index) => media(`p${index}`));
    const first = selectHomeFeaturedItems(items, { mode: 'random' }, 3).map(item => item.id);
    expect(first).toHaveLength(10);
    expect(selectHomeFeaturedItems(items, { mode: 'random' }, 3).map(item => item.id)).toEqual(first);
  });
});

describe('令牌参数清理', () => {
  it('移除任意位置的 token 参数并保留其它参数与片段', () => {
    expect(cleanTokenFromUrl('/api/thumb/a?token=x&t=1')).toBe('/api/thumb/a?t=1');
    expect(cleanTokenFromUrl('/api/thumb/a?t=1&token=x')).toBe('/api/thumb/a?t=1');
    expect(cleanTokenFromUrl('/api/thumb/a?token=x')).toBe('/api/thumb/a');
    expect(cleanTokenFromUrl('/api/thumb/a?token=x#frag')).toBe('/api/thumb/a#frag');
    expect(cleanTokenFromUrl('/api/thumb/a')).toBe('/api/thumb/a');
  });
});

describe('网格几何', () => {
  it('手机宽度至少 3 列、4px 间距；桌面按 200px 目标列宽与 16px 间距', async () => {
    const { resolveGridMetrics } = await import('../components/gallery/GridViewport');
    expect(resolveGridMetrics(343)).toEqual({ gutter: 4, columnCount: 3 });
    expect(resolveGridMetrics(300)).toEqual({ gutter: 4, columnCount: 3 });
    expect(resolveGridMetrics(600)).toEqual({ gutter: 4, columnCount: 5 });
    expect(resolveGridMetrics(1200)).toEqual({ gutter: 16, columnCount: 5 });
    expect(resolveGridMetrics(640)).toEqual({ gutter: 16, columnCount: 3 });
  });
});
