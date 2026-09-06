import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GRID_TOP_SAFE_AREA_CLASSES } from '../components/gallery/GridViewport';
import { MASONRY_TOP_SAFE_AREA_CLASSES } from '../components/gallery/MasonryViewport';

// 契约来源：App.tsx 顶部工具栏浮岛为 `md:absolute md:inset-x-0 md:top-0`，
// md 及以上悬浮遮挡内容；移动端为普通流布局，无需顶部避让。
// 瀑布流既有契约见 MasonryViewport 的 MASONRY_TOP_SAFE_AREA_CLASSES（md 及以上 64px 顶部内边距）。
describe('网格视图顶部安全区', () => {
  it('网格滚动内容外层在 md 及以上带 64px 顶部安全区（md:pt-16）', () => {
    expect(GRID_TOP_SAFE_AREA_CLASSES).toContain('md:pt-16');
  });

  it('与瀑布流安全区常量的 md 语义对齐（均为 md:pt-16）', () => {
    expect(MASONRY_TOP_SAFE_AREA_CLASSES).toContain('md:pt-16');
    expect(GRID_TOP_SAFE_AREA_CLASSES).toContain('md:pt-16');
  });

  it('安全区常量已挂载到 GridViewport 的内容容器上（防止常量悬空）', () => {
    const source = readFileSync(join(__dirname, '..', 'components', 'gallery', 'GridViewport.tsx'), 'utf-8');
    // 外层内容容器（包裹 AutoSizer 的 wrapper）必须引用该常量
    expect(source).toMatch(/className=\{`[^`]*\$\{GRID_TOP_SAFE_AREA_CLASSES\}/);
  });
});
