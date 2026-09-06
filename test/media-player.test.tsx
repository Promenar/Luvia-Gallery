// test/media-player.test.tsx
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider, useMediaPlayer } from '../components/player/PlayerProvider';
import { MediaPlayer } from '../components/player/MediaPlayer';
import type { MediaItem } from '../types';

// localStorage stub 与 test/player-provider.test.tsx 相同（Node 26 环境）
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const item = (id: string, mediaType: 'image' | 'video' = 'image'): MediaItem => ({
  id, url: `/api/file/${id}`, name: `${id}.jpg`, path: `/media/${id}.jpg`,
  folderPath: '/media', size: 1,
  type: mediaType === 'image' ? 'image/jpeg' : 'video/mp4',
  lastModified: 0, mediaType, sourceId: 'local',
});

const Harness = ({ items }: { items: MediaItem[] }) => {
  const player = useMediaPlayer();
  return (
    <>
      <button onClick={() => player.open({ items, startIndex: 0 })}>open</button>
      <MediaPlayer />
    </>
  );
};

const setup = (items: MediaItem[]) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<PlayerProvider><Harness items={items} /></PlayerProvider>));
  return { container, root };
};

describe('MediaPlayer 壳', () => {
  it('关闭状态下不渲染任何内容', () => {
    const { root, container } = setup([item('a')]);
    expect(container.querySelector('[data-testid="media-player"]')).toBeNull();
    root.unmount();
  });

  it('点击背景关闭', () => {
    const { root } = setup([item('a')]);
    fireEvent.click(screen.getByText('open'));
    const overlay = screen.getByTestId('media-player');
    fireEvent.click(overlay); // 背景点击 → 关闭
    expect(screen.queryByTestId('media-player')).toBeNull();
    root.unmount();
  });

  it('图片与视频项分别渲染对应面板，队列切换更新面板', () => {
    const { root } = setup([item('a'), item('b', 'video')]);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByAltText('a.jpg')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTestId('video-pane')).toBeTruthy();
    root.unmount();
  });

  it('音频项不渲染任何音频面板（音频仍由 AudioPlayer 承接）', () => {
    const audio = { ...item('c'), mediaType: 'audio' as const, type: 'audio/mpeg' };
    const { root, container } = setup([audio]);
    fireEvent.click(screen.getByText('open'));
    // 壳层兜底：audio 项没有对应面板，不出现 audio 元素（调用点另有过滤）
    expect(container.querySelector('audio')).toBeNull();
    root.unmount();
  });
});
