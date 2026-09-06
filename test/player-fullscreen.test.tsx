// test/player-fullscreen.test.tsx
// Task D（独占全屏形态）TDD 测试：window 控制栏全屏按钮进入全屏、黑底独占布局、
// 宿主全屏 effect（requestFullscreen 可选链 + catch，jsdom 无 API 不抛错）、
// fullscreenchange 退出回 window（含用户 Esc 场景模拟）、退出按钮/Esc 的 jsdom 兜底、
// 控制栏全套（收藏/信息/全屏退出/关闭）与左右导航队列边界隐藏、window↔fullscreen 往返队列状态保持。
// 沿用 test/player-window.test.tsx 的 localStorage stub + Harness/setup 模式（Node 26 环境）。
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerProvider, useMediaPlayer } from '../components/player/PlayerProvider';
import { MediaPlayer } from '../components/player/MediaPlayer';
import type { MediaItem } from '../types';

const stubStorage = (value: string | null = null) => {
  const storage = { getItem: vi.fn(() => value), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
  vi.stubGlobal('localStorage', storage);
  return storage;
};

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  stubStorage();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // 恢复本文件注入的 Fullscreen API 桩，避免泄漏到其它测试文件
  Reflect.deleteProperty(document, 'fullscreenElement');
  Reflect.deleteProperty(HTMLDivElement.prototype, 'requestFullscreen');
  Reflect.deleteProperty(document, 'exitFullscreen');
});

const item = (id: string, mediaType: 'image' | 'video' = 'image', extra: Partial<MediaItem> = {}): MediaItem => ({
  id, url: `/api/file/${id}`, name: `${id}.jpg`, path: `/media/${id}.jpg`,
  folderPath: '/media', size: 1,
  type: mediaType === 'image' ? 'image/jpeg' : 'video/mp4',
  lastModified: 0, mediaType, sourceId: 'local', ...extra,
});

const Harness = ({ items, onToggleFavorite }: {
  items: MediaItem[];
  onToggleFavorite?: (item: MediaItem, type: 'file') => void;
}) => {
  const player = useMediaPlayer();
  return (
    <>
      <button onClick={() => player.open({ items, startIndex: 0 })}>open</button>
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

/** 进入全屏形态：点击 window 控制栏的全屏按钮（jsdom 默认无 requestFullscreen，纯 CSS 全屏）。
 *  仅切形态不重新 open——调用方需先 openPlayer，且 keyDown 切项不会被重置。 */
const enterFullscreen = async () => {
  fireEvent.click(screen.getByTestId('player-fullscreen-btn'));
  await waitFor(() => expect(screen.queryByTestId('player-fullscreen')).toBeTruthy());
};

describe('PlayerFullscreen 独占全屏形态', () => {
  it('window 控制栏全屏按钮已启用，点击进入全屏：渲染黑底独占布局且浮窗退出', async () => {
    const { root } = setup([item('a')]);
    openPlayer();
    const btn = screen.getByTestId('player-fullscreen-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    const fs = await screen.findByTestId('player-fullscreen');
    // 黑底独占布局：fixed inset-0 z-50 bg-black/95
    expect(fs.className).toContain('fixed');
    expect(fs.className).toContain('inset-0');
    expect(fs.className).toContain('z-50');
    expect(fs.className).toContain('bg-black/95');
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    root.unmount();
  });

  it('宿主 effect：进入全屏时在容器元素上调用 requestFullscreen；无 API 的 jsdom 环境不抛错', async () => {
    const fsMock = vi.fn(function (this: Element) { return Promise.resolve(); });
    HTMLDivElement.prototype.requestFullscreen = fsMock as unknown as typeof HTMLDivElement.prototype.requestFullscreen;
    const { container, root } = setup([item('a')]);
    openPlayer();
    fireEvent.click(screen.getByTestId('player-fullscreen-btn'));
    await screen.findByTestId('player-fullscreen');
    // 宿主 effect 在全屏容器 ref 上请求原生全屏
    await act(async () => { await Promise.resolve(); });
    expect(fsMock).toHaveBeenCalledTimes(1);
    expect(fsMock.mock.instances[0]).toBe(screen.getByTestId('player-fullscreen'));
    expect(container.querySelector('[data-testid="player-fullscreen"]')).toBeTruthy();
    root.unmount();
  });

  it('requestFullscreen 返回拒绝的 Promise 被 catch 吞掉：不产生未处理拒绝，全屏分支照常渲染', async () => {
    const fsMock = vi.fn(() => Promise.reject(new Error('denied')));
    HTMLDivElement.prototype.requestFullscreen = fsMock as unknown as typeof HTMLDivElement.prototype.requestFullscreen;
    const { root } = setup([item('a')]);
    openPlayer();
    await enterFullscreen();
    await act(async () => { await Promise.resolve(); });
    expect(fsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('player-fullscreen')).toBeTruthy();
    root.unmount();
  });

  it('fullscreenchange（fullscreenElement 清空）且处于全屏形态 → 回 window 形态，队列状态保持', async () => {
    const { root } = setup([item('a'), item('b')]);
    openPlayer();
    // 进入全屏前先切到第二项：验证往返后 index 保持
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await enterFullscreen();
    // 模拟用户 Esc 退出浏览器原生全屏：fullscreenElement 置空 + 手动派发 fullscreenchange
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    await waitFor(() => expect(screen.queryByTestId('player-fullscreen')).toBeNull());
    // 回到 window 浮窗且仍停在第二项（index 保持：Previous 可见、Next 隐藏、文件名正确）
    await waitFor(() => expect(screen.getByTestId('player-window')).toBeTruthy());
    expect(screen.getByText('b.jpg')).toBeTruthy();
    expect(screen.getByTitle('Previous')).toBeTruthy();
    expect(screen.queryByTitle('Next')).toBeNull();
    root.unmount();
  });

  it('fullscreenchange 但 fullscreenElement 非空（进入原生全屏的确认事件）不退出全屏', async () => {
    const { root } = setup([item('a')]);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.documentElement });
    openPlayer();
    await enterFullscreen();
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(screen.getByTestId('player-fullscreen')).toBeTruthy();
    root.unmount();
  });

  it('全屏形态退出按钮：jsdom 兜底路径直接回 window 形态', async () => {
    const { root } = setup([item('a')]);
    openPlayer();
    await enterFullscreen();
    fireEvent.click(screen.getByTitle('Exit Full Screen'));
    await waitFor(() => expect(screen.queryByTestId('player-fullscreen')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('player-window')).toBeTruthy());
    root.unmount();
  });

  it('全屏形态内 Esc：无原生全屏激活时兜底回 window（不关闭播放器）；原生全屏激活时交给浏览器', async () => {
    const { root } = setup([item('a')]);
    openPlayer();
    await enterFullscreen();
    // 兜底场景（requestFullscreen 不可用）：Esc 回 window 形态而非关闭播放器
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.getByTestId('player-window')).toBeTruthy());
    expect(screen.queryByTestId('player-fullscreen')).toBeNull();
    root.unmount();
    // 原生全屏激活场景：Esc 由浏览器接管（fullscreenchange 才回 window），不误关播放器
    document.body.replaceChildren();
    cleanup();
    const { root: root2 } = setup([item('a')]);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: document.documentElement });
    openPlayer();
    await enterFullscreen();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('player-fullscreen')).toBeTruthy();
    // 浏览器随后派发 fullscreenchange（fullscreenElement 已清空）→ 回 window
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    await act(async () => { document.dispatchEvent(new Event('fullscreenchange')); });
    await waitFor(() => expect(screen.getByTestId('player-window')).toBeTruthy());
    root2.unmount();
  });

  it('全屏控制栏全套：收藏回调、信息面板开关、关闭按钮', async () => {
    const favorite = vi.fn();
    const { root } = setup([item('a')], favorite);
    openPlayer();
    await enterFullscreen();
    fireEvent.click(screen.getByTitle('Toggle Favorite'));
    expect(favorite).toHaveBeenCalledTimes(1);
    expect((favorite.mock.calls[0][0] as MediaItem).id).toBe('a');
    expect(favorite.mock.calls[0][1]).toBe('file');
    // 信息面板继续由壳层承载：全屏内可开关
    expect(screen.queryByText('file_details')).toBeNull();
    fireEvent.click(screen.getByTitle('File Info'));
    expect(screen.getByText('file_details')).toBeTruthy();
    // 关闭按钮：整个播放器关闭（不回落 window 浮窗）
    fireEvent.click(screen.getByTitle('Close'));
    await waitFor(() => expect(screen.queryByTestId('player-fullscreen')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('player-window')).toBeNull());
    root.unmount();
  });

  it('hotfix-2：全屏形态点 Close 完整关闭——先退出系统全屏（exitFullscreen 被调用），调度层不再渲染全屏空壳', async () => {
    const exitMock = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitMock });
    const { root } = setup([item('a')]);
    openPlayer();
    await enterFullscreen();
    fireEvent.click(screen.getByTitle('Close'));
    // 完整关闭第一步：先请求浏览器退出原生全屏（否则黑底容器残留 + 系统全屏锁死）
    expect(exitMock).toHaveBeenCalledTimes(1);
    // 容器收敛：全屏空壳不再渲染
    await waitFor(() => expect(screen.queryByTestId('player-fullscreen')).toBeNull());
    // 调度层兜底：close 后任何路径都不再渲染全屏空壳，window 浮窗也不出现（isOpen=false 即完全关闭）
    expect(screen.queryByTestId('player-window')).toBeNull();
    root.unmount();
  });

  it('hotfix-2：exitFullscreen 拒绝（权限等）被 catch 吞掉，不阻断关闭', async () => {
    const exitMock = vi.fn(() => Promise.reject(new Error('denied')));
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exitMock });
    const { root } = setup([item('a')]);
    openPlayer();
    await enterFullscreen();
    fireEvent.click(screen.getByTitle('Close'));
    expect(exitMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('player-fullscreen')).toBeNull());
    expect(screen.queryByTestId('player-window')).toBeNull();
    root.unmount();
  });

  it('左右导航在全屏形态生效且队列边界隐藏', async () => {
    const { root } = setup([item('a'), item('b')]);
    // index=0：左边界隐藏
    openPlayer();
    await enterFullscreen();
    expect(screen.queryByTitle('Previous')).toBeNull();
    fireEvent.click(screen.getByTitle('Next'));
    expect(screen.getByText('b.jpg')).toBeTruthy();
    // index=1：右边界隐藏
    expect(screen.getByTitle('Previous')).toBeTruthy();
    expect(screen.queryByTitle('Next')).toBeNull();
    root.unmount();
  });

  it('window↔fullscreen 往返不卸载队列状态（items/index 保持）', async () => {
    const { root } = setup([item('a'), item('b')]);
    openPlayer();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await enterFullscreen();
    fireEvent.click(screen.getByTitle('Exit Full Screen'));
    await waitFor(() => expect(screen.getByTestId('player-window')).toBeTruthy());
    // 仍停在第二项
    expect(screen.getByText('b.jpg')).toBeTruthy();
    expect(screen.queryByTitle('Next')).toBeNull();
    // 再次进入仍为全屏（可重复往返）
    fireEvent.click(screen.getByTestId('player-fullscreen-btn'));
    await waitFor(() => expect(screen.getByTestId('player-fullscreen')).toBeTruthy());
    root.unmount();
  });
});
