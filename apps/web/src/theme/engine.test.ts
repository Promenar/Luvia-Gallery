import { describe, expect, it } from 'vitest';
import { ThemePreference } from '@luvia/contracts';
import { computeTheme } from './engine';
import { dominantOklch, oklchCss, rgbToOklch } from './color';

const theme = (p: Partial<ThemePreference> = {}) => ThemePreference.parse(p);

describe('主题引擎', () => {
  it('深浅模式底色亮度方向正确', () => {
    const dark = computeTheme({ theme: theme({ accent: 'mono' }), dark: true, dynamic: null });
    const light = computeTheme({ theme: theme({ accent: 'mono' }), dark: false, dynamic: null });
    const lum = (css: string) => css.match(/\d+/g)!.slice(0, 3).map(Number).reduce((a, b) => a + b, 0);
    expect(lum(dark['--bg']!)).toBeLessThan(lum(light['--bg']!));
    expect(dark['color-scheme']).toBe('dark');
  });

  it('OLED 深色底为纯黑', () => {
    expect(computeTheme({ theme: theme({ base: 'oled' }), dark: true, dynamic: null })['--bg']).toBe('rgb(0 0 0)');
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

  it('黑白像素没有主色，彩色像素能选出', () => {
    expect(dominantOklch([10, 10, 10, 255, 200, 200, 200, 255])).toBeNull();
    const o = dominantOklch([10, 10, 10, 255, 220, 60, 40, 255]);
    expect(o).not.toBeNull();
    expect(o![2]).toBeLessThan(60);
  });
});
