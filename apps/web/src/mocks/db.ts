/**
 * 浏览器内模拟数据（仅 `pnpm dev:mock` 使用，不进入生产构建）。
 * 两个媒体库、带中间层的真实目录树、约 2,400 个媒体，缩略图为按种子生成的 SVG，ThumbHash 与图片颜色一致。
 */
import { rgbaToThumbHash } from 'thumbhash';
import type { Folder, MediaItem, Preferences, User } from '@luvia/contracts';
import { defaultPreferences } from '@luvia/contracts';

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export interface MockLibrary { id: string; name: string; root: string; hostRoot: string }
export const LIBRARIES: MockLibrary[] = [
  { id: 'photos', name: '照片库', root: '/media/photos', hostRoot: '/vol1/1000/Photos' },
  { id: 'phone', name: '手机备份', root: '/media/phone', hostRoot: '/vol2/1000/Backup/Phone' },
];

/** 目录：相对路径 → 该目录直接媒体数（0 表示只含子目录的中间层）。 */
const DIRS: Record<string, Record<string, number>> = {
  photos: {
    '': 0, '2019': 0, '2019/京都': 46, '2019/京都/岚山': 22, '2021': 0, '2021/大理': 58, '2023': 12,
    '2023/冰岛环岛': 0, '2023/冰岛环岛/第一周': 64, '2023/冰岛环岛/第二周': 51, '2024': 0, '2024/成都': 39,
    '2025': 0, '2025/2025-09 上海': 7, '2025/2025-04 婚礼': 140, '2026': 0, '2026/2026-07 杭州': 11, '扫描底片': 0, '扫描底片/1998': 33,
  },
  phone: { '': 0, DCIM: 0, 'DCIM/Camera': 420, 'DCIM/Screenshots': 0, Pictures: 0, 'Pictures/微信': 180, Movies: 24 },
};

const PALETTES: [number, number, number][][] = [
  [[34, 50, 92], [214, 120, 70], [250, 200, 140]], [[18, 40, 46], [60, 120, 110], [200, 220, 190]],
  [[70, 30, 50], [190, 90, 100], [250, 190, 170]], [[20, 24, 30], [90, 100, 120], [210, 215, 220]],
  [[40, 60, 20], [130, 160, 70], [230, 230, 170]], [[60, 40, 90], [150, 110, 190], [240, 210, 240]],
  [[90, 50, 20], [200, 140, 60], [250, 225, 170]], [[10, 30, 60], [40, 110, 170], [190, 225, 250]],
];

export interface MockMedia extends MediaItem { libraryId: string; rel: string; palette: number; seed: number }

const hex = (c: readonly number[]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

/** 与 SVG 同构的小图，用于计算真实 ThumbHash。 */
function thumbhashFor(palette: number, w: number, h: number): string {
  const tw = w >= h ? 32 : Math.max(8, Math.round((32 * w) / h));
  const th = h >= w ? 32 : Math.max(8, Math.round((32 * h) / w));
  const [a, b, c] = PALETTES[palette]!;
  const px = new Uint8Array(tw * th * 4);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const t = y / (th - 1);
    const col = t < 0.6 ? a!.map((v, i) => v + (b![i]! - v) * (t / 0.6)) : b!.map((v, i) => v + (c![i]! - v) * ((t - 0.6) / 0.4));
    const sun = Math.hypot(x / tw - 0.7, y / th - 0.35) < 0.12;
    const o = (y * tw + x) * 4;
    px[o] = sun ? 255 : col[0]!; px[o + 1] = sun ? 236 : col[1]!; px[o + 2] = sun ? 200 : col[2]!; px[o + 3] = 255;
  }
  return btoa(String.fromCharCode(...rgbaToThumbHash(tw, th, px)));
}

export function svgFor(m: MockMedia, longEdge: number): string {
  const ratio = (m.width ?? 1) / (m.height ?? 1);
  const w = ratio >= 1 ? longEdge : Math.round(longEdge * ratio);
  const h = ratio >= 1 ? Math.round(longEdge / ratio) : longEdge;
  const [a, b, c] = PALETTES[m.palette]!;
  const r = rng(m.seed);
  const hills = Array.from({ length: 3 }, (_, i) => {
    const y0 = h * (0.62 + i * 0.1);
    const pts = Array.from({ length: 7 }, (_, k) => `${(w * k) / 6},${y0 - r() * h * 0.12}`).join(' ');
    return `<polygon points="0,${h} ${pts} ${w},${h}" fill="${hex(a!)}" opacity="${0.35 + i * 0.2}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(a!)}"/><stop offset=".6" stop-color="${hex(b!)}"/><stop offset="1" stop-color="${hex(c!)}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/><circle cx="${w * 0.7}" cy="${h * 0.35}" r="${Math.min(w, h) * 0.09}" fill="#ffecc8"/>${hills}
<text x="${w * 0.04}" y="${h * 0.94}" font-family="sans-serif" font-size="${Math.max(10, h * 0.035)}" fill="#fff" opacity=".55">${m.name}</text></svg>`;
}

function build() {
  const media: MockMedia[] = [];
  let n = 0;
  for (const lib of LIBRARIES) {
    for (const [rel, count] of Object.entries(DIRS[lib.id]!)) {
      const yearMatch = /(\d{4})/.exec(rel);
      for (let i = 0; i < count; i++) {
        const seed = ++n * 7919;
        const r = rng(seed);
        const year = yearMatch ? Number(yearMatch[1]) : 2016 + Math.floor(r() * 11);
        const month = Math.floor(r() * 12);
        const day = 1 + Math.floor(r() * 28);
        const taken = new Date(Date.UTC(year, month, day, Math.floor(r() * 14) + 6, Math.floor(r() * 60)));
        if (taken.getTime() > Date.UTC(2026, 10, 5)) taken.setUTCFullYear(2025);
        const video = r() < 0.08;
        const portrait = r() < 0.3;
        const width = video ? 1920 : portrait ? 3024 : r() < 0.15 ? 12000 : 4032;
        const height = video ? 1080 : portrait ? 4032 : width === 12000 ? 3000 : 3024;
        const palette = Math.floor(r() * PALETTES.length);
        const name = video ? `VID_${String(n).padStart(5, '0')}.mp4` : `IMG_${String(n).padStart(5, '0')}.${r() < 0.2 ? 'heic' : 'jpg'}`;
        media.push({
          id: `m${n}`, name, folder: rel ? `${lib.id}/${rel}` : lib.id, mediaType: video ? 'video' : 'image',
          mime: video ? 'video/mp4' : name.endsWith('heic') ? 'image/heic' : 'image/jpeg',
          size: Math.floor(1e6 + r() * 9e6), width, height, durationSec: video ? Math.round(5 + r() * 90) : null,
          takenAt: taken.toISOString(), takenAtSource: 'metadata', modifiedAt: Math.floor(taken.getTime() / 1000),
          favorite: r() < 0.06, thumbhash: thumbhashFor(palette, width, height), thumbVersion: 1, hasLocation: r() < 0.5,
          playability: video ? 'direct' : null, hasPreview: video, libraryId: lib.id, rel, palette, seed,
        });
      }
    }
  }
  media.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
  return media;
}

export const db = {
  initialized: true,
  loggedIn: true,
  siteName: 'Luvia',
  media: build(),
  favoriteFolders: new Set<string>(['photos/2025/2025-09 上海', 'photos/2026/2026-07 杭州']),
  user: null as unknown as User,
  /** 媒体所在的手动相册 ID；由 handlers/albums.ts 在加载时注入，避免 core 与 albums 互相导入。 */
  albumIdsOf: (_mediaId: string): string[] => [],
};

/** 模拟相机：图片按种子稳定分配，约四成富士、五成 iPhone，其余没有相机信息；视频没有。 */
export const MOCK_CAMERAS = [
  { make: 'FUJIFILM', model: 'X-T5', name: 'FUJIFILM X-T5' },
  { make: 'Apple', model: 'iPhone 16 Pro', name: 'iPhone 16 Pro' },
] as const;
export function cameraOf(m: Pick<MockMedia, 'mediaType' | 'seed'>) {
  if (m.mediaType !== 'image') return null;
  const d = m.seed % 10;
  return d < 4 ? MOCK_CAMERAS[0] : d < 9 ? MOCK_CAMERAS[1] : null;
}

const prefs: Preferences = defaultPreferences();
db.user = {
  id: 'u1', username: 'admin', role: 'admin', allowedPaths: null, preferences: prefs,
  createdAt: '2026-01-01T00:00:00.000Z', lastLoginAt: '2026-11-05T08:00:00.000Z',
};

/** 列出所有目录（含中间层）的虚拟路径。 */
export function allFolders(): string[] {
  return LIBRARIES.flatMap((l) => Object.keys(DIRS[l.id]!).map((rel) => (rel ? `${l.id}/${rel}` : l.id)));
}

export const libraryOf = (path: string) => LIBRARIES.find((l) => path === l.id || path.startsWith(l.id + '/'))!;
export const nameOf = (path: string) => path.split('/').at(-1)!;
export const isUnder = (folder: string, path: string) => folder === path || folder.startsWith(path + '/');

export function hostPathOf(path: string) {
  const lib = libraryOf(path);
  const rel = path === lib.id ? '' : path.slice(lib.id.length + 1);
  return rel ? `${lib.hostRoot}/${rel}` : lib.hostRoot;
}

export function folderOf(path: string): Folder {
  const lib = libraryOf(path);
  const inside = db.media.filter((m) => isUnder(m.folder, path));
  const children = allFolders().filter((p) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'));
  return {
    path,
    name: path === lib.id ? lib.name : nameOf(path),
    mediaCount: inside.length,
    childCount: children.length,
    cover: inside[0] ?? null,
    favorite: db.favoriteFolders.has(path),
    latestAt: inside[0]?.takenAt ?? null,
    hostPath: hostPathOf(path),
  };
}

export function childrenOf(path: string): string[] {
  return allFolders()
    .filter((p) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/'))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'zh-CN', { numeric: true }));
}

/** 去掉模拟专用字段，得到契约 MediaItem。 */
export function pub(m: MockMedia): MediaItem {
  const { libraryId: _l, rel: _r, palette: _p, seed: _s, ...rest } = m;
  // 与真实后端一致：写操作需要源版本，替换后源代次会递增。
  return { ...rest, source: m.source ?? { size: m.size, modifiedAt: m.modifiedAt, generation: 0 } };
}
