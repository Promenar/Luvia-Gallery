import { useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { MediaItem } from '@luvia/contracts';
import { ApiError } from '@/lib/api';
import { q } from '@/lib/query';
import { usePreferences } from '@/stores/session';
import {
  buildMemorySlides, folderLabel, pickHeroSlides, resolveHeroPlan,
  type FolderStatus, type HeroFallback, type HeroPlan, type HeroSlide,
} from './heroSource';

function useMedia(query: string, fallback: boolean) {
  return useSyncExternalStore(
    (cb) => {
      if (typeof matchMedia !== 'function') return () => {};
      const m = matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => (typeof matchMedia === 'function' ? matchMedia(query).matches : fallback),
    () => fallback,
  );
}

/** 窄屏（与 Tailwind md 断点一致）。 */
export const useIsNarrow = () => useMedia('(max-width: 767px)', false);

/** 是否减少动态：与 ThemeProvider 写入 data-reduce-motion 的规则一致。 */
export function useReducedMotion() {
  const pref = usePreferences().reduceMotion;
  const sys = useMedia('(prefers-reduced-motion: reduce)', false);
  return pref === 'on' || (pref === 'system' && sys);
}

/** 媒体库 ID → 显示名（目录树根节点）。 */
export function useLibraryNames(): ReadonlyMap<string, string> {
  const { data } = useQuery(q('folderTree'));
  return useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.path, n.name])), [data]);
}

const isMissing = (e: unknown) => e instanceof ApiError && (e.status === 404 || e.status === 403);

export interface HeroData {
  plan: HeroPlan;
  slides: HeroSlide[];
  /** 随机来源抽到的全部媒体（含竖图与视频），用于“随机播放”。 */
  pool: MediaItem[];
  fallback: HeroFallback;
  /** 指定文件夹的显示名（偏好里的文件夹，无论是否可用）。 */
  folderName: string | null;
  total: number | null;
  loading: boolean;
  error: unknown;
  reroll: () => void;
  retry: () => void;
}

/** 首页轮播数据：按偏好选择来源，文件夹不可用时回退到整个媒体库。 */
export function useHeroData(): HeroData {
  const home = usePreferences().home;
  const libNames = useLibraryNames();
  const wantFolder = home.heroSource === 'folder' && !!home.heroFolder;

  const folderQ = useQuery({
    ...q('folders', { query: { path: home.heroFolder ?? '' } }),
    enabled: wantFolder,
    retry: (n, e) => !isMissing(e) && n < 2,
  });
  const folderStatus: FolderStatus = !home.heroFolder ? 'unset'
    : folderQ.isError && isMissing(folderQ.error) ? 'missing'
      // 其他错误（网络等）不当作文件夹不存在，照常尝试抽样
      : folderQ.isSuccess || folderQ.isError ? 'ok' : 'pending';

  const folderPlan = resolveHeroPlan(home, folderStatus);
  const folderRandomQ = useQuery({
    ...q('randomMedia', { query: folderPlan.random ?? {} }),
    enabled: folderPlan.source === 'folder' && !folderPlan.pending,
    staleTime: Infinity,
  });
  const plan = resolveHeroPlan(home, folderStatus, folderRandomQ.data ? folderRandomQ.data.items.length > 0 : undefined);

  const memQ = useQuery(q('memories'));
  const randomQ = useQuery({
    ...q('randomMedia', { query: plan.random ?? {} }),
    enabled: plan.random != null && !plan.pending,
    staleTime: Infinity,
  });
  const totalQ = useQuery({
    ...q('buckets', { query: plan.countQuery ?? {} }),
    enabled: plan.countQuery != null && !plan.pending,
    staleTime: 5 * 60_000,
  });

  const folderName = home.heroFolder
    ? folderQ.data?.breadcrumbs.at(-1)?.name ?? folderLabel(home.heroFolder, libNames)
    : null;

  const built = useMemo(() => {
    if (plan.source === 'memories') {
      if (!memQ.data) return { slides: [] as HeroSlide[], pool: [] as MediaItem[], fallback: null as HeroFallback };
      const r = buildMemorySlides(memQ.data);
      return { slides: r.slides, pool: r.fallback ? memQ.data.shuffle : [], fallback: r.fallback };
    }
    const items = randomQ.data?.items ?? [];
    return { slides: pickHeroSlides(items).map((item) => ({ item, group: null })), pool: items, fallback: plan.fallback };
  }, [plan.source, plan.fallback, memQ.data, randomQ.data]);

  const active = plan.source === 'memories' ? memQ : randomQ;
  return {
    plan,
    ...built,
    folderName,
    total: totalQ.data?.total ?? null,
    loading: plan.pending || active.isPending,
    error: active.error,
    reroll: () => { void randomQ.refetch(); },
    retry: () => { void active.refetch(); },
  };
}
