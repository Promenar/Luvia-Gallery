import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOVER_PREVIEW_DELAY_MS, MediaCard } from '../components/PhotoCard';
import { FolderCard } from '../components/FolderCard';
import { VideoPane } from '../components/player/VideoPane';
import { LanguageProvider } from '../contexts/LanguageContext';
import { isBackgroundTaskActive, shouldAutoOpenTaskProgress } from '../utils/background-tasks';
import { releaseMediaElement } from '../utils/media-element';
import type { FolderNode, MediaItem } from '../types';

const video: MediaItem = {
  id: 'clip', name: 'clip.mp4', path: '/video/clip.mp4', folderPath: '/video',
  size: 1, type: 'video/mp4', lastModified: 1, mediaType: 'video', sourceId: 'local',
  url: '/api/file/clip', thumbnailUrl: '/api/thumb/clip',
};

let load: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

const card = () => <LanguageProvider><MediaCard item={video} onClick={vi.fn()} layout="grid" /></LanguageProvider>;
const cardRoot = (view: ReturnType<typeof render>) => view.container.querySelector('[role="button"]') as HTMLElement;

describe('视频悬停预览释放连接', () => {
  it('快速划过不挂载视频、不发起原视频请求', () => {
    vi.useFakeTimers();
    const view = render(card());
    fireEvent.mouseEnter(cardRoot(view));
    act(() => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS - 50); });
    fireEvent.mouseLeave(cardRoot(view));
    act(() => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    expect(view.container.querySelector('video')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('停留超过阈值才挂载预览，移开时移除 src 并中止下载', () => {
    vi.useFakeTimers();
    const view = render(card());
    fireEvent.mouseEnter(cardRoot(view));
    act(() => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    const element = view.container.querySelector('video') as HTMLVideoElement;
    expect(element.getAttribute('src')).toContain('/api/file/clip');

    fireEvent.mouseLeave(cardRoot(view));
    expect(view.container.querySelector('video')).toBeNull();
    expect(element.hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalled();
  });

  it('预览中卡片被卸载（虚拟列表回收）时同样释放', () => {
    vi.useFakeTimers();
    const view = render(card());
    fireEvent.mouseEnter(cardRoot(view));
    act(() => { vi.advanceTimersByTime(HOVER_PREVIEW_DELAY_MS); });
    const element = view.container.querySelector('video') as HTMLVideoElement;
    view.unmount();
    expect(element.hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalled();
  });

  it('文件夹原视频封面只在悬停期间挂载并在移开时释放', () => {
    const folder = {
      name: '片段', path: '/video/片段', mediaCount: 1, children: {},
      coverMedia: { ...video, url: '/api/file/clip', thumbnailUrl: undefined },
    } as unknown as FolderNode;
    const view = render(<LanguageProvider><FolderCard folder={folder} onClick={vi.fn()} /></LanguageProvider>);
    expect(view.container.querySelector('video')).toBeNull();
    const root = view.container.querySelector('[role="button"]') as HTMLElement;
    fireEvent.mouseEnter(root);
    const element = view.container.querySelector('video') as HTMLVideoElement;
    expect(element).toBeTruthy();
    fireEvent.mouseLeave(root);
    expect(view.container.querySelector('video')).toBeNull();
    expect(element.hasAttribute('src')).toBe(false);
  });

  it('关闭播放器时释放正在播放的视频', () => {
    const view = render(<VideoPane item={video} />);
    const element = view.container.querySelector('video') as HTMLVideoElement;
    expect(element.getAttribute('src')).toContain('/api/file/clip');
    view.unmount();
    expect(element.hasAttribute('src')).toBe(false);
    expect(load).toHaveBeenCalled();
  });

  it('未设置来源的元素不重复触发 load', () => {
    const element = document.createElement('video');
    releaseMediaElement(element);
    releaseMediaElement(null);
    expect(load).not.toHaveBeenCalled();
  });
});

describe('后台任务进度窗口', () => {
  it('仅手动扫描与缩略图任务自动弹出，定时扫描不弹出', () => {
    expect(isBackgroundTaskActive('paused')).toBe(true);
    expect(isBackgroundTaskActive('idle')).toBe(false);
    expect(shouldAutoOpenTaskProgress({ status: 'scanning', trigger: 'manual' }, { status: 'idle' })).toBe(true);
    expect(shouldAutoOpenTaskProgress({ status: 'scanning' }, null)).toBe(true);
    expect(shouldAutoOpenTaskProgress({ status: 'scanning', trigger: 'periodic' }, { status: 'idle' })).toBe(false);
    expect(shouldAutoOpenTaskProgress({ status: 'scanning', trigger: 'periodic' }, { status: 'scanning' })).toBe(true);
    expect(shouldAutoOpenTaskProgress({ status: 'idle', trigger: 'manual' }, null)).toBe(false);
  });
});
