// test/player-patch-favorite.test.tsx
// Defect 2（收藏状态不实时回写播放器队列）的 TDD 测试：
// - reducer 级：patch 命中/未命中/selectCurrentItem 联动
// - Provider 级：patchItem 后 UI 读取的 currentItem 更新（复用 player-provider.test.tsx 的 Probe 模式）
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialPlayerState, playerReducer, selectCurrentItem } from '../components/player/player-state';
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

const source = (count: number, startIndex = 0) => ({
  items: Array.from({ length: count }, (_, i) => item(`id${i}`)),
  startIndex,
});

describe('reducer patch（收藏回写队列快照）', () => {
  it('patch 命中队列项：更新目标字段且其余字段不变', () => {
    let state = playerReducer(createInitialPlayerState(), { type: 'open', source: source(2) });
    state = playerReducer(state, { type: 'patch', id: 'id1', patch: { isFavorite: true } });
    expect(state.items[1]?.isFavorite).toBe(true);
    expect(state.items[1]?.name).toBe('id1.jpg');
    expect(state.items[1]?.path).toBe('/media/id1.jpg');
    // 未被 patch 的队列项保持原样
    expect(state.items[0]?.isFavorite).toBeUndefined();
  });

  it('patch 未命中任何项：返回原状态引用（no-op）', () => {
    const state = playerReducer(createInitialPlayerState(), { type: 'open', source: source(2) });
    const next = playerReducer(state, { type: 'patch', id: 'missing', patch: { isFavorite: true } });
    expect(next).toBe(state);
  });

  it('patch 当前项后 selectCurrentItem 反映更新', () => {
    let state = playerReducer(createInitialPlayerState(), { type: 'open', source: source(2, 0) });
    state = playerReducer(state, { type: 'patch', id: 'id0', patch: { isFavorite: true } });
    expect(selectCurrentItem(state)?.isFavorite).toBe(true);
  });
});

// Probe：同时暴露 api 与 currentItem 的 UI 文本（含收藏态），供 Provider 级断言
const Probe = ({ onReady }: { onReady: (api: ReturnType<typeof useMediaPlayer>) => void }) => {
  const api = useMediaPlayer();
  onReady(api);
  return (
    <span data-testid="current">
      {api.currentItem ? `${api.currentItem.name}:${api.currentItem.isFavorite ? 'fav' : 'plain'}` : 'none'}
    </span>
  );
};

describe('Provider patchItem（收藏回写后 UI 实时更新）', () => {
  it('patchItem 后 currentItem 与 UI 文本同步翻转', () => {
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
    act(() => api!.open({ items: [item('a')], startIndex: 0 }));
    expect(screen.getByTestId('current').textContent).toBe('a.jpg:plain');
    act(() => api!.patchItem('a', { isFavorite: true }));
    expect(api!.currentItem?.isFavorite).toBe(true);
    expect(screen.getByTestId('current').textContent).toBe('a.jpg:fav');
    root.unmount();
  });
});
