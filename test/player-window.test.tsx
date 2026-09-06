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

  it('动画取证：window/mini 切换为同一 DOM 节点形变（CSS transition），fab 经 AnimatePresence 互斥出现', async () => {
    const { root } = setup([item('a')]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    expect(win.getAttribute('data-mode')).toBe('window');
    fireEvent.click(screen.getByTitle('Mini Mode'));
    const mini = screen.getByTestId('player-window');
    expect(mini.getAttribute('data-mode')).toBe('mini');
    // 同一 DOM 节点：window↔mini 同 key 容器不卸载，形态形变由容器 CSS transition 承担（hotfix-6 起移除 layout）
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
  it('右缘拖拽自由改宽（clamp 视口预算）：高度锁定起点渲染总高不被比例重算（覆盖为会话内存态，不落盘）', () => {
    // 超宽媒体（比例 5）：宽度触上限时推导高度仍远低于 80% 视口高预算，clamp 断言不受双向预算收窄干扰
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a', 'image', { width: 3000, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    // 起点等比渲染总高 = 400/5 + 44
    const startHeight = 400 / 5 + 44;
    expect(parseFloat(win.style.height)).toBeCloseTo(startHeight, 6);
    const handle = screen.getByTestId('player-resize-right');
    fireEvent.pointerDown(handle, { clientX: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 260, pointerId: 1 }); // dx=+160 → 400+160=560
    expect(parseFloat(win.style.width)).toBe(560);
    // hotfix-4：高度保持起点值，不按比例重算（旧语义 560/5+44 已废除）
    expect(parseFloat(win.style.height)).toBeCloseTo(startHeight, 6);
    // 大幅拖动触上限 clamp（视口宽 - 48）
    fireEvent.pointerMove(handle, { clientX: 5000, pointerId: 1 });
    expect(parseFloat(win.style.width)).toBe(VW - 48);
    // 回到 560 再落盘
    fireEvent.pointerMove(handle, { clientX: 260, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 260, pointerId: 1 });
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string) as { width: number; heightOverride?: number; mode: string };
    expect(saved.width).toBe(560);
    // hotfix-6：高度覆盖不再落盘（会话内存态）；会话内锁定语义由上方高度断言承载
    expect(saved.heightOverride).toBeUndefined();
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
    // pointerup 后会话内高度覆盖继续生效（容器显式高度保持）
    expect(parseFloat(win.style.height)).toBeCloseTo(startHeight, 6);
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string);
    expect(saved.width).toBe(600);
    // hotfix-6：覆盖为会话内存态，不再落盘
    expect(saved.heightOverride).toBeUndefined();
    root.unmount();
  });

  it('下边缘指针拖动设置高度覆盖：容器显式 height、移除 aspectRatio（媒体 contain）；覆盖仅会话内生效不落盘', () => {
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
    // 覆盖在当前会话内继续生效（容器显式高度保持）
    expect(parseFloat(win.style.height)).toBeCloseTo(400 / 1.5 + 44 + 300, 6);
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string) as { width: number; heightOverride?: number };
    // hotfix-6：覆盖不再落盘（会话内存态）
    expect(saved.heightOverride).toBeUndefined();
    expect(saved.width).toBe(400);
    root.unmount();
  });

  it('右下角拖拽宽高各自独立跟随：height 只由 dy 决定不受媒体比例影响（覆盖为会话内存态，不落盘）', () => {
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    // 起点等比渲染总高 = 400/1.5 + 44
    const startHeight = 400 / 1.5 + 44;
    const handle = screen.getByTestId('player-resize-corner');
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 220, clientY: 340, pointerId: 1 }); // dx=+120、dy=+240
    expect(parseFloat(win.style.width)).toBe(520);
    // 高度只由 dy 决定：起点等比总高 + 240（旧等比语义为 520/1.5+44≈390.7，不符）
    expect(parseFloat(win.style.height)).toBeCloseTo(startHeight + 240, 6);
    fireEvent.pointerUp(handle, { clientX: 220, clientY: 340, pointerId: 1 });
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string);
    expect(saved.width).toBe(520);
    // hotfix-6：覆盖不再落盘（会话内存态）
    expect(saved.heightOverride).toBeUndefined();
    root.unmount();
  });

  it('双击右缘/右下角：清除高度覆盖回等比（容器高 = width/ratio + 44），落盘不含覆盖字段', () => {
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    // 先经下缘拖拽建立高度覆盖（hotfix-6 起为会话内存态）：起点等比总高 400/1.5+44，dy=+300
    const ratioHeight = 400 / 1.5 + 44;
    const bottom = screen.getByTestId('player-resize-bottom');
    fireEvent.pointerDown(bottom, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(bottom, { clientY: 400, pointerId: 1 });
    expect(parseFloat(win.style.height)).toBeCloseTo(ratioHeight + 300, 6);
    // 双击右缘：覆盖清除，高度回等比公式
    fireEvent.doubleClick(screen.getByTestId('player-resize-right'));
    expect(parseFloat(win.style.height)).toBeCloseTo(ratioHeight, 6);
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string);
    expect(saved.heightOverride).toBeUndefined();
    expect(saved.width).toBe(400);
    root.unmount();
    cleanup();
    // 右下角双击同理：先建立覆盖再双击清除
    const storage2 = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root: root2 } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win2 = screen.getByTestId('player-window');
    const bottom2 = screen.getByTestId('player-resize-bottom');
    fireEvent.pointerDown(bottom2, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(bottom2, { clientY: 400, pointerId: 1 });
    expect(parseFloat(win2.style.height)).toBeCloseTo(ratioHeight + 300, 6);
    fireEvent.doubleClick(screen.getByTestId('player-resize-corner'));
    expect(parseFloat(win2.style.height)).toBeCloseTo(ratioHeight, 6);
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

  it('右缘 resize pointermove：宽度即时更新、高度直写锁定起点等比总高（不按比例）、不落盘、零渲染；pointerup 落盘', () => {
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a', 'image', { width: 3000, height: 600 })]); // 比例 5
    openPlayer();
    const win = screen.getByTestId('player-window');
    // 起点等比渲染总高 = 400/5 + 44
    const startHeight = 400 / 5 + 44;
    const handle = screen.getByTestId('player-resize-right');
    fireEvent.pointerDown(handle, { clientX: 100, button: 0, pointerId: 1 });
    const rendersAtStart = playerRenderCount;
    fireEvent.pointerMove(handle, { clientX: 220, pointerId: 1 }); // dx=+120 → 520
    // 直写即时生效：宽度 520、高度锁定起点渲染总高（旧语义按比例推导 520/5+44 已废除）
    expect(parseFloat(win.style.width)).toBe(520);
    expect(parseFloat(win.style.height)).toBeCloseTo(startHeight, 6);
    expect(win.style.aspectRatio).toBe('');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(playerRenderCount).toBe(rendersAtStart);
    fireEvent.pointerUp(handle, { clientX: 220, pointerId: 1 });
    const saved = JSON.parse(storage.setItem.mock.calls.at(-1)![1] as string);
    expect(saved.width).toBe(520);
    // hotfix-6：覆盖不再落盘（会话内存态）
    expect(saved.heightOverride).toBeUndefined();
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
    // hotfix-6：覆盖不再落盘（会话内存态）；会话内直写与锁定语义由上方断言承载
    expect(saved.heightOverride).toBeUndefined();
    expect(saved.width).toBe(400);
    root.unmount();
  });
});

describe('hotfix-5：加载后真实比例自适应（库内尺寸元数据缺失时的运行时校正）', () => {
  // 生产库 thumb 宽高字段全 NULL → resolveAspect 只能兜底 16:9，窗口形状与媒体无关。
  // hotfix-5：面板在媒体解码后（img onLoad / video onLoadedMetadata）回调上报真实比例，
  // PlayerWindow 以 loadedRatio 覆盖兜底比例重算容器形状；切换队列项时重置回兜底。
  // jsdom 不解码媒体：以 Object.defineProperty 直接注入 naturalWidth/naturalHeight、
  // videoWidth/videoHeight，再 fireEvent 触发对应加载事件（React 合成事件 currentTarget 即媒体节点）。
  const defineNaturalSize = (el: Element, props: Record<string, number>) => {
    for (const [key, value] of Object.entries(props)) {
      Object.defineProperty(el, key, { value, configurable: true });
    }
  };

  it('图片 onLoad 上报真实比例：16:9 兜底形状收窄为真实竖图（以 80% 视口高预算定宽）', () => {
    const { container, root } = setup([item('plain')]); // 无尺寸信息 → 兜底 16:9
    openPlayer();
    const win = screen.getByTestId('player-window');
    // 兜底形状基线：宽度为默认记忆宽度，高度 = 宽/(16/9) + 头部 44
    const fallbackWidth = parseFloat(win.style.width);
    expect(parseFloat(win.style.height)).toBeCloseTo(fallbackWidth / (16 / 9) + 44, 6);
    // 解码完成：真实竖图 600x1500（比例 0.4）→ 窗口形状随真实比例变化
    const img = container.querySelector('img')!;
    defineNaturalSize(img, { naturalWidth: 600, naturalHeight: 1500 });
    fireEvent.load(img);
    const budget = VH * 0.8;
    // 竖图收窄：容器高 = 视口预算 + 头部 44，宽 = 预算 × 0.4（未触 240 宽度下限）
    expect(parseFloat(win.style.width)).toBeCloseTo(budget * 0.4, 6);
    expect(parseFloat(win.style.height)).toBeCloseTo(budget + 44, 6);
    root.unmount();
  });

  it('视频 onLoadedMetadata 上报真实比例：容器从竖图兜底态转为 16:9', () => {
    // 元数据假竖图（aspectRatio 0.5）：初始以高度定宽收窄
    const { container, root } = setup([item('v', 'video', { aspectRatio: 0.5 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    const budget = VH * 0.8;
    expect(parseFloat(win.style.height)).toBeCloseTo(budget + 44, 6);
    expect(parseFloat(win.style.width)).toBeCloseTo(budget * 0.5, 6);
    // 元数据加载：真实 1920x1080（16:9）→ 回到记忆宽度、高度按 16:9 推导
    const video = container.querySelector('video')!;
    defineNaturalSize(video, { videoWidth: 1920, videoHeight: 1080 });
    fireEvent.loadedMetadata(video);
    const width = parseFloat(win.style.width);
    expect(width).toBeCloseTo(VW * 0.42, 6);
    expect(parseFloat(win.style.height)).toBeCloseTo(width / (16 / 9) + 44, 6);
    root.unmount();
  });

  it('切换队列项时 loadedRatio 重置：下一项加载前容器回 resolveAspect 兜底形状', () => {
    const { container, root } = setup([item('a'), item('b')]); // 两项均无尺寸信息 → 兜底 16:9
    openPlayer();
    const win = screen.getByTestId('player-window');
    // 第一项解码为竖图 → 收窄
    const img = container.querySelector('img')!;
    defineNaturalSize(img, { naturalWidth: 600, naturalHeight: 1500 });
    fireEvent.load(img);
    expect(parseFloat(win.style.width)).toBeCloseTo(VH * 0.8 * 0.4, 6);
    // 切换到下一项：loadedRatio 重置为 null → 回兜底 16:9 形状（默认记忆宽度）
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    const width = parseFloat(win.style.width);
    expect(width).toBeCloseTo(VW * 0.42, 6);
    expect(parseFloat(win.style.height)).toBeCloseTo(width / (16 / 9) + 44, 6);
    root.unmount();
  });

  it('heightOverride 存在时 onMediaRatio 不改变容器高度（用户锁定优先），宽度仍随真实比例', () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { container, root } = setup([item('plain')]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    // hotfix-6：先经下缘拖拽建立高度覆盖 500（会话内存态）——起点等比总高 = 400/(16/9) + 44，dy=+231
    const startHeight = 400 / (16 / 9) + 44;
    const bottom = screen.getByTestId('player-resize-bottom');
    fireEvent.pointerDown(bottom, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(bottom, { clientY: 100 + 231, pointerId: 1 });
    expect(parseFloat(win.style.height)).toBe(500);
    // 解码为竖图：容器高度保持锁定值 500（覆盖优先）；宽度仍随真实比例收窄（既有双向预算结构不变）
    const img = container.querySelector('img')!;
    defineNaturalSize(img, { naturalWidth: 600, naturalHeight: 1500 });
    fireEvent.load(img);
    expect(parseFloat(win.style.height)).toBe(500);
    expect(parseFloat(win.style.width)).toBeCloseTo(VH * 0.8 * 0.4, 6);
    root.unmount();
  });
});

describe('hotfix-6：heightOverride 会话生命周期、缓存命中比例兜底与尺寸变化动画', () => {
  it('open 时忽略偏好中的 heightOverride：覆盖为会话内存态，打开即回等比自适应', () => {
    // 旧语义会从偏好恢复覆盖高 500 并锁死比例自适应；新语义打开即等比
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window', heightOverride: 500 }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    expect(parseFloat(win.style.height)).toBeCloseTo(400 / 1.5 + 44, 6);
    root.unmount();
  });

  it('切换队列项清除会话内高度覆盖：新项回等比自适应', () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 }), item('b')]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    // 当前会话内经下缘拖拽建立覆盖：起点等比总高 400/1.5+44，dy=+300
    const bottom = screen.getByTestId('player-resize-bottom');
    fireEvent.pointerDown(bottom, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerUp(bottom, { clientY: 400, pointerId: 1 });
    expect(parseFloat(win.style.height)).toBeCloseTo(400 / 1.5 + 44 + 300, 6);
    // 切换到下一项：覆盖清除，容器回新项的等比形状（b 无尺寸信息 → 16:9 兜底）
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(parseFloat(win.style.height)).toBeCloseTo(400 / (16 / 9) + 44, 6);
    root.unmount();
  });

  it('缓存命中兜底：img.complete 且已解码时无需 onLoad 即上报真实比例（容器按真实比例成形）', () => {
    const { container, root } = setup([item('plain')]); // 无尺寸信息 → 兜底 16:9
    openPlayer();
    const win = screen.getByTestId('player-window');
    const fallbackWidth = parseFloat(win.style.width);
    expect(parseFloat(win.style.height)).toBeCloseTo(fallbackWidth / (16 / 9) + 44, 6);
    // 模拟浏览器缓存命中：complete = true + 已解码尺寸，全程不触发 load 事件
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 600, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 1500, configurable: true });
    // 任意一次重渲染后的兜底检查即上报（等价 onLoad）；用同 id patch 触发重渲染
    fireEvent.click(screen.getByTestId('patch-first'));
    const budget = VH * 0.8;
    expect(parseFloat(win.style.width)).toBeCloseTo(budget * 0.4, 6);
    expect(parseFloat(win.style.height)).toBeCloseTo(budget + 44, 6);
    root.unmount();
  });

  it('视频缓存命中兜底：readyState ≥ 1 且已解码时无需 onLoadedMetadata 即上报真实比例', () => {
    // 元数据假竖图（aspectRatio 0.5）：初始以高度定宽收窄
    const { container, root } = setup([item('v', 'video', { aspectRatio: 0.5 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    const budget = VH * 0.8;
    expect(parseFloat(win.style.height)).toBeCloseTo(budget + 44, 6);
    expect(parseFloat(win.style.width)).toBeCloseTo(budget * 0.5, 6);
    // 模拟元数据已就绪的缓存命中（不派发 loadedmetadata 事件）
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'readyState', { value: 1, configurable: true });
    Object.defineProperty(video, 'videoWidth', { value: 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { value: 1080, configurable: true });
    fireEvent.click(screen.getByTestId('patch-first'));
    const width = parseFloat(win.style.width);
    expect(width).toBeCloseTo(VW * 0.42, 6);
    expect(parseFloat(win.style.height)).toBeCloseTo(width / (16 / 9) + 44, 6);
    root.unmount();
  });

  it('尺寸变化动画：非交互期容器 transition 含 width/height/left/top；交互期为 none（跟手直写），结束后恢复', () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a', 'image', { width: 900, height: 600 })]);
    openPlayer();
    const win = screen.getByTestId('player-window');
    expect(win.style.transition).toContain('width');
    expect(win.style.transition).toContain('height');
    expect(win.style.transition).toContain('left');
    expect(win.style.transition).toContain('top');
    const handle = screen.getByTestId('player-window-handle');
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    expect(win.style.transition).toBe('none');
    fireEvent.pointerUp(handle, { clientX: 120, clientY: 110, pointerId: 1 });
    expect(win.style.transition).toContain('width');
    root.unmount();
  });
});

describe('maximized：浏览器视口内最大化（非系统全屏）', () => {
  it('点击最大化按钮：容器 data-mode=maximized 且铺满视口留 12px 边距；不落盘偏好、不渲染系统全屏', () => {
    const storage = stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a')]);
    openPlayer();
    fireEvent.click(screen.getByTestId('player-maximize-btn'));
    const win = screen.getByTestId('player-window');
    expect(win.getAttribute('data-mode')).toBe('maximized');
    expect(parseFloat(win.style.left)).toBe(12);
    expect(parseFloat(win.style.top)).toBe(12);
    expect(parseFloat(win.style.width)).toBe(VW - 24);
    expect(parseFloat(win.style.height)).toBe(VH - 24);
    // maximized 为视口内临时形态：与 fullscreen 同不落盘偏好
    expect(storage.setItem).not.toHaveBeenCalled();
    // 不走系统全屏分支
    expect(screen.queryByTestId('player-fullscreen')).toBeNull();
    root.unmount();
  });

  it('maximized 形态信息面板可用、resize 抓手不渲染、全屏按钮仍在', () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a')]);
    openPlayer();
    fireEvent.click(screen.getByTestId('player-maximize-btn'));
    fireEvent.click(screen.getByTitle('File Info'));
    expect(screen.getByText('file_details')).toBeTruthy();
    expect(screen.queryByTestId('player-resize-right')).toBeNull();
    expect(screen.queryByTestId('player-resize-bottom')).toBeNull();
    expect(screen.queryByTestId('player-resize-corner')).toBeNull();
    expect(screen.getByTestId('player-fullscreen-btn')).toBeTruthy();
    root.unmount();
  });

  it('再次点击最大化按钮（图标切为 Minimize）回 window 且恢复记忆宽度与位置', () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a')]);
    openPlayer();
    fireEvent.click(screen.getByTestId('player-maximize-btn'));
    expect(screen.getByTestId('player-window').getAttribute('data-mode')).toBe('maximized');
    fireEvent.click(screen.getByTestId('player-maximize-btn'));
    const win = screen.getByTestId('player-window');
    expect(win.getAttribute('data-mode')).toBe('window');
    expect(parseFloat(win.style.width)).toBe(400);
    expect(parseFloat(win.style.left)).toBe(10);
    expect(parseFloat(win.style.top)).toBe(20);
    root.unmount();
  });

  it('Esc 在 maximized 形态回 window（不关闭播放器，与 fullscreen 兜底分支区分）', () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'window' }));
    const { root } = setup([item('a')]);
    openPlayer();
    fireEvent.click(screen.getByTestId('player-maximize-btn'));
    fireEvent.keyDown(window, { key: 'Escape' });
    const win = screen.getByTestId('player-window');
    expect(win.getAttribute('data-mode')).toBe('window');
    expect(screen.getByTestId('player-window')).toBeTruthy();
    root.unmount();
  });

  it('偏好中的 mode=maximized 不能作为持久形态恢复：重开播放器为 window', () => {
    stubStorage(JSON.stringify({ x: 10, y: 20, width: 400, mode: 'maximized' }));
    const { root } = setup([item('a')]);
    openPlayer();
    expect(screen.getByTestId('player-window').getAttribute('data-mode')).toBe('window');
    root.unmount();
  });
});
