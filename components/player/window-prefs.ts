// components/player/window-prefs.ts
import { isDisplayMode } from './types';
import type { PlayerDisplayMode } from './types';

/** 浮窗位置/尺寸/形态偏好的 localStorage key（v1 结构） */
export const PLAYER_WINDOW_PREFS_KEY = 'luvia.playerWindow.v1';

export interface WindowPrefs {
  /** 窗口左上角视口坐标（px），拖动落库时已由调用方 clamp 在视口内 */
  x: number;
  y: number;
  /** 窗口宽度（px） */
  width: number;
  /** 上次会话的浮窗形态；fullscreen 不作为持久形态，载入时归一化为 window */
  mode: PlayerDisplayMode;
  /** 高度覆盖（px，hotfix-2）：下边缘拖动自定义高度时写入；缺省/undefined = 高度按媒体比例自适应 */
  heightOverride?: number;
}

/**
 * 读取浮窗偏好：localStorage 缺失（Node 环境/被禁用）、读取抛错、JSON 损坏或字段校验失败时
 * 一律返回 null 且不抛错——偏好属于锦上添花，任何异常都不应影响播放器打开。
 */
export const loadWindowPrefs = (): WindowPrefs | null => {
  try {
    const raw = globalThis.localStorage?.getItem(PLAYER_WINDOW_PREFS_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const { x, y, width, mode, heightOverride } = record;
    // 坐标与宽度必须是有限数字；形态必须是合法枚举。
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width)) return null;
    if (!isDisplayMode(mode)) return null;
    // heightOverride 为可选字段（hotfix-2，旧记录无此键）：存在且为有限正数才保留，
    // 损坏时仅丢弃覆盖字段（回落比例自适应），不因此丢弃其余偏好。
    const resolvedHeightOverride =
      typeof heightOverride === 'number' && Number.isFinite(heightOverride) && heightOverride > 0
        ? heightOverride
        : undefined;
    // fullscreen 依赖真实全屏 API（宿主 effect），重载页面后无 gesture 不应恢复，回落到 window。
    return { x, y, width, mode: mode === 'fullscreen' ? 'window' : mode, heightOverride: resolvedHeightOverride };
  } catch {
    return null;
  }
};

/** 写入浮窗偏好：存储缺失或写入失败（配额/隐私模式）时静默忽略。 */
export const saveWindowPrefs = (prefs: WindowPrefs): void => {
  try {
    globalThis.localStorage?.setItem(PLAYER_WINDOW_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 忽略写入异常：偏好丢失可接受，主流程不中断。
  }
};
