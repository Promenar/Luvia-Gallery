// test/player-window.test.tsx
// Task B（PlayerWindow 浮窗壳）TDD 测试：非模态浮窗、默认右下定位与媒体比例自适应、
// 头部抓手指针拖动（clamp 视口内 + 偏好落库）、Esc/关闭按钮、收藏与信息面板、
// 队列边界导航隐藏、开合动画（scale 0.85→1 + fade）。
// 沿用 test/media-player.test.tsx 的 localStorage stub + Harness/setup 模式（Node 26 环境）。
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider, useMediaPlayer } from '../components/player/PlayerProvider';
import { MediaPlayer } from '../components/player/MediaPlayer';
import { PLAYER_WINDOW_PREFS_KEY } from '../components/player/window-prefs';
import type { MediaItem } from '../types';

// jsdom 缺少 PointerEvent 构造器时以 MouseEvent 兜底：React 按事件类型名（pointerdown 等）分发，
// 不校验原生事件构造器，fireEvent.pointerDown 派发的 MouseEvent 序列即可驱动 onPointerDown/Move/Up。
if (typeof window !== 'undefined' && typeof (window as unknown as Record<string, unknown>).PointerEvent === 'undefined') {
  (window as unknown as Record<string, unknown>).PointerEvent = class PointerEventPolyfill extends MouseEvent {};
}

// jsdom 默认视口 1024x768，用实际读取值参与断言，避免环境差异导致坐标失配
const VW = window.innerWidth;
const VH = window.innerHeight;

const stubStorage = (value: string | null = null) => {
  const storage = { getItem: vi.fn(() => value), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
  vi.stubGlobal('localStorage', storage);
  return storage;
};

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  outsideClicks = 0;
  stubStorage();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const item = (id: string, mediaType: 'image' | 'video' = 'image', extra: Partial<MediaItem> = {}): MediaItem => ({
  id, url: `/api/file/${id}`, name: `${id}.jpg`, path: `/media/${id}.jpg`,
  folderPath: '/media', size: 1,
  type: mediaType === 'image' ? 'image/jpeg' : 'video/mp4',
  lastModified: 0, mediaType, sourceId: 'local', ...extra,
});

let outsideClicks = 0;

const Harness = ({ items, onToggleFavorite }: {
  items: MediaItem[];
  onToggleFavorite?: (item: MediaItem, type: 'file') => void;
}) => {
  const player = useMediaPlayer();
  return (
    <>
      <button onClick={() => player.open({ items, startIndex: 0 })}>open</button>
      {/* 背景交互探针：浮窗打开时必须仍可点击（非模态） */}
      <button data-testid="outside" onClick={() => { outsideClicks += 1; }}>outside</button>
      {/* 非模态共存探针：浮窗打开时画廊行内可能存在聚焦输入框（重命名），播放器快捷键不得劫持 */}
      <input data-testid="rename-input" defaultValue="rename" />
      {/* 收藏回写探针：模拟 App 层收藏后 patchItem 同 id 回写（currentItem 引用变、id 不变） */}
      <button data-testid="patch-first" onClick={() => player.patchItem(items[0].id, { isFavorite: true })}>patch</button>
      <MediaPlayer onToggleFavorite={onToggleFavorite} />
    </>
  );
};

const setup = (items: MediaItem[], onToggleFavorite?: (item: MediaItem, type: 'file') => void) => {
  // 隔离防护：前序测试若在 root.unmount() 前断言失败退出，残留 DOM 会污染后续查询，先清空 body
  document.body.replaceChildren();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<PlayerProvider><Harness items={items} onToggleFavorite={onToggleFavorite} /></PlayerProvider>));
  return { container, root };
};

const openPlayer = () => { fireEvent.click(screen.getByText('open')); };

describe('PlayerWindow 非模态浮窗壳', () => {
  it('打开时渲染浮窗：fixed z-40 + 浮岛材质，无 inset-0 遮罩层，背景保持可交互', () => {
    const { container, root } = setup([item('a')]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    expect(win.className).toContain('fixed');
    expect(win.className).toContain('z-40');
    expect(win.className).toContain('gallery-toolbar-glass');
    expect(win.className).toContain('rounded-2xl');
    // 非模态：无专用遮罩节点，浮窗直接挂在渲染容器下（没有任何 inset-0 包裹/兄弟遮罩）
    expect(container.querySelector('[data-testid="player-overlay"]')).toBeNull();
    expect(win.parentElement).toBe(container);
    // 浮窗打开时背景元素仍可点击
    fireEvent.click(screen.getByTestId('outside'));
    expect(outsideClicks).toBe(1);
    // 点击浮窗本体不关闭（替代旧"点击背景关闭"行为）
    fireEvent.click(win);
    expect(screen.getByTestId('player-window')).toBeTruthy();
    root.unmount();
  });

  it('默认位置视口右下（右/下 24px），宽度 clamp(320, 42%vw, 560)，媒体比例反映在 aspect-ratio 且高度 clamp(24vh, 72vh)', () => {
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    const width = parseFloat(win.style.width);
    const height = parseFloat(win.style.height);
    const left = parseFloat(win.style.left);
    const top = parseFloat(win.style.top);
    expect(width).toBeGreaterThanOrEqual(320);
    expect(width).toBeLessThanOrEqual(560);
    // 900x600 → 3:2 比例写入容器 style.aspectRatio
    expect(win.style.aspectRatio).toBe('900 / 600');
    // 高度 = 宽度/比例，clamp 在 24vh~72vh
    expect(height).toBeCloseTo(Math.min(Math.max(width / 1.5, VH * 0.24), VH * 0.72), 6);
    // 默认锚点：距右/下各 24px
    expect(VW - (left + width)).toBeCloseTo(24, 6);
    expect(VH - (top + height)).toBeCloseTo(24, 6);
    root.unmount();
  });

  it('无尺寸信息的媒体兜底 16:9 比例', () => {
    const { root } = setup([item('plain')]);
    openPlayer();
    expect(screen.getByTestId('player-window').style.aspectRatio).toBe('16 / 9');
    root.unmount();
  });

  it('读取偏好：宽度与位置来自 localStorage 记忆', () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a')]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    expect(parseFloat(win.style.width)).toBe(400);
    expect(parseFloat(win.style.left)).toBe(10);
    expect(parseFloat(win.style.top)).toBe(20);
    root.unmount();
  });

  it('拖动抓手移动窗口并 clamp 视口内，pointerup 落库偏好', () => {
    const storage = stubStorage();
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    const handle = screen.getByTestId('player-window-handle');
    const width = parseFloat(win.style.width);
    const height = parseFloat(win.style.height);
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    // 大幅向左上拖动 → clamp 到视口左上边界
    fireEvent.pointerMove(handle, { clientX: -2000, clientY: -2000, pointerId: 1 });
    expect(parseFloat(win.style.left)).toBeCloseTo(0, 6);
    expect(parseFloat(win.style.top)).toBeCloseTo(0, 6);
    // 大幅向右下拖动 → clamp 到视口右下边界
    fireEvent.pointerMove(handle, { clientX: 5000, clientY: 5000, pointerId: 1 });
    expect(parseFloat(win.style.left)).toBeCloseTo(VW - width, 6);
    expect(parseFloat(win.style.top)).toBeCloseTo(VH - height, 6);
    // pointerup 落库（x/y/width/mode）
    fireEvent.pointerUp(handle, { clientX: 5000, clientY: 5000, pointerId: 1 });
    expect(storage.setItem).toHaveBeenCalledWith(PLAYER_WINDOW_PREFS_KEY, expect.any(String));
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string) as { x: number; y: number; width: number; mode: string };
    expect(saved.x).toBeCloseTo(VW - width, 6);
    expect(saved.y).toBeCloseTo(VH - height, 6);
    expect(saved.width).toBeCloseTo(width, 6);
    expect(saved.mode).toBe('window');
    root.unmount();
  });

  it('Esc 关闭播放器（window 形态）', async () => {
    const { root } = setup([item('a')]);
    openPlayer();
    expect(screen.getByTestId('player-window')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    // 关闭经 AnimatePresence 退出动画（250ms 级）后移除
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    root.unmount();
  });

  it('开合动画：initial 为 scale 0.85 + fade，animate 过渡到完全可见；关闭后经 exit 移除', async () => {
    const { root } = setup([item('a')]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    // initial（opacity 0 + scale 0.85）已在提交时应用
    expect(win.style.opacity).toBe('0');
    expect(win.style.transform).toMatch(/0\.85/);
    // animate 过渡到不透明
    await waitFor(() => expect(win.style.opacity).toBe('1'));
    // 关闭 → exit 动画结束后节点移除
    fireEvent.click(screen.getByTestId('player-window-close'));
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    root.unmount();
  });

  it('收藏按钮调用 onToggleFavorite(currentItem, "file")', () => {
    const favorite = vi.fn();
    const { root } = setup([item('a')], favorite);
    openPlayer();
    fireEvent.click(screen.getByTitle('Toggle Favorite'));
    expect(favorite).toHaveBeenCalledTimes(1);
    expect((favorite.mock.calls[0][0] as MediaItem).id).toBe('a');
    expect(favorite.mock.calls[0][1]).toBe('file');
    root.unmount();
  });

  it('信息按钮在窗口形态可用：信息面板渲染于浮窗内', () => {
    const { root } = setup([item('v', 'video')]);
    openPlayer();
    expect(screen.queryByText('file_details')).toBeNull();
    fireEvent.click(screen.getByTitle('File Info'));
    expect(screen.getByText('file_details')).toBeTruthy();
    root.unmount();
  });

  it('全屏按钮已启用（进入全屏的行为断言见 player-fullscreen.test.tsx）', () => {
    const { root } = setup([item('a')]);
    openPlayer();
    expect((screen.getByTestId('player-fullscreen-btn') as HTMLButtonElement).disabled).toBe(false);
    root.unmount();
  });

  it('左右导航按钮在队列边界隐藏', () => {
    const { root } = setup([item('a'), item('b')]);
    openPlayer();
    expect(screen.queryByTitle('Previous')).toBeNull();
    expect(screen.getByTitle('Next')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTitle('Previous')).toBeTruthy();
    expect(screen.queryByTitle('Next')).toBeNull();
    root.unmount();
  });
});

describe('Task C：mini/FAB 形态与切换动画', () => {
  it('mini 形态：容器保留且宽度固定 240px、仍可拖动、画廊式控制栏隐藏仅最小控制', () => {
    const { root } = setup([item('a'), item('b')]);
    openPlayer();
    fireEvent.click(screen.getByTitle('Mini Mode'));
    const win = screen.getByTestId('player-window');
    expect(win.getAttribute('data-mode')).toBe('mini');
    expect(parseFloat(win.style.width)).toBe(240);
    // 仍可拖动：抓手保留
    expect(screen.getByTestId('player-window-handle')).toBeTruthy();
    // 画廊式完整控制栏隐藏（收藏/信息/导航/全屏），仅保留展开与关闭
    expect(screen.queryByTitle('Toggle Favorite')).toBeNull();
    expect(screen.queryByTitle('File Info')).toBeNull();
    expect(screen.queryByTitle('Next')).toBeNull();
    expect(screen.queryByTitle('Full Screen')).toBeNull();
    expect(screen.getByTitle('Restore Window')).toBeTruthy();
    expect(screen.getByTestId('player-window-close')).toBeTruthy();
    root.unmount();
  });

  it('mini 点击展开回 window：恢复完整控制栏与记忆宽度', () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a')], vi.fn());
    openPlayer();
    fireEvent.click(screen.getByTitle('Mini Mode'));
    fireEvent.click(screen.getByTitle('Restore Window'));
    const win = screen.getByTestId('player-window');
    expect(win.getAttribute('data-mode')).toBe('window');
    expect(parseFloat(win.style.width)).toBe(400);
    expect(screen.getByTitle('Toggle Favorite')).toBeTruthy();
    root.unmount();
  });

  it('window↔mini 切换 video 元素保持挂载（同一 DOM 节点，不重载）', () => {
    const { container, root } = setup([item('v', 'video')]);
    openPlayer();
    const video = container.querySelector('video');
    expect(video).toBeTruthy();
    fireEvent.click(screen.getByTitle('Mini Mode'));
    expect(container.querySelector('video')).toBe(video);
    fireEvent.click(screen.getByTitle('Restore Window'));
    expect(container.querySelector('video')).toBe(video);
    root.unmount();
  });

  it('fab 形态：浮窗消失、渲染 56px 圆钮固定右下 16px、不可拖动、背景为缩略图', async () => {
    const { root } = setup([item('a', 'image', { thumbnailUrl: '/api/thumb/a' })]);
    openPlayer();
    fireEvent.click(screen.getByTitle('FAB Mode'));
    // window 容器经 exit 动画移除（与 fab 互斥出现）
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    const fab = screen.getByTestId('player-fab');
    expect(fab.tagName).toBe('BUTTON');
    expect(parseFloat(fab.style.width)).toBe(56);
    expect(parseFloat(fab.style.height)).toBe(56);
    expect(fab.style.right).toBe('16px');
    expect(fab.style.bottom).toBe('16px');
    // 不可拖动：无抓手
    expect(screen.queryByTestId('player-window-handle')).toBeNull();
    // 背景为当前项缩略图（stub 无 token，getAuthUrl 原样返回相对路径）
    expect(fab.querySelector('img')?.getAttribute('src')).toContain('/api/thumb/a');
    root.unmount();
  });

  it('fab 缩略图加载失败回退图标（onError 兜底）', async () => {
    const { root } = setup([item('a', 'image', { thumbnailUrl: '/api/thumb/a' })]);
    openPlayer();
    fireEvent.click(screen.getByTitle('FAB Mode'));
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    const img = screen.getByTestId('player-fab').querySelector('img');
    expect(img).toBeTruthy();
    fireEvent.error(img!);
    expect(screen.getByTestId('player-fab-fallback')).toBeTruthy();
    expect(screen.getByTestId('player-fab').querySelector('img')).toBeNull();
    root.unmount();
  });

  it('无缩略图的项 fab 直接显示图标兜底', async () => {
    const { root } = setup([item('plain')]);
    openPlayer();
    fireEvent.click(screen.getByTitle('FAB Mode'));
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    expect(screen.getByTestId('player-fab-fallback')).toBeTruthy();
    expect(screen.getByTestId('player-fab').querySelector('img')).toBeNull();
    root.unmount();
  });

  it('视频项 fab 显示播放角标', async () => {
    const { root } = setup([item('v', 'video', { thumbnailUrl: '/api/thumb/v' })]);
    openPlayer();
    fireEvent.click(screen.getByTitle('FAB Mode'));
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    expect(screen.getByTestId('player-fab-playing')).toBeTruthy();
    root.unmount();
  });

  it('点击 fab 回 window 形态（fab 与浮窗互斥出现）', async () => {
    const { root } = setup([item('a')]);
    openPlayer();
    fireEvent.click(screen.getByTitle('FAB Mode'));
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    fireEvent.click(screen.getByTestId('player-fab'));
    const win = screen.getByTestId('player-window');
    expect(win.getAttribute('data-mode')).toBe('window');
    await waitFor(() => expect(screen.queryByTestId('player-fab')).toBeNull());
    root.unmount();
  });

  it('形态切换即落盘偏好：setMode 后 saveWindowPrefs 写入对应 mode', () => {
    const storage = stubStorage();
    const { root } = setup([item('a')]);
    openPlayer();
    fireEvent.click(screen.getByTitle('Mini Mode'));
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string).mode).toBe('mini');
    fireEvent.click(screen.getByTitle('Restore Window'));
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string).mode).toBe('window');
    fireEvent.click(screen.getByTitle('FAB Mode'));
    expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string).mode).toBe('fab');
    root.unmount();
  });

  it('重新 open 恢复上次形态偏好：prefs.mode 为 fab/mini 时打开即恢复', async () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'fab' }));
    const { root } = setup([item('a')]);
    openPlayer();
    await waitFor(() => expect(screen.queryByTestId('player-fab')).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    root.unmount();
    cleanup();
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'mini' }));
    const { root: root2 } = setup([item('a')]);
    openPlayer();
    await waitFor(() => expect(screen.getByTestId('player-window').getAttribute('data-mode')).toBe('mini'));
    root2.unmount();
  });

  it('动画取证：window/mini 切换为同一 DOM 节点形变（layout），fab 经 AnimatePresence 互斥出现', async () => {
    const { root } = setup([item('a')]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    expect(win.getAttribute('data-mode')).toBe('window');
    fireEvent.click(screen.getByTitle('Mini Mode'));
    const mini = screen.getByTestId('player-window');
    expect(mini.getAttribute('data-mode')).toBe('mini');
    // 同一 DOM 节点：window↔mini 同 key 容器不卸载，形态形变由 framer-motion layout 驱动
    expect(mini).toBe(win);
    // mini 仅保留最小控制（无 FAB 直达按钮），经 window 再切 fab
    expect(screen.queryByTitle('FAB Mode')).toBeNull();
    fireEvent.click(screen.getByTitle('Restore Window'));
    fireEvent.click(screen.getByTitle('FAB Mode'));
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    expect(screen.getByTestId('player-fab')).toBeTruthy();
    root.unmount();
  });

  it('信息面板仅在 window 可见：mini/fab 下隐藏，切回 window 恢复', async () => {
    const { root } = setup([item('a'), item('b')]);
    openPlayer();
    fireEvent.click(screen.getByTitle('File Info'));
    expect(screen.getByText('file_details')).toBeTruthy();
    // mini：内容区只保留媒体，面板不显示
    fireEvent.click(screen.getByTitle('Mini Mode'));
    expect(screen.queryByText('file_details')).toBeNull();
    // 切回 window：恢复
    fireEvent.click(screen.getByTitle('Restore Window'));
    expect(screen.getByText('file_details')).toBeTruthy();
    // fab：无内容区，面板不随 window exit 动画残留
    fireEvent.click(screen.getByTitle('FAB Mode'));
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    expect(screen.queryByText('file_details')).toBeNull();
    // 点 fab 回 window：恢复可用
    fireEvent.click(screen.getByTestId('player-fab'));
    await waitFor(() => expect(screen.getByText('file_details')).toBeTruthy());
    root.unmount();
  });
});

describe('Task C 附加修复：键盘守卫与 EXIF 依赖', () => {
  it('输入控件聚焦时方向键/Esc 不被播放器劫持，非输入目标时快捷键照常', async () => {
    const { root } = setup([item('a'), item('b')]);
    openPlayer();
    const input = screen.getByTestId('rename-input') as HTMLInputElement;
    // 聚焦输入框后派发方向键（事件从 input 冒泡到 window，target 为输入框）：不得切换队列
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    expect(screen.queryByTitle('Previous')).toBeNull();
    // Esc 同理：不关闭播放器
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByTestId('player-window')).toBeTruthy();
    // 对照：非输入控件目标（target 为 window）时快捷键照常生效
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTitle('Previous')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    root.unmount();
  });

  it('收藏回写（同 id patch）不触发冗余 EXIF 请求，切换队列项仍重新拉取', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ Make: 'Cam' }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { root } = setup([item('a'), item('b')]);
    openPlayer();
    fireEvent.click(screen.getByTitle('File Info'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/file/a/exif');
    // 收藏回写：patchItem 生成同 id 新引用（currentItem 引用变、id 不变），不应重复请求
    fireEvent.click(screen.getByTestId('patch-first'));
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 切换到不同 id 的项：应重新拉取（修复未破坏切项重拉）
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/file/b/exif');
    root.unmount();
  });
});
