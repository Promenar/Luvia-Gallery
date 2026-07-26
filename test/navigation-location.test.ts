import { describe, expect, it } from 'vitest';
import { createHistoryState } from '../navigation/history-state';
import { createLocationKey, getParentFolderPath, parseGalleryUrl, serializeGalleryUrl } from '../navigation/location';

describe('导航领域模型', () => {
  it('解析旧版 #folder 深链并兼容 Windows 风格路径', () => {
    const location = parseGalleryUrl('#folder=%E6%9E%9C%E5%BA%93/C%3A%5CAlbums%5C2026');
    expect(location.view).toBe('folders');
    expect(location.folderPath).toBe('果库/C:/Albums/2026');
  });

  it('序列化链接包含 folders 深链兼容字段', () => {
    const location = {
      key: '',
      view: 'folders' as const,
      folderPath: 'Vacation/2026',
      search: 'cat',
      sort: 'nameAsc' as const,
      filter: 'video' as const,
      layout: 'grid' as const,
      randomSeed: 'seed-01',
      mediaId: 'm-1',
    };
    const url = serializeGalleryUrl(location);

    expect(url).toContain('#folder=Vacation%2F2026');
    expect(url).toContain('view=folders');
    expect(url).toContain('sort=nameAsc');
    expect(url).toContain('q=cat');
    expect(parseGalleryUrl(url).mediaId).toBe('m-1');
    expect(parseGalleryUrl(url).randomSeed).toBe('seed-01');
  });

  it('统一标准键对同一路径 Windows 与 Unix 分隔符保持一致', () => {
    const unixLocation = {
      key: '',
      view: 'folders' as const,
      folderPath: 'Albums/2026/Trip',
      search: '',
      sort: 'dateDesc' as const,
      filter: 'all' as const,
      layout: 'grid' as const,
    };
    const windowsLocation = {
      key: '',
      view: 'folders' as const,
      folderPath: 'Albums\\2026\\Trip',
      search: '',
      sort: 'dateDesc' as const,
      filter: 'all' as const,
      layout: 'grid' as const,
    };

    expect(createLocationKey(unixLocation)).toBe(createLocationKey(windowsLocation));
  });

  it('获取父目录时保留跨平台路径语义', () => {
    expect(getParentFolderPath('Albums/2026/Trip')).toBe('Albums/2026');
    expect(getParentFolderPath('C:\\Albums\\2026\\Trip')).toBe('C:/Albums/2026');
    expect(getParentFolderPath('')).toBe('');
    expect(getParentFolderPath('A')).toBe('');
    expect(getParentFolderPath('/media/2026/Images')).toBe('/media/2026');
    expect(getParentFolderPath('/media')).toBe('');
    expect(getParentFolderPath('/')).toBe('');
  });

  it('POSIX 根路径保持序列化与反序列化', () => {
    const root = parseGalleryUrl('#folder=%2F');
    expect(root.folderPath).toBe('/');
    expect(serializeGalleryUrl(root)).toBe('#folder=%2F&view=folders');
    expect(parseGalleryUrl(serializeGalleryUrl(root)).folderPath).toBe('/');
  });

  it('POSIX 绝对路径保留开头斜杠并往返', () => {
    const location = parseGalleryUrl('#folder=%2Fmedia%2Fx');
    expect(location.folderPath).toBe('/media/x');
    expect(location.view).toBe('folders');

    const locationWithMedia = parseGalleryUrl('#folder=%2Fmedia');
    expect(locationWithMedia.folderPath).toBe('/media');
    expect(serializeGalleryUrl(locationWithMedia)).toBe('#folder=%2Fmedia&view=folders');
  });

  it('支持 /vol2/媒体 和 Windows 盘符路径往返', () => {
    const vol2 = parseGalleryUrl('#folder=%2Fvol2%2F%E5%AA%92%E4%BD%93');
    expect(vol2.folderPath).toBe('/vol2/媒体');
    expect(parseGalleryUrl(serializeGalleryUrl(vol2)).folderPath).toBe('/vol2/媒体');

    const windows = parseGalleryUrl('#folder=C%3A%5CAlbums');
    expect(windows.folderPath).toBe('C:/Albums');
    expect(parseGalleryUrl(serializeGalleryUrl(windows)).folderPath).toBe('C:/Albums');
  });

  it('裸 % 目录名不抛错并可往返', () => {
    const location = parseGalleryUrl('#folder=%2Fmedia%2F100%25%E5%AE%8C%E6%88%90');
    expect(location.folderPath).toBe('/media/100%完成');
    expect(parseGalleryUrl(serializeGalleryUrl(location)).folderPath).toBe('/media/100%完成');
  });

  it('malformed percent 输入降级处理', () => {
    const location = parseGalleryUrl('#folder=%E4%');
    expect(typeof location.folderPath).toBe('string');
    expect(location.folderPath.length).toBeGreaterThan(0);
  });

  it('createHistoryState 不应包含媒体数组等不可序列化数据', () => {
    const location = {
      key: '',
      view: 'all' as const,
      folderPath: '',
      search: '',
      sort: 'dateDesc' as const,
      filter: 'all' as const,
      layout: 'timeline' as const,
    };
    const snapshot = {
      anchorItemId: 'm-1',
      anchorIndex: 3,
      offsetWithinItem: 45,
      fallbackScrollTop: 220,
      loadedOffset: 30,
      capturedAt: 111,
    };
    const state = createHistoryState(location, snapshot);
    const serialized = JSON.stringify(state);

    expect(serialized.includes('"media":')).toBe(false);
    expect(serialized.includes('mediaFiles')).toBe(false);
    expect(state.location.key).toBe(createLocationKey(location));
    expect(state.snapshot?.locationKey).toBe(state.location.key);
  });
});
