/**
 * 查看器缩放与平移的纯函数。
 *
 * 坐标约定：媒体先按 fitRect 摆放在舞台（视口）上，缩放层以左上角为原点施加
 * `translate(x, y) scale(z)`。z=1 即“适合窗口”，z 的上限为原图像素的 64 倍。
 * 所有坐标均为 CSS 像素，相对视口左上角。
 */

export interface Size { w: number; h: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface View { z: number; x: number; y: number }

export const FIT_VIEW: View = { z: 1, x: 0, y: 0 };
/** 原图像素的最大放大倍数。 */
export const MAX_PIXEL_ZOOM = 64;
/** 平移时图片边缘允许离开视口边缘的留白。 */
export const PAN_MARGIN = 40;
/** 手机布局断点（与原型一致）。 */
export const MOBILE_BREAKPOINT = 760;

export const isZoomed = (v: View) => v.z > 1.001;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 适合窗口的摆放矩形：顶部预留顶栏 66px、底部预留胶片条 104px，桌面左右各留 64px（手机 8px），
 * 信息侧栏打开时桌面再让出 362px。小图不放大超过原始像素。
 */
export function fitRect(media: Size, viewport: Size, opts: { info?: boolean } = {}): Rect {
  const mobile = viewport.w < MOBILE_BREAKPOINT;
  const pad = mobile ? 8 : 64;
  const side = opts.info && !mobile ? 362 : 0;
  const top = 66;
  const bottom = 104;
  const aw = Math.max(1, viewport.w - pad * 2 - side);
  const ah = Math.max(1, viewport.h - top - bottom);
  const mw = Math.max(1, media.w);
  const mh = Math.max(1, media.h);
  const ar = mw / mh;
  let w = aw;
  let h = w / ar;
  if (h > ah) { h = ah; w = h * ar; }
  if (w > mw) { w = mw; h = mh; }
  return { x: pad + (aw - w) / 2, y: top + (ah - h) / 2, w, h };
}

/** 最大缩放倍率（相对适合窗口）：原图像素的 64 倍，至少为 1。 */
export function maxZoom(rect: Rect, mediaW: number): number {
  return Math.max(1, (mediaW / rect.w) * MAX_PIXEL_ZOOM);
}

/** 1:1（原始像素）对应的缩放倍率；小图适合窗口即为原始像素时返回 2，保证双击总能放大。 */
export function oneToOneZoom(rect: Rect, mediaW: number): number {
  const z = mediaW / rect.w;
  return z > 1.001 ? z : 2;
}

/**
 * 约束平移：缩放后宽（高）不超过视口可用宽（高）时居中；否则图片边缘不得离开视口内侧 PAN_MARGIN。
 */
export function clampPan(view: View, rect: Rect, viewport: Size, margin = PAN_MARGIN): View {
  const W = rect.w * view.z;
  const H = rect.h * view.z;
  const x = W <= viewport.w - margin * 2
    ? (rect.w * (1 - view.z)) / 2
    : clamp(view.x, viewport.w - margin - rect.x - W, margin - rect.x);
  const y = H <= viewport.h - margin * 2
    ? (rect.h * (1 - view.z)) / 2
    : clamp(view.y, viewport.h - margin - rect.y - H, margin - rect.y);
  return { z: view.z, x, y };
}

/** 以视口坐标 (cx, cy) 为不动点缩放到 nz（会被限制在 [1, max]）。 */
export function zoomAt(view: View, rect: Rect, viewport: Size, cx: number, cy: number, nz: number, max: number): View {
  const z = clamp(nz, 1, Math.max(1, max));
  const lx = (cx - rect.x - view.x) / view.z;
  const ly = (cy - rect.y - view.y) / view.z;
  return clampPan({ z, x: cx - rect.x - lx * z, y: cy - rect.y - ly * z }, rect, viewport);
}

/** 以适合矩形中心为不动点缩放（按钮与键盘）。 */
export function zoomCentered(view: View, rect: Rect, viewport: Size, nz: number, max: number): View {
  return zoomAt(view, rect, viewport, rect.x + rect.w / 2, rect.y + rect.h / 2, nz, max);
}

export function panBy(view: View, rect: Rect, viewport: Size, dx: number, dy: number): View {
  return clampPan({ z: view.z, x: view.x + dx, y: view.y + dy }, rect, viewport);
}

/** 滚轮缩放系数：触控板捏合（ctrlKey）灵敏度更高；按行滚动的设备换算为像素。 */
export function wheelFactor(deltaY: number, ctrlKey: boolean, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-px * (ctrlKey ? 0.01 : 0.0022));
}

/** 小地图：当前视口在整张图中的可见部分，取值为 0–1 的比例。 */
export function minimapBox(view: View, rect: Rect, viewport: Size) {
  const W = rect.w * view.z;
  const H = rect.h * view.z;
  const ix = rect.x + view.x;
  const iy = rect.y + view.y;
  const left = clamp(-ix / W, 0, 1);
  const top = clamp(-iy / H, 0, 1);
  const right = clamp((viewport.w - ix) / W, 0, 1);
  const bottom = clamp((viewport.h - iy) / H, 0, 1);
  return { left, top, width: Math.max(0.02, right - left), height: Math.max(0.02, bottom - top) };
}

/** 小地图反向映射：把图中比例位置 (fx, fy) 移到视口中心。 */
export function centerOn(view: View, rect: Rect, viewport: Size, fx: number, fy: number): View {
  const W = rect.w * view.z;
  const H = rect.h * view.z;
  return clampPan({ z: view.z, x: viewport.w / 2 - rect.x - fx * W, y: viewport.h / 2 - rect.y - fy * H }, rect, viewport);
}

/** 相对原图像素的显示百分比。 */
export function pixelPercent(view: View, rect: Rect, mediaW: number): number {
  return ((rect.w * view.z) / Math.max(1, mediaW)) * 100;
}

export function formatPercent(v: number): string {
  if (v >= 1000) return Math.round(v).toLocaleString('zh-CN') + '%';
  if (v >= 10) return Math.round(v) + '%';
  return v.toFixed(1) + '%';
}

/** 显示所需的设备像素宽度超过当前图源 15% 以上时需要更高分辨率的图源。 */
export function needsHigherRes(rect: Rect, z: number, dpr: number, sourceW: number): boolean {
  return rect.w * z * dpr > sourceW * 1.15;
}

/** 一个图源像素覆盖超过 2 个设备像素（即超过原图像素放大）时改用最近邻插值，看清像素边界。 */
export function shouldPixelate(rect: Rect, z: number, dpr: number, sourceW: number): boolean {
  return rect.w * z * dpr >= sourceW * 2;
}

/**
 * 打开/关闭过渡：从缩略图矩形（object-fit: cover 裁切）变换到适合矩形。
 * 返回起始帧的 transform 与 clip-path（clip-path 在元素自身坐标中，先于 transform 生效）。
 */
export function originTransform(from: Rect, to: Rect) {
  const s = Math.max(from.w / to.w, from.h / to.h);
  const sw = to.w * s;
  const sh = to.h * s;
  const tx = from.x + (from.w - sw) / 2 - to.x;
  const ty = from.y + (from.h - sh) / 2 - to.y;
  const insetX = Math.max(0, (to.w - from.w / s) / 2);
  const insetY = Math.max(0, (to.h - from.h / s) / 2);
  return {
    transform: `translate(${tx}px, ${ty}px) scale(${s})`,
    clipPath: `inset(${insetY}px ${insetX}px round ${6 / s}px)`,
    scale: s,
    tx,
    ty,
    insetX,
    insetY,
  };
}
