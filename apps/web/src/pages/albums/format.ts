import type { MediaFilter, MediaType } from '@luvia/contracts';

/** ISO 8601 字符串自带拍摄地偏移，直接取年月，避免按浏览器时区换算后跨月。 */
const ym = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) });

/** 相册时间范围：“2024 年 10 月”“2024 年 10 月 – 11 月”“2019 年 8 月 – 2021 年 3 月”。 */
export function formatAlbumRange(startAt: string | null, endAt: string | null): string | null {
  if (!startAt && !endAt) return null;
  const a = ym(startAt ?? endAt!);
  const b = ym(endAt ?? startAt!);
  if (a.y === b.y && a.m === b.m) return `${a.y} 年 ${a.m} 月`;
  if (a.y === b.y) return `${a.y} 年 ${a.m} 月 – ${b.m} 月`;
  return `${a.y} 年 ${a.m} 月 – ${b.y} 年 ${b.m} 月`;
}

/** 智能相册表单。日期为 `<input type="date">` 的 YYYY-MM-DD，结束日期包含当天。 */
export interface SmartForm {
  types: MediaType[];
  from: string;
  to: string;
  favorite: boolean;
  under: string | null;
  cameras: string[];
}

export const emptySmartForm = (): SmartForm => ({ types: [], from: '', to: '', favorite: false, under: null, cameras: [] });

const pad = (n: number) => String(n).padStart(2, '0');
/** 本地日期 00:00 的 Unix 秒。 */
function dayStart(date: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return undefined;
  return Math.floor(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() / 1000);
}
function dateOf(sec: number) {
  const d = new Date(sec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 表单 → 保存的筛选条件（契约 MediaFilter：from/to 为左闭右开的 Unix 秒）。全部为空时返回 null。 */
export function toFilter(f: SmartForm): MediaFilter | null {
  const out: MediaFilter = {};
  if (f.types.length) out.types = [...f.types];
  const from = dayStart(f.from);
  if (from !== undefined) out.from = from;
  const toDay = dayStart(f.to);
  if (toDay !== undefined) {
    const [y, mo, d] = f.to.split('-').map(Number) as [number, number, number];
    out.to = Math.floor(new Date(y, mo - 1, d + 1).getTime() / 1000);
  }
  if (f.favorite) out.favorite = true;
  if (f.under) out.under = f.under;
  if (f.cameras.length) out.cameras = [...f.cameras];
  return Object.keys(out).length ? out : null;
}

/** 保存的筛选条件 → 表单（编辑智能相册时回填）。 */
export function fromFilter(filter: MediaFilter | null | undefined): SmartForm {
  const f = emptySmartForm();
  if (!filter) return f;
  f.types = [...(filter.types ?? [])];
  if (filter.from != null) f.from = dateOf(filter.from);
  if (filter.to != null) f.to = dateOf(filter.to - 1);
  f.favorite = filter.favorite === true;
  f.under = filter.under ?? null;
  f.cameras = [...(filter.cameras ?? [])];
  return f;
}

/** 结束日期早于开始日期时给出提示。 */
export function rangeError(f: SmartForm): string | null {
  if (f.from && f.to && f.to < f.from) return '结束日期不能早于开始日期';
  return null;
}

const TYPE_NAMES: Record<MediaType, string> = { image: '照片', video: '视频', audio: '音频' };

/** 智能相册筛选条件的中文摘要，例如 ["视频", "2025-01-01 至 2025-12-31", "只含收藏"]。 */
export function filterSummary(filter: MediaFilter | null | undefined): string[] {
  if (!filter) return [];
  const out: string[] = [];
  if (filter.q) out.push(`名称含“${filter.q}”`);
  if (filter.types?.length) out.push(filter.types.map((t) => TYPE_NAMES[t]).join('、'));
  const from = filter.from != null ? dateOf(filter.from) : null;
  const to = filter.to != null ? dateOf(filter.to - 1) : null;
  if (from && to) out.push(from === to ? from : `${from} 至 ${to}`);
  else if (from) out.push(`${from} 起`);
  else if (to) out.push(`截至 ${to}`);
  if (filter.favorite) out.push('只含收藏');
  if (filter.under) out.push(`文件夹「${filter.under.split('/').at(-1)}」及子文件夹`);
  if (filter.cameras?.length) out.push(`相机 ${filter.cameras.join('、')}`);
  if (filter.orientation) out.push({ landscape: '横图', portrait: '竖图', square: '方图' }[filter.orientation]);
  if (filter.hasLocation === true) out.push('有拍摄地点');
  if (filter.hasLocation === false) out.push('没有拍摄地点');
  return out;
}
