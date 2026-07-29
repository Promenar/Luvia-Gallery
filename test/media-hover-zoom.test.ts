import { describe, expect, it } from 'vitest';
import {
  readMediaHoverZoomPreference,
  writeMediaHoverZoomPreference,
} from '../navigation/media-hover-zoom-preference';
import {
  getMediaCardHoverAnimation,
  getMediaThumbnailClasses,
} from '../components/PhotoCard';
import { getAudioCardClasses } from '../components/AudioCard';

describe('媒体缩略图悬浮缩放偏好', () => {
  it('没有持久化值时默认启用', () => {
    expect(readMediaHoverZoomPreference(undefined)).toBe(true);
    expect(readMediaHoverZoomPreference({
      getItem: () => null,
      setItem: () => undefined,
    })).toBe(true);
  });

  it('能够读取并写回关闭状态', () => {
    const values = new Map<string, string>([['luvia_media_hover_zoom', 'false']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };

    expect(readMediaHoverZoomPreference(storage)).toBe(false);
    writeMediaHoverZoomPreference(storage, true);
    expect(readMediaHoverZoomPreference(storage)).toBe(true);
  });

  it('非法值或存储异常时回退为启用，写入异常不会抛出', () => {
    expect(readMediaHoverZoomPreference({
      getItem: () => 'invalid',
      setItem: () => undefined,
    })).toBe(true);

    const brokenStorage = {
      getItem: () => {
        throw new Error('读取失败');
      },
      setItem: () => {
        throw new Error('写入失败');
      },
    };
    expect(readMediaHoverZoomPreference(brokenStorage)).toBe(true);
    expect(() => writeMediaHoverZoomPreference(brokenStorage, false)).not.toThrow();
  });
});

describe('媒体卡片悬浮缩放配置', () => {
  it('PhotoCard 仅在启用且非虚拟卡片时提供 Framer Motion 缩放', () => {
    expect(getMediaCardHoverAnimation(false, true)).toEqual({ scale: 1.02 });
    expect(getMediaCardHoverAnimation(false, false)).toEqual({});
    expect(getMediaCardHoverAnimation(true, true)).toEqual({});
  });

  it('PhotoCard 启用时保留图片缩放类，关闭时移除', () => {
    expect(getMediaThumbnailClasses(true, true)).toContain('group-hover:scale-105');
    expect(getMediaThumbnailClasses(true, false)).not.toContain('group-hover:scale-105');
    expect(getMediaThumbnailClasses(false, false)).toContain('block');
  });

  it('AudioCard 关闭时只移除卡片缩放，保留阴影反馈', () => {
    expect(getAudioCardClasses('grid', true)).toContain('hover:scale-[1.02]');
    expect(getAudioCardClasses('grid', false)).not.toContain('hover:scale-[1.02]');
    expect(getAudioCardClasses('grid', false)).toContain('hover:shadow-xl');
  });
});
