import { describe, expect, it } from 'vitest';
import {
  centerOn, clampPan, FIT_VIEW, fitRect, formatPercent, isZoomed, maxZoom, minimapBox, needsHigherRes, oneToOneZoom,
  originTransform, panBy, pixelPercent, shouldPixelate, wheelFactor, zoomAt, zoomCentered, type Rect,
} from './zoom';

const VP = { w: 1440, h: 900 };
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('适合窗口摆放', () => {
  it('横图在桌面宽度受限、居中，并给顶栏与胶片条留位', () => {
    const r = fitRect({ w: 6000, h: 4000 }, VP);
    // 可用 1440-128=1312 × 900-170=730；按高受限：h=730, w=1095
    expect(r.h).toBeCloseTo(730);
    expect(r.w).toBeCloseTo(1095);
    expect(r.y).toBeCloseTo(66);
    expect(r.x).toBeCloseTo(64 + (1312 - 1095) / 2);
  });

  it('信息栏打开时桌面让出 362px，手机不让', () => {
    const a = fitRect({ w: 8000, h: 2000 }, VP, { info: false });
    const b = fitRect({ w: 8000, h: 2000 }, VP, { info: true });
    expect(a.w - b.w).toBeCloseTo(362);
    const m1 = fitRect({ w: 8000, h: 2000 }, { w: 375, h: 812 }, { info: false });
    const m2 = fitRect({ w: 8000, h: 2000 }, { w: 375, h: 812 }, { info: true });
    expect(m1).toEqual(m2);
    expect(m1.x).toBeCloseTo(8);
    expect(m1.w).toBeCloseTo(359);
  });

  it('小图不放大超过原始像素', () => {
    const r = fitRect({ w: 300, h: 200 }, VP);
    expect(r.w).toBe(300);
    expect(r.h).toBe(200);
  });
});

describe('缩放倍率', () => {
  const rect: Rect = { x: 100, y: 66, w: 1000, h: 500 };

  it('最大倍率为原图像素的 64 倍', () => {
    expect(maxZoom(rect, 4000)).toBe(256);
    expect(pixelPercent({ z: 256, x: 0, y: 0 }, rect, 4000)).toBeCloseTo(6400);
    expect(maxZoom({ ...rect, w: 400 }, 4)).toBe(1); // 至少为 1
  });

  it('1:1 倍率；原图不大于适合尺寸时双击放大到 2 倍', () => {
    expect(oneToOneZoom(rect, 4000)).toBe(4);
    expect(pixelPercent({ z: 4, x: 0, y: 0 }, rect, 4000)).toBeCloseTo(100);
    expect(oneToOneZoom(rect, 1000)).toBe(2);
  });

  it('以光标为中心缩放：光标下的图像点保持不动', () => {
    const v0 = FIT_VIEW;
    const cx = 900, cy = 300;
    const v1 = zoomAt(v0, rect, VP, cx, cy, 3, 100);
    // 缩放前光标下的局部坐标
    const lx = (cx - rect.x - v0.x) / v0.z, ly = (cy - rect.y - v0.y) / v0.z;
    expect(close(rect.x + v1.x + lx * v1.z, cx)).toBe(true);
    expect(close(rect.y + v1.y + ly * v1.z, cy)).toBe(true);
    expect(isZoomed(v1)).toBe(true);
  });

  it('倍率被限制在 [1, max]', () => {
    expect(zoomAt(FIT_VIEW, rect, VP, 500, 300, 0.2, 10).z).toBe(1);
    expect(zoomAt(FIT_VIEW, rect, VP, 500, 300, 999, 10).z).toBe(10);
    expect(zoomCentered(FIT_VIEW, rect, VP, 1, 10)).toEqual(FIT_VIEW);
  });

  it('滚轮：向上滚放大、向下缩小，捏合（ctrlKey）更灵敏，按行滚动换算像素', () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, false)).toBeLessThan(1);
    expect(wheelFactor(-10, true)).toBeCloseTo(Math.exp(0.1));
    expect(wheelFactor(-3, false, 1)).toBeCloseTo(wheelFactor(-48, false));
  });
});

describe('平移约束', () => {
  const rect: Rect = { x: 100, y: 66, w: 1000, h: 500 };

  it('放大后宽度不超过视口时水平居中', () => {
    const v = clampPan({ z: 1.2, x: 999, y: 0 }, rect, VP);
    // W=1200 <= 1440-80 → 居中：x = w(1-z)/2
    expect(v.x).toBeCloseTo(-100);
    // H=600 <= 900-80 → 垂直也居中
    expect(v.y).toBeCloseTo(-50);
  });

  it('超出视口时边缘不离开内侧 40px', () => {
    const z = 4; // W=4000, H=2000
    const right = clampPan({ z, x: 10_000, y: 0 }, rect, VP);
    expect(rect.x + right.x).toBeCloseTo(40); // 左边缘最多到 40
    const left = clampPan({ z, x: -10_000, y: 0 }, rect, VP);
    expect(rect.x + left.x + rect.w * z).toBeCloseTo(VP.w - 40); // 右边缘最少到 vw-40
    const down = clampPan({ z, x: 0, y: -10_000 }, rect, VP);
    expect(rect.y + down.y + rect.h * z).toBeCloseTo(VP.h - 40);
  });

  it('panBy 在约束内移动', () => {
    const v = zoomCentered(FIT_VIEW, rect, VP, 4, 100);
    const moved = panBy(v, rect, VP, -160, 0);
    expect(moved.x).toBeCloseTo(v.x - 160);
    const far = panBy(v, rect, VP, -1e6, 0);
    expect(rect.x + far.x + rect.w * 4).toBeCloseTo(VP.w - 40);
  });
});

describe('小地图映射', () => {
  const rect: Rect = { x: 100, y: 66, w: 1000, h: 500 };

  it('适合窗口时覆盖整张图', () => {
    const b = minimapBox(FIT_VIEW, rect, VP);
    expect(b.left).toBe(0);
    expect(b.top).toBe(0);
    expect(b.width).toBe(1);
    expect(b.height).toBe(1);
  });

  it('放大 4 倍居中时视口框约为整图的 1440/4000 宽，并位于中间', () => {
    const v = zoomCentered(FIT_VIEW, rect, VP, 4, 100);
    const b = minimapBox(v, rect, VP);
    expect(b.width).toBeCloseTo(1440 / 4000);
    expect(b.height).toBeCloseTo(900 / 2000);
    expect(b.left + b.width / 2).toBeCloseTo(0.5 + (VP.w / 2 - (rect.x + rect.w / 2)) / 4000);
  });

  it('centerOn 与 minimapBox 互逆：点击位置成为视口中心', () => {
    const v = zoomCentered(FIT_VIEW, rect, VP, 8, 100);
    const moved = centerOn(v, rect, VP, 0.3, 0.6);
    const b = minimapBox(moved, rect, VP);
    expect(b.left + b.width / 2).toBeCloseTo(0.3);
    expect(b.top + b.height / 2).toBeCloseTo(0.6);
  });

  it('框的最小尺寸为 2%', () => {
    const v = zoomCentered(FIT_VIEW, rect, VP, 400, 1000);
    const b = minimapBox(v, rect, VP);
    expect(b.width).toBeGreaterThanOrEqual(0.02);
    expect(b.height).toBeGreaterThanOrEqual(0.02);
  });
});

describe('图源与插值', () => {
  const rect: Rect = { x: 0, y: 0, w: 1000, h: 500 };

  it('显示所需像素超过 l 缩略图 15% 时换 display', () => {
    expect(needsHigherRes(rect, 1, 1, 1600)).toBe(false);
    expect(needsHigherRes(rect, 2, 1, 1600)).toBe(true);
    expect(needsHigherRes(rect, 1, 2, 1600)).toBe(true); // 高 DPI 屏
  });

  it('超过原图像素放大后用 pixelated', () => {
    expect(shouldPixelate(rect, 4, 1, 4000)).toBe(false); // 100%（1 设备像素/源像素）
    expect(shouldPixelate(rect, 4, 2, 4000)).toBe(true); // 视网膜屏 100% 已是 2 设备像素/源像素
    expect(shouldPixelate(rect, 8, 1, 4000)).toBe(true);
  });

  it('百分比格式', () => {
    expect(formatPercent(6.25)).toBe('6.3%');
    expect(formatPercent(100)).toBe('100%');
    expect(formatPercent(6400)).toBe('6,400%');
  });
});

describe('打开过渡', () => {
  it('从方形裁切的缩略图出发：等比缩放并裁到缩略图大小', () => {
    const to: Rect = { x: 100, y: 100, w: 800, h: 400 };
    const from: Rect = { x: 10, y: 20, w: 100, h: 100 };
    const t = originTransform(from, to);
    // s = max(100/800, 100/400) = 0.25 → 缩放后 200×100，裁去左右各 (800-400)/2=200（本地坐标）
    expect(t.scale).toBeCloseTo(0.25);
    expect(t.insetX).toBeCloseTo(200);
    expect(t.insetY).toBeCloseTo(0);
    // 缩放后中心与缩略图中心重合
    expect(to.x + t.tx + (to.w * t.scale) / 2).toBeCloseTo(from.x + from.w / 2);
    expect(to.y + t.ty + (to.h * t.scale) / 2).toBeCloseTo(from.y + from.h / 2);
  });
});
