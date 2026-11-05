/** OKLCH 与 sRGB 互转。L 为 0–1，C 为色度，H 为角度。 */
export type Oklch = readonly [L: number, C: number, H: number];

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const delin = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, v)) * 255);
};

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToOklch(r8: number, g8: number, b8: number): Oklch {
  const r = lin(r8), g = lin(g8), b = lin(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.sqrt(A * A + B * B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

/** 线性 sRGB（可能越界）。 */
export function oklchToLinear(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (L: number, C: number, H: number) => oklchToLinear(L, C, H).every((v) => v >= -0.001 && v <= 1.001);

/** 逐步降低色度直到落入 sRGB 色域，输出 CSS rgb()。 */
export function oklchCss(L: number, C: number, H: number, alpha?: number): string {
  let c = C;
  while (c > 0.002 && !inGamut(L, c, H)) c -= 0.005;
  const [r, g, b] = oklchToLinear(L, Math.max(0, c), H).map(delin) as [number, number, number];
  return alpha == null ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

/** 相对亮度（WCAG），用于决定强调色上的文字用黑还是白。 */
export function relativeLuminance(L: number, C: number, H: number): number {
  const [r, g, b] = oklchToLinear(L, C, H).map((v) => Math.max(0, Math.min(1, v))) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 从 RGBA 像素中挑选“最有代表性的鲜明颜色”：色度高且亮度接近中段的像素得分最高。
 * 返回 null 表示几乎无彩（例如黑白照片）。
 */
export function dominantOklch(rgba: ArrayLike<number>): Oklch | null {
  let best: Oklch | null = null;
  let bestScore = -1;
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    if ((rgba[i + 3] ?? 255) < 128) continue;
    const o = rgbToOklch(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!);
    const score = o[1] * (1 - Math.abs(o[0] - 0.62) * 1.4);
    if (score > bestScore) { bestScore = score; best = o; }
  }
  if (!best || best[1] < 0.02) return null;
  return [best[0], Math.max(0.06, best[1] * 1.1), best[2]];
}
