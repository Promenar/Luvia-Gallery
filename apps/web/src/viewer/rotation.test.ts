import { describe, expect, it } from 'vitest';
import { isQuarterTurn, nextRotation, rotatedSize, rotationLabel, unrotatePoint, type Rotation } from './rotation';

/** 正向旋转，用于验证反变换。 */
function rotatePoint(u: number, v: number, r: Rotation) {
  switch (r) {
    case 90: return { u: 1 - v, v: u };
    case 180: return { u: 1 - u, v: 1 - v };
    case 270: return { u: v, v: 1 - u };
    default: return { u, v };
  }
}

describe('nextRotation', () => {
  it('每次顺时针增加 90 度并在 270 后回到 0', () => {
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(90)).toBe(180);
    expect(nextRotation(180)).toBe(270);
    expect(nextRotation(270)).toBe(0);
  });
});

describe('rotatedSize', () => {
  it('90/270 交换宽高，0/180 保持不变', () => {
    expect(rotatedSize(1200, 800, 0)).toEqual({ w: 1200, h: 800 });
    expect(rotatedSize(1200, 800, 90)).toEqual({ w: 800, h: 1200 });
    expect(rotatedSize(1200, 800, 180)).toEqual({ w: 1200, h: 800 });
    expect(rotatedSize(1200, 800, 270)).toEqual({ w: 800, h: 1200 });
  });
  it('isQuarterTurn 只对 90/270 为真', () => {
    expect(isQuarterTurn(0)).toBe(false);
    expect(isQuarterTurn(90)).toBe(true);
    expect(isQuarterTurn(180)).toBe(false);
    expect(isQuarterTurn(270)).toBe(true);
  });
});

describe('unrotatePoint', () => {
  it('四个角点在四个角度下都能还原到原图坐标', () => {
    const points = [
      { u: 0, v: 0 }, { u: 1, v: 0 }, { u: 0, v: 1 }, { u: 1, v: 1 }, { u: 0.25, v: 0.8 },
    ];
    for (const r of [0, 90, 180, 270] as const) {
      for (const p of points) {
        const shown = rotatePoint(p.u, p.v, r);
        const back = unrotatePoint(shown.u, shown.v, r);
        expect(back.u).toBeCloseTo(p.u, 10);
        expect(back.v).toBeCloseTo(p.v, 10);
      }
    }
  });

  it('90 度时屏幕左上角对应原图左下角', () => {
    expect(unrotatePoint(0, 0, 90)).toEqual({ u: 0, v: 1 });
  });

  it('270 度时屏幕左上角对应原图右上角', () => {
    expect(unrotatePoint(0, 0, 270)).toEqual({ u: 1, v: 0 });
  });
});

it('rotationLabel 给出可读文案', () => {
  expect(rotationLabel(0)).toBe('未旋转');
  expect(rotationLabel(90)).toBe('旋转 90°');
});
