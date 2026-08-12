import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaCard, areMediaCardPropsEqual, getMediaCardContainerClasses, getMediaImageLoadingProps, resolveMediaAspectRatio, useStableMediaItemClick } from '../components/PhotoCard';
import { LanguageProvider } from '../contexts/LanguageContext';
import { MediaItem } from '../types';

afterEach(() => cleanup());

const createMediaItem = (overrides: Partial<MediaItem> = {}): MediaItem => ({
  id: 'stable-media-id',
  name: 'image.jpg',
  path: 'image.jpg',
  folderPath: '',
  size: 100,
  type: 'image/jpeg',
  lastModified: 1,
  mediaType: 'image',
  sourceId: 'local',
  url: '/api/file/stable-media-id',
  ...overrides,
});

describe('MediaCard 布局间距', () => {
  it('瀑布流卡片不再提供额外底部外边距，间距仅由 Masonry gap-4 控制', () => {
    expect(getMediaCardContainerClasses(false)).not.toContain('mb-6');
    expect(getMediaCardContainerClasses(false)).toContain('break-inside-avoid');
    expect(getMediaCardContainerClasses(true)).toContain('aspect-square');
    expect(getMediaCardContainerClasses(false, false)).not.toContain('ring-1');
  });

  it('优先使用服务端比例并将异常极端值夹取到安全范围', () => {
    expect(resolveMediaAspectRatio(createMediaItem({ aspectRatio: 1.25, width: 1, height: 10 }))).toBe(1.25);
    expect(resolveMediaAspectRatio(createMediaItem({ aspectRatio: 9 }))).toBe(2.4);
    expect(resolveMediaAspectRatio(createMediaItem({ aspectRatio: 0.1 }))).toBe(0.5);
  });

  it('比例缺失时先使用宽高，再按媒体 ID 生成稳定回退值', () => {
    expect(resolveMediaAspectRatio(createMediaItem({ width: 1600, height: 1000 }))).toBe(1.6);
    const first = resolveMediaAspectRatio(createMediaItem());
    const second = resolveMediaAspectRatio(createMediaItem());
    expect(second).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0.5);
    expect(first).toBeLessThanOrEqual(2.4);
  });

  it('只让首屏少量图片抢占加载优先级，其余图片异步懒加载', () => {
    expect(getMediaImageLoadingProps(true)).toEqual({
      loading: 'eager',
      fetchPriority: 'high',
      decoding: 'async',
    });
    expect(getMediaImageLoadingProps(false)).toEqual({
      loading: 'lazy',
      fetchPriority: 'auto',
      decoding: 'async',
    });
  });

  it('缩略图地址或几何元数据变化时不能被 memo 比较器吞掉', () => {
    const onClick = () => undefined;
    const base = { item: createMediaItem(), onClick, layout: 'masonry' as const };
    expect(areMediaCardPropsEqual(base, { ...base, item: { ...base.item } })).toBe(true);
    expect(areMediaCardPropsEqual(base, { ...base, item: { ...base.item, thumbnailUrl: '/new-thumb' } })).toBe(false);
    expect(areMediaCardPropsEqual(base, { ...base, item: { ...base.item, aspectRatio: 1.4 } })).toBe(false);
    expect(areMediaCardPropsEqual(base, { ...base, item: { ...base.item, width: 1400, height: 1000 } })).toBe(false);
    expect(areMediaCardPropsEqual(base, { ...base, item: { ...base.item, name: 'renamed.jpg' } })).toBe(false);
    expect(areMediaCardPropsEqual(base, { ...base, item: { ...base.item, size: 999 } })).toBe(false);
    expect(areMediaCardPropsEqual(base, { ...base, item: { ...base.item, type: 'image/png' } })).toBe(false);
    expect(areMediaCardPropsEqual(base, { ...base, onClick: () => undefined })).toBe(false);
  });

  it('父组件点击语义变化时保持传给卡片的引用稳定，并调用最新实现', () => {
    let cardRenderCount = 0;
    const ClickProbe = React.memo(({ onClick }: { onClick: (item: MediaItem) => void }) => {
      cardRenderCount += 1;
      return React.createElement('button', { onClick: () => onClick(createMediaItem()) }, '打开');
    });
    const Parent = ({ onClick }: { onClick: (item: MediaItem) => void }) => {
      const stableOnClick = useStableMediaItemClick(onClick);
      return React.createElement(ClickProbe, { onClick: stableOnClick });
    };
    const firstHandler = vi.fn();
    const latestHandler = vi.fn();
    const view = render(React.createElement(Parent, { onClick: firstHandler }));

    view.rerender(React.createElement(Parent, { onClick: latestHandler }));
    fireEvent.click(view.getByText('打开'));

    expect(cardRenderCount).toBe(1);
    expect(firstHandler).not.toHaveBeenCalled();
    expect(latestHandler).toHaveBeenCalledWith(expect.objectContaining({ id: 'stable-media-id' }));
  });

  it('同一媒体卡实例在音频和图片间切换时不违反 Hook 调用顺序', () => {
    const onClick = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const view = render(
        React.createElement(
          LanguageProvider,
          null,
          React.createElement(MediaCard, {
            item: createMediaItem({ mediaType: 'audio', type: 'audio/mpeg', name: 'track.mp3' }),
            onClick,
            layout: 'grid',
          }),
        ),
      );

      view.rerender(React.createElement(
        LanguageProvider,
        null,
        React.createElement(MediaCard, {
          item: createMediaItem({ mediaType: 'image', type: 'image/jpeg', name: 'image.jpg' }),
          onClick,
          layout: 'grid',
        }),
      ));

      const reactHookErrors = consoleError.mock.calls
        .flatMap((args) => args.map(String))
        .filter((message) => /hook order|Rendered (?:more|fewer) hooks|Expected static flag/i.test(message));
      expect(reactHookErrors).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });
});
