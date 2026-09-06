// test/player-window.test.tsx
// Task B（PlayerWindow 浮窗壳）TDD 测试：非模态浮窗、默认右下定位与媒体比例自适应、
// 头部抓手指针拖动（clamp 视口内 + 偏好落库）、Esc/关闭按钮、收藏与信息面板、
// 队列边界导航隐藏、开合动画（scale 0.85→1 + fade）。
// hotfix-2：容器形状贴合媒体（双向预算竖图收窄）、边缘拖拽自定义大小（右/下边缘与右下角抓手，高度覆盖落盘）。
// hotfix-3：等比高度显式公式（容器高 = 内容区高 + 头部 44，移除 aspectRatio）、ImageViewPane 去内边距、
// 拖动/缩放 move 期直写 DOM（渲染次数不随 move 增加、不落盘），pointerup 才同步状态并落盘。
// hotfix-4：右缘/右下角改为标准窗口自由缩放（非等比）——右缘只改宽且高度锁定起点渲染总高、
// 右下角宽高各自独立跟随；双击右缘/右下角清除覆盖回等比自适应；下缘语义不变。
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
  playerRenderCount = 0;
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
// hotfix-3：渲染探针——统计 MediaPlayer 子树的 React 渲染次数。
// 拖动/缩放 pointermove 直写 DOM 时不触发渲染，渲染次数不随 move 增加（状态未被改写）。
let playerRenderCount = 0;

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
      <React.Profiler id="media-player" onRender={() => { playerRenderCount += 1; }}>
        <MediaPlayer onToggleFavorite={onToggleFavorite} />
      </React.Profiler>
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

  it('默认位置视口右下（右/下 24px），宽度 clamp(280, vw-48)，容器 height = width/ratio + 44（hotfix-3 显式公式）', () => {
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    const width = parseFloat(win.style.width);
    // hotfix-3：内容区高（容器高 - 44）= width/1.5 正好贴合媒体比例，不再用 aspectRatio 推导整容器
    const height = width / 1.5 + 44;
    const left = parseFloat(win.style.left);
    const top = parseFloat(win.style.top);
    expect(width).toBeGreaterThanOrEqual(280);
    expect(width).toBeLessThanOrEqual(VW - 48);
    expect(win.style.aspectRatio).toBe('');
    expect(parseFloat(win.style.height)).toBeCloseTo(height, 6);
    // 默认锚点：距右/下各 24px（下边距按容器总高计算）
    expect(VW - (left + width)).toBeCloseTo(24, 6);
    expect(VH - (top + height)).toBeCloseTo(24, 6);
    root.unmount();
  });

  it('无尺寸信息的媒体兜底 16:9 比例推导容器高度', () => {
    const { root } = setup([item('plain')]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    const width = parseFloat(win.style.width);
    expect(parseFloat(win.style.height)).toBeCloseTo(width / (16 / 9) + 44, 6);
    expect(win.style.aspectRatio).toBe('');
    root.unmount();
  });

  it('hotfix-2：竖图以高度定宽收窄（双向预算），内容区高度收进 80% 视口预算', () => {
    // 竖图 600x1500（比例 0.4）：默认宽度推导高超出视口高 80% → 以高度定宽收窄
    const { root } = setup([item('tall', 'image', { width: 600, height: 1500 })]);
    openPlayer();
    const tall = screen.getByTestId('player-window');
    const tallWidth = parseFloat(tall.style.width);
    const budget = VH * 0.8;
    // 容器总高 = 预算高 + 头部 44；内容区（总高 - 44）按比例贴合竖图（宽 = 预算高 × 比例）
    expect(parseFloat(tall.style.height)).toBeCloseTo(budget + 44, 6);
    expect(tallWidth).toBeCloseTo(budget * 0.4, 6);
    expect(tall.style.aspectRatio).toBe('');
    root.unmount();
    cleanup();
    // 对照：横图 16:9 同一宽度基准不触高度顶 → 宽度明显大于竖图收窄结果
    const { root: root2 } = setup([item('wide', 'image', { width: 1600, height: 900 })]);
    openPlayer();
    const wide = screen.getByTestId('player-window');
    expect(parseFloat(wide.style.width)).toBeGreaterThan(tallWidth);
    root2.unmount();
  });

  it('hotfix-2：极端竖图触宽度下限 240 后高度按比例回推（保持形状贴合）', () => {
    // 比例 0.2：以 80% 视口高定宽 ≈ 0.2*0.8*768 < 240 → 触底 240，高度回推（比例仍保持）
    const { root } = setup([item('extreme', 'image', { width: 200, height: 1000 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    expect(parseFloat(win.style.width)).toBe(240);
    expect(parseFloat(win.style.height)).toBeCloseTo(240 / 0.2 + 44, 6);
    expect(win.style.aspectRatio).toBe('');
    root.unmount();
  });

  it('hotfix-2：切换队列项比例变化 → 窗口尺寸随新比例更新（同一宽度基准）', () => {
    const { root } = setup([
      item('wide', 'image', { width: 1600, height: 900 }),
      item('tall', 'image', { width: 600, height: 1500 }),
    ]);
    openPlayer();
    const beforeWidth = parseFloat(screen.getByTestId('player-window').style.width);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const win = screen.getByTestId('player-window');
    expect(parseFloat(win.style.width)).toBeLessThan(beforeWidth);
    // 竖图以高度定宽：容器总高 = 80% 视口预算 + 头部 44
    expect(parseFloat(win.style.height)).toBeCloseTo(VH * 0.8 + 44, 6);
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
    // hotfix-3：容器总高 = width/1.5 + 头部 44
    const height = width / 1.5 + 44;
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
    // mini 高度 = 240/ratio + 头部 44（16:9 → 240/(16/9)+44）；等比公式同样适用 mini（hotfix-3）
    expect(parseFloat(win.style.height)).toBeCloseTo(240 / (16 / 9) + 44, 6);
    expect(win.style.aspectRatio).toBe('');
    // mini 不支持边缘 resize（固定 240 宽）
    expect(screen.queryByTestId('player-resize-right')).toBeNull();
    expect(screen.queryByTestId('player-resize-bottom')).toBeNull();
    expect(screen.queryByTestId('player-resize-corner')).toBeNull();
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

describe('hotfix-2/hotfix-4：边缘拖拽自定义大小（仅 window 形态，三向自由缩放）', () => {
  it('右缘拖拽自由改宽（clamp 视口预算）：高度锁定起点渲染总高不被比例重算，pointerup 落盘覆盖', () => {
    // 超宽媒体（比例 5）：宽度触上限时推导高度仍远低于 80% 视口高预算，clamp 断言不受双向预算收窄干扰
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window', heightOverride: 500 }));
    const { root } = setup([item('a', 'image', { width: 3000, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    // 预置高度覆盖生效：起点渲染总高即 500
    expect(parseFloat(win.style.height)).toBe(500);
    const handle = screen.getByTestId('player-resize-right');
    fireEvent.pointerDown(handle, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 260, pointerId: 1 }); // dx=+160 → 400+160=560
    expect(parseFloat(win.style.width)).toBe(560);
    // hotfix-4：高度保持起点值 500，不按比例重算（旧语义 560/5+44 已废除）
    expect(parseFloat(win.style.height)).toBe(500);
    // 大幅拖动触上限 clamp（视口宽 - 48）
    fireEvent.pointerMove(handle, { clientX: 5000, pointerId: 1 });
    expect(parseFloat(win.style.width)).toBe(VW - 48);
    // 回到 560 再落盘
    fireEvent.pointerMove(handle, { clientX: 260, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 260, pointerId: 1 });
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string) as { width: number; heightOverride?: number; mode: string };
    expect(saved.width).toBe(560);
    // 覆盖锁定为起点渲染总高（而非清空回比例）
    expect(saved.heightOverride).toBe(500);
    expect(saved.mode).toBe('window');
    root.unmount();
  });

  it('右缘拖拽自等比起点：高度锁定为起点等比总高，宽度变化后不再跟随比例', () => {
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]); // 比例 1.5
    openPlayer();
    const win = screen.getByTestId('player-window');
    // 起点等比总高 = 400/1.5 + 头部 44
    const startHeight = 400 / 1.5 + 44;
    expect(parseFloat(win.style.height)).toBeCloseTo(startHeight, 6);
    const handle = screen.getByTestId('player-resize-right');
    fireEvent.pointerDown(handle, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 300, pointerId: 1 }); // dx=+200 → 600
    expect(parseFloat(win.style.width)).toBe(600);
    // 高度保持起点等比总高（若按比例跟随应为 600/1.5+44=444）
    expect(parseFloat(win.style.height)).toBeCloseTo(startHeight, 6);
    fireEvent.pointerUp(handle, { clientX: 300, pointerId: 1 });
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string);
    expect(saved.width).toBe(600);
    expect(saved.heightOverride).toBeCloseTo(startHeight, 6);
    root.unmount();
  });

  it('下边缘指针拖动设置高度覆盖：容器显式 height、移除 aspectRatio（媒体 contain），pointerup 落盘覆盖', () => {
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    // 比例态基线：容器总高 = 400/1.5 + 头部 44
    expect(parseFloat(win.style.height)).toBeCloseTo(400 / 1.5 + 44, 6);
    expect(win.style.aspectRatio).toBe('');
    const handle = screen.getByTestId('player-resize-bottom');
    // 起点容器高 = 400/1.5 + 44，dy=+300 → 覆盖高 = 400/1.5 + 44 + 300
    fireEvent.pointerDown(handle, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 400, pointerId: 1 });
    expect(parseFloat(win.style.height)).toBeCloseTo(400 / 1.5 + 44 + 300, 6);
    expect(win.style.aspectRatio).toBe('');
    fireEvent.pointerUp(handle, { clientY: 400, pointerId: 1 });
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string) as { width: number; heightOverride?: number };
    expect(saved.heightOverride).toBeCloseTo(400 / 1.5 + 44 + 300, 6);
    expect(saved.width).toBe(400);
    root.unmount();
  });

  it('右下角拖拽宽高各自独立跟随：height 只由 dy 决定不受媒体比例影响，pointerup 落盘宽高', () => {
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window', heightOverride: 500 }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    expect(parseFloat(win.style.height)).toBe(500);
    const handle = screen.getByTestId('player-resize-corner');
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 220, clientY: 340, pointerId: 1 }); // dx=+120、dy=+240
    expect(parseFloat(win.style.width)).toBe(520);
    // 高度只由 dy 决定：500+240=740（旧等比语义为 520/1.5+44≈390.7，锁起点覆盖则为 500，均不符）
    expect(parseFloat(win.style.height)).toBeCloseTo(740, 6);
    fireEvent.pointerUp(handle, { clientX: 220, clientY: 340, pointerId: 1 });
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string);
    expect(saved.width).toBe(520);
    expect(saved.heightOverride).toBeCloseTo(740, 6);
    root.unmount();
  });

  it('双击右缘/右下角：清除高度覆盖回等比（容器高 = width/ratio + 44）并落盘', () => {
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window', heightOverride: 500 }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    expect(parseFloat(win.style.height)).toBe(500);
    // 双击右缘：覆盖清除，高度回等比公式（400/1.5 + 头部 44）
    fireEvent.doubleClick(screen.getByTestId('player-resize-right'));
    expect(parseFloat(win.style.height)).toBeCloseTo(400 / 1.5 + 44, 6);
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string);
    expect(saved.heightOverride).toBeUndefined();
    expect(saved.width).toBe(400);
    root.unmount();
    cleanup();
    // 右下角双击同理
    const storage2 = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window', heightOverride: 500 }));
    const { root: root2 } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    expect(parseFloat(screen.getByTestId('player-window').style.height)).toBe(500);
    fireEvent.doubleClick(screen.getByTestId('player-resize-corner'));
    expect(parseFloat(screen.getByTestId('player-window').style.height)).toBeCloseTo(400 / 1.5 + 44, 6);
    expect(JSON.parse(storage2.setItem.mock.calls.at(-1)![1] as string).heightOverride).toBeUndefined();
    root2.unmount();
  });

  it('宽度 clamp 下限 280；mini 形态渲染后无 resize 抓手', async () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 300, mode: 'window' }));
    const { root } = setup([item('a')]);
    openPlayer();
    const handle = screen.getByTestId('player-resize-right');
    fireEvent.pointerDown(handle, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: -1000, pointerId: 1 }); // 大幅左拖 → clamp 280
    expect(parseFloat(screen.getByTestId('player-window').style.width)).toBe(280);
    fireEvent.pointerUp(handle, { clientX: -1000, pointerId: 1 });
    root.unmount();
    // mini 形态：无任何边缘抓手
    cleanup();
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'mini' }));
    const { root: root2 } = setup([item('a')]);
    openPlayer();
    await waitFor(() => expect(screen.getByTestId('player-window').getAttribute('data-mode')).toBe('mini'));
    expect(screen.queryByTestId('player-resize-right')).toBeNull();
    expect(screen.queryByTestId('player-resize-bottom')).toBeNull();
    expect(screen.queryByTestId('player-resize-corner')).toBeNull();
    root2.unmount();
  });
});

describe('hotfix-3：等比高度显式公式（容器高 = 内容区高 + 头部 44）', () => {
  it('横图等比：容器 height = width/ratio + 44（头部），不再写 aspectRatio', () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    expect(parseFloat(win.style.width)).toBe(400);
    // 内容区高（容器高 - 44）= 400/1.5 正好贴合媒体比例，零系统性留白
    expect(parseFloat(win.style.height)).toBeCloseTo(400 / 1.5 + 44, 6);
    expect(win.style.aspectRatio).toBe('');
    root.unmount();
  });

  it('竖图以高度定宽：容器 height = 视口预算高 + 44，宽度 = 预算高 × 比例', () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('tall', 'image', { width: 600, height: 1500 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    const budget = VH * 0.8;
    expect(parseFloat(win.style.width)).toBeCloseTo(budget * 0.4, 6);
    expect(parseFloat(win.style.height)).toBeCloseTo(budget + 44, 6);
    expect(win.style.aspectRatio).toBe('');
    root.unmount();
  });

  it('mini 形态：容器高度 = 240/ratio + 44', async () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'mini' }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    await waitFor(() => expect(screen.getByTestId('player-window').getAttribute('data-mode')).toBe('mini'));
    const win = screen.getByTestId('player-window');
    expect(parseFloat(win.style.width)).toBe(240);
    expect(parseFloat(win.style.height)).toBeCloseTo(240 / 1.5 + 44, 6);
    root.unmount();
  });

  it('ImageViewPane 内容容器无 p-4/p-10 内边距（浮窗内媒体贴边 contain）', () => {
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    // 内容区（relative min-h-0 flex-1）内第一个 absolute inset-0 即 ImageViewPane 根
    const paneRoot = win.querySelector('.min-h-0.flex-1 > .absolute.inset-0');
    expect(paneRoot).toBeTruthy();
    const content = paneRoot!.children[0] as HTMLElement;
    expect(content.className).not.toContain('p-4');
    expect(content.className).not.toContain('p-10');
    root.unmount();
  });
});

describe('hotfix-3：拖动/缩放 move 期直写 DOM（零重渲染），pointerup 才同步状态并落盘', () => {
  it('拖动 pointermove：style.left/top 即时更新、不落盘、渲染次数不随 move 增加；pointerup 落 state + 落盘', () => {
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    const handle = screen.getByTestId('player-window-handle');
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    const rendersAtStart = playerRenderCount;
    // 多次 move（不 pointerup）：直写覆盖，最后一次 (160,150) → dx=+60/dy=+50 → 位置即时跟手
    fireEvent.pointerMove(handle, { clientX: 130, clientY: 120, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 150, clientY: 140, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 160, clientY: 150, pointerId: 1 });
    expect(parseFloat(win.style.left)).toBeCloseTo(70, 6);
    expect(parseFloat(win.style.top)).toBeCloseTo(70, 6);
    // 交互期未落盘
    expect(storage.setItem).not.toHaveBeenCalled();
    // 渲染次数不随 move 增加（React 状态未变，直写 DOM 全权接管）
    expect(playerRenderCount).toBe(rendersAtStart);
    // pointerup：一次性同步状态并落盘（与直写值一致）
    fireEvent.pointerUp(handle, { clientX: 160, clientY: 150, pointerId: 1 });
    expect(parseFloat(win.style.left)).toBeCloseTo(70, 6);
    expect(parseFloat(win.style.top)).toBeCloseTo(70, 6);
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string);
    expect(saved.x).toBeCloseTo(70, 6);
    expect(saved.y).toBeCloseTo(70, 6);
    expect(saved.width).toBe(400);
    root.unmount();
  });

  it('右缘 resize pointermove：宽度即时更新、高度直写锁定起点值（不按比例）、不落盘、零渲染；pointerup 落盘覆盖', () => {
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window', heightOverride: 500 }));
    const { root } = setup([item('a', 'image', { width: 3000, height: 600 })]); // 比例 5
    openPlayer();
    const win = screen.getByTestId('player-window');
    const handle = screen.getByTestId('player-resize-right');
    fireEvent.pointerDown(handle, { clientX: 100, button: 0, pointerId: 1 });
    const rendersAtStart = playerRenderCount;
    fireEvent.pointerMove(handle, { clientX: 220, pointerId: 1 }); // dx=+120 → 520
    // 直写即时生效：宽度 520、高度锁定起点渲染总高 500（旧语义按比例推导 520/5+44 已废除）
    expect(parseFloat(win.style.width)).toBe(520);
    expect(parseFloat(win.style.height)).toBe(500);
    expect(win.style.aspectRatio).toBe('');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(playerRenderCount).toBe(rendersAtStart);
    fireEvent.pointerUp(handle, { clientX: 220, pointerId: 1 });
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string);
    expect(saved.width).toBe(520);
    expect(saved.heightOverride).toBe(500);
    root.unmount();
  });

  it('下缘 resize pointermove：高度即时直写（移除 aspectRatio）、不落盘、零渲染；pointerup 落盘覆盖', () => {
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    const handle = screen.getByTestId('player-resize-bottom');
    fireEvent.pointerDown(handle, { clientY: 100, button: 0, pointerId: 1 });
    const rendersAtStart = playerRenderCount;
    fireEvent.pointerMove(handle, { clientY: 400, pointerId: 1 }); // dy=+300
    // 起点 = 400/1.5 + 44（等比公式容器高），直写 +300 后覆盖生效
    const expected = 400 / 1.5 + 44 + 300;
    expect(parseFloat(win.style.height)).toBeCloseTo(expected, 6);
    expect(win.style.aspectRatio).toBe('');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(playerRenderCount).toBe(rendersAtStart);
    fireEvent.pointerUp(handle, { clientY: 400, pointerId: 1 });
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string);
    expect(saved.heightOverride).toBeCloseTo(expected, 6);
    expect(saved.width).toBe(400);
    root.unmount();
  });
});
