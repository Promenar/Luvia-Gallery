// test/player-provider.test.tsx
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider, useMediaPlayer } from '../components/player/PlayerProvider';
import type { MediaItem } from '../types';

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const item = (id: string): MediaItem => ({
  id, url: `/api/file/${id}`, name: `${id}.jpg`, path: `/media/${id}.jpg`,
  folderPath: '/media', size: 1, type: 'image/jpeg', lastModified: 0,
  mediaType: 'image', sourceId: 'local',
});

const Probe = ({ onReady }: { onReady: (api: ReturnType<typeof useMediaPlayer>) => void }) => {
  const api = useMediaPlayer();
  onReady(api);
  return <span data-testid="current">{api.currentItem?.name ?? 'none'}</span>;
};

describe('PlayerProvider', () => {
  it('open 后 currentItem 指向起点，close 后 currentItem 为 null', () => {
    let api: ReturnType<typeof useMediaPlayer> | undefined;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <PlayerProvider>
          <Probe onReady={(value) => { api = value; }} />
        </PlayerProvider>
      );
    });
    const items = [item('a'), item('b')];
    act(() => api!.open({ items, startIndex: 1 }));
    expect(screen.getByTestId('current').textContent).toBe('b.jpg');
    act(() => api!.close());
    expect(screen.getByTestId('current').textContent).toBe('none');
    root.unmount();
  });

  it('空队列 open 是 no-op', () => {
    let api: ReturnType<typeof useMediaPlayer> | undefined;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <PlayerProvider>
          <Probe onReady={(value) => { api = value; }} />
        </PlayerProvider>
      );
    });
    act(() => api!.open({ items: [], startIndex: 0 }));
    expect(screen.getByTestId('current').textContent).toBe('none');
    root.unmount();
  });
});
