// test/player-state.test.ts
import { describe, expect, it } from 'vitest';
import { buildPlayerQueue, createInitialPlayerState, playerReducer, selectCurrentItem } from '../components/player/player-state';
import type { MediaItem } from '../types';

const item = (id: string): MediaItem => ({
  id, url: `/api/file/${id}`, name: `${id}.jpg`, path: `/media/${id}.jpg`,
  folderPath: '/media', size: 1, type: 'image/jpeg', lastModified: 0,
  mediaType: 'image', sourceId: 'local',
});

const audioItem = (id: string): MediaItem => ({
  ...item(id), name: `${id}.mp3`, path: `/media/${id}.mp3`,
  type: 'audio/mpeg', mediaType: 'audio',
});

const source = (count: number, startIndex = 0) => ({
  items: Array.from({ length: count }, (_, i) => item(`id${i}`)),
  startIndex,
});

describe('播放器队列状态机', () => {
  it('空队列或越界起点时 open 被拒绝', () => {
    expect(playerReducer(createInitialPlayerState(), { type: 'open', source: source(0) })).toEqual(createInitialPlayerState());
    expect(playerReducer(createInitialPlayerState(), { type: 'open', source: source(2, 5) })).toEqual(createInitialPlayerState());
  });

  it('open 设置队列、起点与打开状态', () => {
    const next = playerReducer(createInitialPlayerState(), { type: 'open', source: source(3, 1) });
    expect(next.isOpen).toBe(true);
    expect(next.index).toBe(1);
    expect(selectCurrentItem(next)?.id).toBe('id1');
  });

  it('同队列内 next/prev 移动索引，到达边界后保持不动', () => {
    let state = playerReducer(createInitialPlayerState(), { type: 'open', source: source(2) });
    state = playerReducer(state, { type: 'next' });
    expect(selectCurrentItem(state)?.id).toBe('id1');
    state = playerReducer(state, { type: 'next' });
    expect(state.index).toBe(1);
    state = playerReducer(state, { type: 'prev' });
    expect(state.index).toBe(0);
  });

  it('close 只改开关不清队列（保留队列供动画期间渲染）', () => {
    let state = playerReducer(createInitialPlayerState(), { type: 'open', source: source(2) });
    state = playerReducer(state, { type: 'close' });
    expect(state.isOpen).toBe(false);
    expect(state.items).toHaveLength(2);
  });
});

describe('播放器队列构建（buildPlayerQueue）', () => {
  // 音频穿插列表：队列必须先过滤再定位，否则起点索引错位（旧行为会打开错误媒体或被 canOpen 静默拒绝）。
  const mixed = [item('a'), audioItem('b'), item('c'), audioItem('d'), item('e')];

  it('音频穿插时点击中间图片：队列过滤为仅图片/视频，起点指向过滤后数组中的正确项', () => {
    const queue = buildPlayerQueue(mixed, 'c');
    expect(queue.items.map((f) => f.id)).toEqual(['a', 'c', 'e']);
    expect(queue.startIndex).toBe(1);
    expect(queue.items[queue.startIndex]?.id).toBe('c');
  });

  it('点击音频项：音频不入队，起点回退后仍落在过滤后数组边界内（不越界）', () => {
    const queue = buildPlayerQueue(mixed, 'd');
    expect(queue.items.some((f) => f.mediaType === 'audio')).toBe(false);
    expect(queue.startIndex).toBeGreaterThanOrEqual(0);
    expect(queue.startIndex).toBeLessThan(queue.items.length);
  });

  it('目标不存在：起点回退为 0', () => {
    const queue = buildPlayerQueue(mixed, 'missing');
    expect(queue.startIndex).toBe(0);
  });
});
