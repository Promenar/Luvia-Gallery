import { describe, expect, it } from 'vitest';
import { ThemePreference } from '@luvia/contracts';
import { computeTheme } from './engine';
import { dominantOklch, oklchCss, paletteFromRGBA, rgbToOklch } from './color';

const theme = (p: Partial<ThemePreference> = {}) => ThemePreference.parse(p);

describe('主题引擎', () => {
  it('默认皮肤为 cinema，深浅模式底色亮度方向正确', () => {
    const dark = computeTheme({ theme: theme({ accent: 'mono' }), dark: true, dynamic: null });
    const light = computeTheme({ theme: theme({ accent: 'mono' }), dark: false, dynamic: null });
    const lum = (css: string) => css.match(/\d+/g)!.slice(0, 3).map(Number).reduce((a, b) => a + b, 0);
    expect(dark['data-style']).toBe('cinema');
    expect(lum(dark['--bg']!)).toBeLessThan(lum(light['--bg']!));
    expect(dark['color-scheme']).toBe('dark');
    expect(light['color-scheme']).toBe('light');
  });

  it('双皮肤 monograph 与 cinema 输出差异化圆角、纸张肌理与环境光场', () => {
    const mono = computeTheme({ theme: theme({ style: 'monograph', accent: 'dynamic' }), dark: false, dynamic: rgbToOklch(40, 110, 210) });
    const cinema = computeTheme({ theme: theme({ style: 'cinema', accent: 'dynamic' }), dark: false, dynamic: rgbToOklch(40, 110, 210) });
    expect(mono['data-style']).toBe('monograph');
    expect(cinema['data-style']).toBe('cinema');
    expect(mono['--r3']).toBe('10px');
    expect(cinema['--r3']).toBe('22px');
    expect(Number(mono['--paper-grain-opacity'])).toBeGreaterThan(0);
    expect(mono['--paper-grain-opacity']).not.toBe(cinema['--paper-grain-opacity']);
    expect(cinema['--ambient-1']).toMatch(/^rgb\(/);
    expect(cinema['--ambient-2']).toMatch(/^rgb\(/);
  });

  it('OLED 深色底在两套皮肤下均为纯黑', () => {
    expect(computeTheme({ theme: theme({ style: 'cinema', base: 'oled' }), dark: true, dynamic: null })['--bg']).toBe('rgb(0 0 0)');
    expect(computeTheme({ theme: theme({ style: 'monograph', base: 'oled' }), dark: true, dynamic: null })['--bg']).toBe('rgb(0 0 0)');
  });

  it('动态强调色跟随照片色相，浅色模式文字对比合格', () => {
    const blue = rgbToOklch(30, 90, 220);
    const vars = computeTheme({ theme: theme({ accent: 'dynamic' }), dark: false, dynamic: blue });
    const [r, , b] = vars['--accent']!.match(/\d+/g)!.map(Number) as [number, number, number];
    expect(b).toBeGreaterThan(r);
    expect(vars['--accent-fg']).toBe('#fff');
  });

  it('自定义十六进制强调色与圆角档位', () => {
    const vars = computeTheme({ theme: theme({ accent: '#e0a030', radius: 'round' }), dark: true, dynamic: null });
    expect(vars['--accent-fg']).toBe('#111');
    expect(vars['--r3']).toBe('24px');
  });

  it('越界色度被压回色域', () => {
    expect(oklchCss(0.9, 0.4, 140)).toMatch(/^rgb\(\d+ \d+ \d+\)$/);
  });

  it('黑白像素没有主色，彩色像素能选出主色与副氛围色', () => {
    expect(dominantOklch([10, 10, 10, 255, 200, 200, 200, 255])).toBeNull();
    const o = dominantOklch([10, 10, 10, 255, 220, 60, 40, 255]);
    expect(o).not.toBeNull();
    expect(o![2]).toBeLessThan(60);
    const pal = paletteFromRGBA([220, 60, 40, 255, 30, 110, 210, 255]);
    expect(pal.primary).not.toBeNull();
    expect(pal.secondary).not.toBeNull();
  });
});
