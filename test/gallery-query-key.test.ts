import { describe, expect, it } from 'vitest';
import { createGalleryQueryKey, type GalleryQueryKeyInput } from '../navigation/query-key';

describe('createGalleryQueryKey', () => {
  const createInput = (patch: Partial<GalleryQueryKeyInput>): GalleryQueryKeyInput => ({
    username: 'alice',
    view: 'folders',
    folderPath: 'album/travel',
    search: 'sunset',
    sort: 'dateDesc',
    filter: 'all',
    randomSeed: 1,
    ...patch,
  });

  it('在纯查询相关字段变更时应产出不同的查询键', () => {
    const base = createGalleryQueryKey(createInput({}));
    const usernameChanged = createGalleryQueryKey(createInput({ username: 'bob' }));
    const viewChanged = createGalleryQueryKey(createInput({ view: 'all' }));
    const folderPathChanged = createGalleryQueryKey(createInput({ folderPath: 'album/work' }));
    const searchChanged = createGalleryQueryKey(createInput({ search: 'city' }));
    const sortChanged = createGalleryQueryKey(createInput({ sort: 'nameAsc' }));
    const filterChanged = createGalleryQueryKey(createInput({ filter: 'video' }));
    const seedChanged = createGalleryQueryKey(createInput({ randomSeed: 2 }));

    const keys = [
      base,
      usernameChanged,
      viewChanged,
      folderPathChanged,
      searchChanged,
      sortChanged,
      filterChanged,
      seedChanged,
    ].map((item) => JSON.stringify(item));

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('filter 变化必须隔离服务端数据缓存，layout 变化继续复用同一查询键', () => {
    const withFilter = createGalleryQueryKey(createInput({ filter: 'video' }));
    const withDifferentFilter = createGalleryQueryKey(createInput({ filter: 'image' }));
    const withLayoutGrid = createGalleryQueryKey(createInput({ filter: 'video', layout: 'grid' }));
    const withLayoutTimeline = createGalleryQueryKey(createInput({ filter: 'video', layout: 'timeline' }));

    expect(withFilter).not.toEqual(withDifferentFilter);
    expect(withFilter).toEqual(withLayoutGrid);
    expect(withFilter).toEqual(withLayoutTimeline);
  });

  it('打开媒体和切换布局不会改变数据集身份', () => {
    const base = createGalleryQueryKey(createInput({ layout: 'grid' }));
    const mediaOpened = createGalleryQueryKey(createInput({ layout: 'grid', mediaId: 'media-1' }));
    const mediaSwitched = createGalleryQueryKey(createInput({ layout: 'grid', mediaId: 'media-2' }));
    const layoutChanged = createGalleryQueryKey(createInput({ layout: 'masonry', mediaId: 'media-2' }));

    expect(mediaOpened).toEqual(base);
    expect(mediaSwitched).toEqual(base);
    expect(layoutChanged).toEqual(base);
  });

  it('应输出路径规范化后的稳定键', () => {
    const normalized = createGalleryQueryKey(createInput({ folderPath: 'albums//trip//' }));
    const normalizedWithSpaces = createGalleryQueryKey(createInput({ folderPath: ' /albums/ /trip/' }));
    const leadingSlash = createGalleryQueryKey(createInput({ folderPath: '/albums/trip' }));

    expect(normalized).toEqual(leadingSlash);
    expect(normalized).toEqual(normalizedWithSpaces);
  });
});
