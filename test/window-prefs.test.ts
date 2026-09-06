// test/window-prefs.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWindowPrefs, PLAYER_WINDOW_PREFS_KEY, saveWindowPrefs } from '../components/player/window-prefs';
import type { WindowPrefs } from '../components/player/window-prefs';

const validPrefs: WindowPrefs = { x: 120, y: 80, width: 480, mode: 'mini' };

/** 基于 Map 的最小 localStorage 桩：行为与浏览器一致，setItem 为 vi.fn 便于断言写入 key */
const createStorageStub = () => {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, String(value)); }),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
    clear: vi.fn(() => store.clear()),
  };
};

/** 直接写入原始字符串，用于构造损坏数据 */
const seedRaw = (raw: string) => {
  vi.stubGlobal('localStorage', createStorageStub());
  globalThis.localStorage.setItem(PLAYER_WINDOW_PREFS_KEY, raw);
};

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorageStub());
});
afterEach(() => vi.unstubAllGlobals());

describe('window-prefs 持久化', () => {
  it('localStorage 缺失时 load 返回 null、save 不抛错', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadWindowPrefs()).toBeNull();
    expect(() => saveWindowPrefs(validPrefs)).not.toThrow();
  });

  it('localStorage 读取抛错（隐私模式等）时返回 null 不抛错', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => {} });
    expect(loadWindowPrefs()).toBeNull();
  });

  it('无存储记录时返回 null', () => {
    expect(loadWindowPrefs()).toBeNull();
  });

  it('save 写入约定 key，load 完整往返 x/y/width/mode', () => {
    saveWindowPrefs(validPrefs);
    expect(globalThis.localStorage.setItem).toHaveBeenCalledWith(PLAYER_WINDOW_PREFS_KEY, expect.any(String));
    expect(loadWindowPrefs()).toEqual(validPrefs);
  });

  it('JSON 损坏时返回 null', () => {
    seedRaw('{broken-json');
    expect(loadWindowPrefs()).toBeNull();
  });

  it('非对象 JSON（数字/字符串/null）时返回 null', () => {
    seedRaw('42');
    expect(loadWindowPrefs()).toBeNull();
    seedRaw('"text"');
    expect(loadWindowPrefs()).toBeNull();
    seedRaw('null');
    expect(loadWindowPrefs()).toBeNull();
  });

  it('字段缺失或非有限数字时返回 null', () => {
    seedRaw('{"x":10,"y":20,"mode":"window"}');
    expect(loadWindowPrefs()).toBeNull();
    seedRaw('{"x":"10","y":20,"width":480,"mode":"window"}');
    expect(loadWindowPrefs()).toBeNull();
    seedRaw('{"x":null,"y":20,"width":480,"mode":"window"}');
    expect(loadWindowPrefs()).toBeNull();
    seedRaw('{"x":Infinity,"y":20,"width":480,"mode":"window"}');
    expect(loadWindowPrefs()).toBeNull();
  });

  it('mode 非法时返回 null', () => {
    seedRaw('{"x":10,"y":20,"width":480,"mode":"dialog"}');
    expect(loadWindowPrefs()).toBeNull();
    seedRaw('{"x":10,"y":20,"width":480}');
    expect(loadWindowPrefs()).toBeNull();
  });

  it('fullscreen 不能作为持久形态恢复：载入时归一化为 window', () => {
    seedRaw('{"x":10,"y":20,"width":480,"mode":"fullscreen"}');
    expect(loadWindowPrefs()).toEqual({ x: 10, y: 20, width: 480, mode: 'window' });
  });

  it('maximized 不能作为持久形态恢复：载入时归一化为 window（与 fullscreen 同）', () => {
    seedRaw('{"x":10,"y":20,"width":480,"mode":"maximized"}');
    expect(loadWindowPrefs()).toEqual({ x: 10, y: 20, width: 480, mode: 'window' });
  });

  it('hotfix-2：heightOverride 可选字段完整往返（下边缘拖动的高度覆盖）', () => {
    const prefs: WindowPrefs = { x: 10, y: 20, width: 400, mode: 'window', heightOverride: 320 };
    saveWindowPrefs(prefs);
    expect(loadWindowPrefs()).toEqual(prefs);
  });

  it('hotfix-2：无 heightOverride 的旧记录照常载入（字段缺省 = 高度按媒体比例自适应）', () => {
    seedRaw('{"x":10,"y":20,"width":400,"mode":"window"}');
    expect(loadWindowPrefs()).toEqual({ x: 10, y: 20, width: 400, mode: 'window' });
  });

  it('hotfix-2：heightOverride 损坏（非有限数字/非正数）时仅丢弃覆盖字段，不丢弃其余偏好', () => {
    seedRaw('{"x":10,"y":20,"width":400,"mode":"window","heightOverride":"abc"}');
    expect(loadWindowPrefs()).toEqual({ x: 10, y: 20, width: 400, mode: 'window' });
    seedRaw('{"x":10,"y":20,"width":400,"mode":"window","heightOverride":-5}');
    expect(loadWindowPrefs()).toEqual({ x: 10, y: 20, width: 400, mode: 'window' });
    seedRaw('{"x":10,"y":20,"width":400,"mode":"window","heightOverride":null}');
    expect(loadWindowPrefs()).toEqual({ x: 10, y: 20, width: 400, mode: 'window' });
  });
});
