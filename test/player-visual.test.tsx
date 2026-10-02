import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeAmbientColor, getAmbientSource } from '../components/player/ambient-color';
import { canRunHeroTransition, getHeroTransitionName, runHeroTransition } from '../components/player/hero-transition';
import { selectNeighborImageUrls } from '../components/player/player-state';
import { ImageViewPane } from '../components/player/ImageViewPane';
import type { MediaItem } from '../types';

afterEach(() => cleanup());

const media = (id: string, overrides: Partial<MediaItem> = {}): MediaItem => ({
  id,
  name: `${id}.jpg`,
  path: `/m/${id}.jpg`,
  folderPath: '/m',
  url: `/api/file/${id}`,
  thumbnailUrl: `/api/thumb/${id}`,
  type: 'image/jpeg',
  mediaType: 'image',
  size: 1,
  lastModified: 1,
  sourceId: 'local',
  ...overrides,
});

const pixels = (...colors: Array<[number, number, number, number?]>) =>
  colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]);

describe('氛围取色', () => {
  it('饱和色主导结果，大面积灰黑背景不会把主色冲淡', () => {
    const data = pixels(
      ...Array.from({ length: 30 }, () => [20, 20, 20] as [number, number, number]),
      ...Array.from({ length: 10 }, () => [220, 120, 40] as [number, number, number]),
    );
    const [r, g, b] = computeAmbientColor(data)!.split(',').map(Number);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(r).toBeGreaterThan(120);
  });

  it('结果亮度受限，透明像素被忽略，全透明返回 null', () => {
    const [r, g, b] = computeAmbientColor(pixels([255, 255, 255], [250, 250, 250]))!.split(',').map(Number);
    expect(Math.max(r, g, b)).toBeLessThanOrEqual(220);
    expect(computeAmbientColor(pixels([255, 0, 0, 0]))).toBeNull();
  });

  it('取色来源优先缩略图，视频无缩略图时不取色', () => {
    expect(getAmbientSource(media('a'))).toBe('/api/thumb/a');
    expect(getAmbientSource(media('b', { thumbnailUrl: undefined }))).toBe('/api/file/b');
    expect(getAmbientSource(media('c', { thumbnailUrl: undefined, mediaType: 'video' }))).toBeNull();
    expect(getAmbientSource(null)).toBeNull();
  });
});

describe('邻居预加载', () => {
  it('只返回当前项前后的图片原图，忽略视频与越界', () => {
    const items = [media('a'), media('b'), media('c', { mediaType: 'video' }), media('d')];
    expect(selectNeighborImageUrls({ isOpen: true, items, index: 1, displayMode: 'window' })).toEqual(['/api/file/a']);
    expect(selectNeighborImageUrls({ isOpen: true, items, index: 0, displayMode: 'window' })).toEqual(['/api/file/b']);
    expect(selectNeighborImageUrls({ isOpen: true, items, index: 3, displayMode: 'window' })).toEqual([]);
    expect(selectNeighborImageUrls({ isOpen: false, items, index: 1, displayMode: 'window' })).toEqual([]);
  });
});

describe('共享元素过渡', () => {
  afterEach(() => {
    delete (document as Document & { startViewTransition?: unknown }).startViewTransition;
  });

  it('浏览器不支持时直接执行更新且不留下过渡标记', () => {
    const update = vi.fn();
    expect(canRunHeroTransition()).toBe(false);
    runHeroTransition('a', update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(getHeroTransitionName('a')).toBeUndefined();
  });

  it('支持时源缩略图与目标在过渡期间共用过渡名，结束后清除', async () => {
    const thumb = document.createElement('img');
    thumb.dataset.mediaThumb = 'a';
    document.body.appendChild(thumb);
    let resolveFinished: () => void = () => undefined;
    let namesDuringUpdate: Array<string | undefined> = [];
    (document as Document & { startViewTransition?: unknown }).startViewTransition = (callback: () => void) => {
      expect(thumb.style.viewTransitionName).toBe('luvia-hero');
      callback();
      return { finished: new Promise<void>(resolve => { resolveFinished = resolve; }) };
    };
    window.matchMedia = window.matchMedia || ((() => ({ matches: false })) as unknown as typeof window.matchMedia);

    runHeroTransition('a', () => {
      namesDuringUpdate = [thumb.style.viewTransitionName || undefined, getHeroTransitionName('a')];
    });
    expect(namesDuringUpdate).toEqual([undefined, 'luvia-hero']);
    resolveFinished();
    await Promise.resolve();
    await Promise.resolve();
    expect(getHeroTransitionName('a')).toBeUndefined();
    thumb.remove();
  });
});

describe('渐进加载', () => {
  it('原图解码前显示缩略图占位，原图加载后移除占位并显示原图', () => {
    render(<ImageViewPane item={media('a')} onSlideNext={() => undefined} />);
    expect(screen.getByTestId('image-pane-placeholder').getAttribute('src')).toContain('/api/thumb/a');
    const original = screen.getByRole('img', { name: 'a.jpg' });
    expect(original.className).toContain('opacity-0');
    fireEvent.load(original);
    expect(screen.queryByTestId('image-pane-placeholder')).toBeNull();
    expect(screen.getByRole('img', { name: 'a.jpg' }).className).toContain('opacity-100');
  });

  it('没有独立缩略图时直接显示原图', () => {
    render(<ImageViewPane item={media('b', { thumbnailUrl: undefined })} onSlideNext={() => undefined} />);
    expect(screen.queryByTestId('image-pane-placeholder')).toBeNull();
    expect(screen.getByRole('img', { name: 'b.jpg' }).className).toContain('opacity-100');
  });
});

describe('轻扫切换', () => {
  it('横向位移足够且明显大于纵向时判定方向，否则忽略', async () => {
    const { resolveSwipeDirection } = await import('../components/player/ImageViewPane');
    expect(resolveSwipeDirection(-80, 10)).toBe('next');
    expect(resolveSwipeDirection(90, -20)).toBe('prev');
    expect(resolveSwipeDirection(-40, 0)).toBeNull();
    expect(resolveSwipeDirection(-80, 70)).toBeNull();
  });

  it('未缩放时单指左滑调用下一张', () => {
    const onSwipeNext = vi.fn();
    const onSwipePrev = vi.fn();
    render(<ImageViewPane item={media('a')} onSlideNext={() => undefined} onSwipeNext={onSwipeNext} onSwipePrev={onSwipePrev} />);
    const surface = screen.getByTestId('image-view-pane').firstElementChild as HTMLElement;
    fireEvent.touchStart(surface, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(surface, { touches: [], changedTouches: [{ clientX: 180, clientY: 210 }] });
    expect(onSwipeNext).toHaveBeenCalledTimes(1);
    expect(onSwipePrev).not.toHaveBeenCalled();
  });
});
