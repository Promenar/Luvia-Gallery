/**
 * 查看器旋转的纯逻辑：旋转步进、旋转后的显示尺寸，以及把“屏幕上看到的”归一化坐标
 * 还原到未旋转原图坐标。原图坐标刻意保持为 EXIF 方向校正后、未叠加查看器旋转的像素空间，
 * 供后续修复蒙版与后端对接。
 */

export type Rotation = 0 | 90 | 180 | 270;

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

/** 顺时针旋转一档。 */
export function nextRotation(r: Rotation): Rotation {
  return ((r + 90) % 360) as Rotation;
}

/** 90 度与 270 度会交换宽高。 */
export function isQuarterTurn(r: Rotation): boolean {
  return r === 90 || r === 270;
}

/** 旋转后的显示尺寸（只交换宽高，不做像素重采样）。 */
export function rotatedSize(w: number, h: number, r: Rotation): { w: number; h: number } {
  return isQuarterTurn(r) ? { w: h, h: w } : { w, h };
}

/**
 * 把显示坐标（u、v ∈ [0, 1]，已含查看器旋转）映射回未旋转原图的归一化坐标。
 * 旋转以图片中心为原点，顺时针为正。
 */
export function unrotatePoint(u: number, v: number, r: Rotation): { u: number; v: number } {
  switch (r) {
    case 90: return { u: v, v: 1 - u };
    case 180: return { u: 1 - u, v: 1 - v };
    case 270: return { u: 1 - v, v: u };
    default: return { u, v };
  }
}

/** 旋转角度的中文说明，用于提示条与无障碍名称。 */
export function rotationLabel(r: Rotation): string {
  return r === 0 ? '未旋转' : `旋转 ${r}°`;
}
