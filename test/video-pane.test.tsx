// test/video-pane.test.tsx
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoPane } from '../components/player/VideoPane';
import type { MediaItem } from '../types';

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const videoItem: MediaItem = {
  id: 'v1', url: '/api/file/v1', name: 'clip.mov', path: '/media/clip.mov',
  folderPath: '/media', size: 1, type: 'video/quicktime', lastModified: 0,
  mediaType: 'video', sourceId: 'local',
};

describe('VideoPane', () => {
  it('默认渲染原生 video 且 src 来自 resolveVideoSource', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<VideoPane item={videoItem} />));
    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    expect(video?.getAttribute('src')).toContain('/api/file/v1');
    root.unmount();
  });

  it('video error 事件后渲染降级界面并提供下载链接', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<VideoPane item={videoItem} />));
    fireEvent.error(container.querySelector('video')!);
    expect(screen.getByTestId('video-fallback')).toBeTruthy();
    expect(screen.getByTestId('video-fallback').querySelector('a[download]')).toBeTruthy();
    root.unmount();
  });
});
