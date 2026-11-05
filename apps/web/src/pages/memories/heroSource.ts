/**
 * 首页大图轮播的纯逻辑：根据偏好与文件夹可用性决定抽取方式、挑选横图、生成文案。
 * 不依赖 React 与网络，便于单元测试。
 */
import type { MediaItem, Memories, Preferences } from '@luvia/contracts';

export type HeroSource = Preferences['home']['heroSource'];
export type HomePrefs = Preferences['home'];

/** 轮播来源选项（首页弹层与外观面板共用）。 */
export const HERO_OPTIONS: { value: HeroSource; label: string; hint: string }[] = [
  { value: 'memories', label: '回忆', hint: '往年同一时间拍的照片' },
  { value: 'favorites', label: '收藏', hint: '收藏的照片和收藏文件夹里的内容，随机挑选' },
  { value: 'library', label: '整个媒体库', hint: '从全部照片和视频里随机挑选' },
  { value: 'folder', label: '指定文件夹', hint: '只从一个文件夹及其子文件夹里随机挑选' },
];

/** 指定文件夹的可用性：ok 存在；missing 不存在或无权访问；unset 未选择；pending 正在确认。 */
export type FolderStatus = 'ok' | 'missing' | 'unset' | 'pending';

/** 实际采用的来源被回退的原因。 */
export type HeroFallback = 'folder-unset' | 'folder-missing' | 'folder-empty' | 'memories-empty' | null;

/** 随机接口的筛选参数（RandomQuery 的子集）。 */
export interface HeroRandomQuery {
  count?: number;
  favorite?: boolean;
  favoriteFolders?: boolean;
  under?: string;
}

export interface HeroPlan {
  /** 偏好中选择的来源。 */
  requested: HeroSource;
  /** 实际使用的来源（回退后）。 */
  source: HeroSource;
  /** 随机来源的筛选参数；memories 为 null。 */
  random: HeroRandomQuery | null;
  /** 统计总数用的列表筛选（buckets 接口）；memories 为 null。 */
  countQuery: { scope?: 'favorites'; under?: string } | null;
  /** source=folder 时的文件夹路径。 */
  folder: string | null;
  fallback: HeroFallback;
  /** 仍在确认文件夹可用性，暂不发起抽样。 */
  pending: boolean;
}

/** 每次随机抽样的数量：多抽一些，保证筛掉竖图后仍有足够横图。 */
export const HERO_RANDOM_COUNT = 40;
/** 轮播最多展示的张数。 */
export const HERO_MAX_SLIDES = 6;
/** 每张停留毫秒数。 */
export const HERO_INTERVAL_MS = 7000;

export function randomQueryFor(source: Exclude<HeroSource, 'memories'>, folder: string | null): HeroRandomQuery {
  if (source === 'favorites') return { count: HERO_RANDOM_COUNT, favorite: true, favoriteFolders: true };
  if (source === 'folder' && folder) return { count: HERO_RANDOM_COUNT, under: folder };
  return { count: HERO_RANDOM_COUNT };
}

function countQueryFor(source: Exclude<HeroSource, 'memories'>, folder: string | null): HeroPlan['countQuery'] {
  if (source === 'favorites') return { scope: 'favorites' };
  if (source === 'folder' && folder) return { under: folder };
  return {};
}

/**
 * 决定轮播的抽取方式。
 * - folder：文件夹未选择、不存在或其中没有媒体时回退到整个媒体库，并给出回退原因；
 * - 文件夹可用性未确认（pending）时标记 pending，避免先按媒体库抽一次再切换。
 * folderHasMedia 为该文件夹随机抽样的结果是否非空，未知时传 undefined。
 */
export function resolveHeroPlan(home: HomePrefs, folderStatus: FolderStatus, folderHasMedia?: boolean): HeroPlan {
  const requested = home.heroSource;
  if (requested === 'memories') {
    return { requested, source: 'memories', random: null, countQuery: null, folder: null, fallback: null, pending: false };
  }
  if (requested !== 'folder') {
    return { requested, source: requested, random: randomQueryFor(requested, null), countQuery: countQueryFor(requested, null), folder: null, fallback: null, pending: false };
  }
  const folder = home.heroFolder;
  const status: FolderStatus = folder ? folderStatus : 'unset';
  const library = (fallback: HeroFallback): HeroPlan => ({
    requested, source: 'library', random: randomQueryFor('library', null), countQuery: countQueryFor('library', null), folder: null, fallback, pending: false,
  });
  if (status === 'unset') return library('folder-unset');
  if (status === 'missing') return library('folder-missing');
  if (status === 'ok' && folderHasMedia === false) return library('folder-empty');
  return {
    requested, source: 'folder', random: randomQueryFor('folder', folder), countQuery: countQueryFor('folder', folder), folder,
    fallback: null, pending: status === 'pending',
  };
}

const ratio = (m: Pick<MediaItem, 'width' | 'height'>) => (m.width && m.height ? m.width / m.height : 1);
/** 横图：宽高比不小于 1.2。 */
export const isLandscape = (m: Pick<MediaItem, 'width' | 'height'>) => ratio(m) >= 1.2;

/**
 * 挑选大图：优先横向照片；没有横向照片时依次退到任意照片、横向视频封面、任意媒体，保证有内容可放。
 */
export function pickHeroSlides(items: readonly MediaItem[], max = HERO_MAX_SLIDES): MediaItem[] {
  const tiers = [
    items.filter((m) => m.mediaType === 'image' && isLandscape(m)),
    items.filter((m) => m.mediaType === 'image'),
    items.filter((m) => m.mediaType === 'video' && isLandscape(m)),
    items.filter((m) => m.mediaType !== 'audio'),
  ];
  const tier = tiers.find((t) => t.length > 0) ?? [];
  return tier.slice(0, max);
}

export interface HeroSlide {
  item: MediaItem;
  /** memories 来源时所属年份的那组媒体，用于“播放回忆”。 */
  group: { year: number; items: MediaItem[]; count: number } | null;
}

/**
 * 由回忆数据生成大图：每年一张横图（年份倒序），不足 3 张时用同年其他横图补足；
 * 往年同期没有任何横图时改用 shuffle，并标记 memories-empty。
 */
export function buildMemorySlides(mem: Memories, max = HERO_MAX_SLIDES): { slides: HeroSlide[]; fallback: HeroFallback } {
  const groups = mem.onThisDay
    .map((g) => ({ ...g, land: g.items.filter((m) => m.mediaType === 'image' && isLandscape(m)) }))
    .filter((g) => g.land.length > 0);
  if (groups.length) {
    const slide = (g: (typeof groups)[number], m: MediaItem): HeroSlide => ({ item: m, group: { year: g.year, items: g.items, count: g.count } });
    // 先每年一张；总数不足 3 张时轮流从各年再取下一张
    const slides = groups.slice(0, max).map((g) => slide(g, g.land[0]!));
    const min = Math.min(3, max);
    for (let round = 1; slides.length < min; round++) {
      let added = false;
      for (const g of groups) {
        const m = g.land[round];
        if (m && slides.length < min) { slides.push(slide(g, m)); added = true; }
      }
      if (!added) break;
    }
    return { slides, fallback: null };
  }
  return { slides: pickHeroSlides(mem.shuffle, max).map((item) => ({ item, group: null })), fallback: 'memories-empty' };
}

/** 从 takenAt（带偏移的本地时间）取年月日，避免按浏览器时区换算后跨日。 */
export function dateParts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

/** 文件夹显示名：媒体库根用媒体库名，否则取最后一段。 */
export function folderLabel(path: string, libraryNames?: ReadonlyMap<string, string>): string {
  if (!path.includes('/')) return libraryNames?.get(path) ?? path;
  return path.slice(path.lastIndexOf('/') + 1);
}

export interface HeroCopy {
  /** 大标题。 */
  title: string;
  /** 日期、来源说明。 */
  subtitle: string;
  /** 主按钮文案。 */
  playLabel: string;
  /** 查看器播放范围显示名。 */
  scopeLabel: string;
}

export interface HeroCopyContext {
  plan: Pick<HeroPlan, 'source' | 'fallback'>;
  /** source=folder 时的文件夹显示名。 */
  folderName?: string | null;
  /** 来源总数，未知为 null。 */
  total?: number | null;
  now?: Date;
  libraryNames?: ReadonlyMap<string, string>;
}

/** 生成大图文案。 */
export function heroCopy(slide: HeroSlide, ctx: HeroCopyContext): HeroCopy {
  const { y, m, d } = dateParts(slide.item.takenAt);
  const date = `${y} 年 ${m} 月 ${d} 日`;
  const place = folderLabel(slide.item.folder, ctx.libraryNames);
  const n = ctx.total != null ? `，共 ${ctx.total.toLocaleString('zh-CN')} 项` : '';
  const src = ctx.plan.source;
  if (src === 'memories') {
    if (slide.group) {
      const ago = (ctx.now ?? new Date()).getFullYear() - slide.group.year;
      const when = ago <= 1 ? '一年前' : `${ago} 年前`;
      return {
        title: `${when}的这几天，在${place}`,
        subtitle: `${date} · 那年这几天共 ${slide.group.count.toLocaleString('zh-CN')} 项`,
        playLabel: '播放回忆',
        scopeLabel: `回忆「${slide.group.year} 年」`,
      };
    }
    return { title: `${place}，${y} 年 ${m} 月`, subtitle: `${date} · 往年今天还没有照片，先随便看看`, playLabel: '随机播放媒体库', scopeLabel: '整个媒体库' };
  }
  const title = `${place}，${y} 年 ${m} 月`;
  if (src === 'favorites') return { title, subtitle: `${date} · 随机来自你的收藏${n}`, playLabel: '随机播放收藏', scopeLabel: '收藏' };
  if (src === 'folder') {
    const name = ctx.folderName ?? place;
    return { title, subtitle: `${date} · 随机来自文件夹「${name}」${n}`, playLabel: '随机播放这个文件夹', scopeLabel: `文件夹「${name}」` };
  }
  return { title, subtitle: `${date} · 随机来自整个媒体库${n}`, playLabel: '随机播放媒体库', scopeLabel: '整个媒体库' };
}

/** 回退提示文案；无回退时为 null。 */
export function fallbackNotice(fallback: HeroFallback, folderName?: string | null): string | null {
  const nm = folderName ? `「${folderName}」` : '';
  switch (fallback) {
    case 'folder-missing': return `文件夹${nm}已不存在或你没有访问权限，首页暂时从整个媒体库随机挑选。可以在轮播内容里重新选择文件夹。`;
    case 'folder-empty': return `文件夹${nm}里还没有可展示的照片，首页暂时从整个媒体库随机挑选。`;
    case 'folder-unset': return '还没有选择文件夹，首页暂时从整个媒体库随机挑选。';
    default: return null;
  }
}

/** 轮播来源按钮上的简短说明。 */
export function sourceLabel(plan: Pick<HeroPlan, 'source' | 'requested' | 'fallback'>, folderName?: string | null): string {
  if (plan.source === 'folder') return `文件夹「${folderName ?? ''}」`;
  if (plan.requested === 'folder' && plan.fallback) return '整个媒体库（文件夹不可用）';
  return HERO_OPTIONS.find((o) => o.value === plan.source)?.label ?? '';
}

/** 路径的所有祖先（不含自身），用于展开目录树到当前选择。 */
export function ancestorsOf(path: string | null): string[] {
  if (!path) return [];
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}
