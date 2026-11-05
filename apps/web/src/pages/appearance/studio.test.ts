import { describe, expect, it } from 'vitest';
import { Preferences, PreferencesPatch } from '@luvia/contracts';
import {
  ACCENT_KEYS, accentKeyOf, accentName, accentSwatch, BACKDROP_OPTIONS, baseSwatch, clampInterval, GRID_OPTIONS,
  INTERVAL_PRESETS, MODE_OPTIONS, ORDER_OPTIONS, RADIUS_OPTIONS, REDUCE_OPTIONS, START_OPTIONS,
} from './studio';

describe('clampInterval', () => {
  it('限制在 2–120 秒并取整', () => {
    expect(clampInterval('1')).toBe(2);
    expect(clampInterval('500')).toBe(120);
    expect(clampInterval(' 7.6 ')).toBe(8);
    expect(clampInterval(45)).toBe(45);
  });
  it('无法解析时返回 null', () => {
    expect(clampInterval('')).toBeNull();
    expect(clampInterval('abc')).toBeNull();
  });
  it('常用档位都在契约范围内', () => {
    for (const s of INTERVAL_PRESETS) expect(PreferencesPatch.safeParse({ slideshow: { intervalSec: s } }).success).toBe(true);
  });
});

describe('强调色', () => {
  it('顺序：随照片、无彩、7 个预设、自定义', () => {
    expect(ACCENT_KEYS).toHaveLength(10);
    expect(ACCENT_KEYS[0]).toBe('dynamic');
    expect(ACCENT_KEYS[1]).toBe('mono');
    expect(ACCENT_KEYS.at(-1)).toBe('custom');
    expect(ACCENT_KEYS.map(accentName)).toEqual(['随照片', '无彩', '湖蓝', '青碧', '苔绿', '琥珀', '珊瑚', '绯红', '暮紫', '自定义']);
  });
  it('#RRGGBB 识别为自定义', () => {
    expect(accentKeyOf('#12abef')).toBe('custom');
    expect(accentKeyOf('teal')).toBe('teal');
  });
  it('预设色块为 rgb()，自定义直接用取色值', () => {
    expect(accentSwatch('azure', '#000000')).toMatch(/^rgb\(/);
    expect(accentSwatch('custom', '#4f7cff')).toBe('#4f7cff');
  });
  it('除自定义外的选项都是契约允许的 accent', () => {
    for (const k of ACCENT_KEYS.filter((k) => k !== 'custom')) {
      expect(PreferencesPatch.safeParse({ theme: { accent: k } }).success).toBe(true);
    }
  });
});

describe('选项与契约一致', () => {
  const ok = (patch: unknown) => PreferencesPatch.safeParse(patch).success;
  it('各分段选项的取值都能通过 PreferencesPatch 校验', () => {
    MODE_OPTIONS.forEach((o) => expect(ok({ theme: { mode: o.value } })).toBe(true));
    RADIUS_OPTIONS.forEach((o) => expect(ok({ theme: { radius: o.value } })).toBe(true));
    BACKDROP_OPTIONS.forEach((o) => expect(ok({ theme: { viewerBackdrop: o.value } })).toBe(true));
    GRID_OPTIONS.forEach((o) => expect(ok({ gridStyle: o.value })).toBe(true));
    REDUCE_OPTIONS.forEach((o) => expect(ok({ reduceMotion: o.value })).toBe(true));
    ORDER_OPTIONS.forEach((o) => expect(ok({ slideshow: { order: o.value } })).toBe(true));
    START_OPTIONS.forEach((o) => expect(ok({ startPage: o.value })).toBe(true));
  });
  it('覆盖起始页全部取值', () => {
    expect(START_OPTIONS.map((o) => o.value).sort()).toEqual([...Preferences.shape.startPage.unwrap().options].sort());
  });
  it('底色色块', () => {
    expect(baseSwatch('oled')).toContain('#000');
    expect(baseSwatch('warm')).toMatch(/^linear-gradient\(90deg,rgb\(/);
  });
});
