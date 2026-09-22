import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MediaCard } from '../components/PhotoCard';
import { LanguageProvider } from '../contexts/LanguageContext';
import { MediaItem } from '../types';

const item: MediaItem = {
  id: 'thumbnail-test', name: '测试图片.jpg', path: '/测试图片.jpg', folderPath: '/',
  size: 100, type: 'image/jpeg', lastModified: 1, mediaType: 'image', sourceId: 'local',
  url: '/media-stream/thumbnail-test', thumbnailUrl: '/api/thumb/thumbnail-test',
};
const onClick = vi.fn();
const card = (media = item) => <LanguageProvider><MediaCard item={media} onClick={onClick} layout="masonry" /></LanguageProvider>;
const advance = () => act(() => { vi.advanceTimersByTime(2500); });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

describe('媒体卡片缩略图加载恢复', () => {
  it('缓存图片已解码但没有新的 load 事件时也能显示', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(300);
    const view = render(<React.StrictMode>{card()}</React.StrictMode>);
    expect(view.getByRole('img').className).toContain('opacity-100');
    expect(view.container.querySelector('[data-thumbnail-state]')?.getAttribute('data-thumbnail-state')).toBe('loaded');
  });

  it('损坏的缓存图片不能被当作已加载', () => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
    const view = render(card());
    expect(view.getByRole('img').className).toContain('opacity-0');
  });

  it.each(['image', 'video'] as const)('%s 缩略图短暂失败后先重试缩略图并可恢复', (mediaType) => {
    vi.useFakeTimers();
    const view = render(card({ ...item, mediaType }));
    fireEvent.error(view.getByRole('img'));
    advance();
    const retry = view.getByRole('img') as HTMLImageElement;
    expect(retry.getAttribute('src')).toContain('/api/thumb/thumbnail-test?');
    fireEvent.load(retry);
    expect(retry.className).toContain('opacity-100');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('带鉴权和已有查询参数的缩略图耗尽重试后回退原图', () => {
    vi.useFakeTimers();
    localStorage.setItem('luvia_token', 'synthetic-test-token');
    const view = render(card({ ...item, thumbnailUrl: '/api/thumb/thumbnail-test?version=1' }));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.error(view.getByRole('img'));
      advance();
      const url = new URL((view.getByRole('img') as HTMLImageElement).src);
      expect(url.pathname).toBe('/api/thumb/thumbnail-test');
      expect(url.searchParams.get('version')).toBe('1');
      expect(url.searchParams.getAll('token')).toEqual(['synthetic-test-token']);
    }
    fireEvent.error(view.getByRole('img'));
    expect(view.getByRole('img').getAttribute('src')).toBe('/media-stream/thumbnail-test?token=synthetic-test-token');
    fireEvent.load(view.getByRole('img'));
    expect(view.getByRole('img').className).toContain('opacity-100');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('没有显式缩略图地址时仍可从标准 thumb 端点回退原图', () => {
    vi.useFakeTimers();
    const view = render(card({ ...item, thumbnailUrl: undefined }));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.error(view.getByRole('img'));
      advance();
    }
    fireEvent.error(view.getByRole('img'));
    expect(view.getByRole('img').getAttribute('src')).toBe(item.url);
  });

  it('视频封面达到重试上限后停止请求，不把视频源作为图片加载', () => {
    vi.useFakeTimers();
    const view = render(card({ ...item, mediaType: 'video', type: 'video/mp4' }));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.error(view.getByRole('img'));
      advance();
    }
    fireEvent.error(view.getByRole('img'));
    advance();
    expect(view.queryByRole('img')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(view.container.querySelector('[data-thumbnail-state]')?.getAttribute('data-thumbnail-state')).toBe('error');
  });

  it('卸载时取消待重试任务', () => {
    vi.useFakeTimers();
    const view = render(card());
    fireEvent.error(view.getByRole('img'));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('同一次失败只安排一次重试，图片随后成功则取消待重试任务', () => {
    vi.useFakeTimers();
    const view = render(card());
    const image = view.getByRole('img');
    fireEvent.error(image);
    fireEvent.error(image);
    expect(vi.getTimerCount()).toBe(1);
    fireEvent.load(image);
    advance();
    expect(view.getByRole('img').getAttribute('src')).toBe(item.thumbnailUrl);
    expect(image.className).toContain('opacity-100');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('原图回退失败后停止，不循环下载原图', () => {
    vi.useFakeTimers();
    const view = render(card());
    for (let attempt = 0; attempt < 2; attempt += 1) {
      fireEvent.error(view.getByRole('img'));
      advance();
    }
    fireEvent.error(view.getByRole('img'));
    expect(view.getByRole('img').getAttribute('src')).toBe(item.url);
    fireEvent.error(view.getByRole('img'));
    advance();
    expect(view.queryByRole('img')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('合成 thumb 地址编码媒体 ID，切换来源不显示旧图片状态', () => {
    const view = render(card());
    fireEvent.load(view.getByRole('img'));
    view.rerender(card({ ...item, id: 'a/b+=', thumbnailUrl: undefined }));
    expect(view.getByRole('img').getAttribute('src')).toBe('/api/thumb/a%2Fb%2B%3D');
    expect(view.getByRole('img').className).toContain('opacity-0');
  });

  it('切换媒体不会继承前一项的加载状态或重试', () => {
    vi.useFakeTimers();
    const view = render(card());
    fireEvent.error(view.getByRole('img'));
    view.rerender(card({ ...item, id: 'next', url: '/media-stream/next', thumbnailUrl: undefined }));
    advance();
    expect(view.getByRole('img').getAttribute('src')).toBe('/api/thumb/next');
    expect(view.getByRole('img').className).toContain('opacity-0');
    fireEvent.load(view.getByRole('img'));
    expect(view.getByRole('img').className).toContain('opacity-100');
  });
});
