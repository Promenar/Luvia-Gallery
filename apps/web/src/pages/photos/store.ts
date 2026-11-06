/**
 * 时间线分段加载的状态容器（与 React 解耦，取页函数可注入，便于测试）。
 * ensure(月份) 由视口内的未加载月份触发；每次页面返回后合并相接的段。
 */
import type { MediaItem, MediaListQuery, MediaPage, MediaType, TimelineBucket } from '@luvia/contracts';
import { assignMonths, mergeSegments, planLoad, type Segment, type TimeBasis } from './timeline';

export interface TimelineFilter {
  q?: string;
  types?: MediaType[];
  /** 排序与分组依据，缺省为拍摄时间。 */
  basis?: TimeBasis;
}

export type FetchPage = (query: MediaListQuery, signal: AbortSignal) => Promise<MediaPage>;

export interface TimelineSnapshot {
  segments: readonly Segment[];
  version: number;
}

export interface TimelineStore {
  subscribe: (l: () => void) => () => void;
  getSnapshot: () => TimelineSnapshot;
  /** 某个月份需要显示：按计划续页或新建一段。 */
  ensure: (monthIdx: number) => void;
  retry: (segId: number) => void;
  /** 本地更新已加载项（例如收藏状态），不重新请求。 */
  patch: (ids: ReadonlySet<string>, patch: Partial<MediaItem>) => void;
  /** 媒体 ID 所在的段。 */
  segmentOf: (id: string) => Segment | undefined;
  destroy: () => void;
}

export const PAGE_LIMIT = 300;

export function baseQuery(filter: TimelineFilter, limit = PAGE_LIMIT): MediaListQuery {
  const q: MediaListQuery = filter.basis === 'modified'
    ? { scope: 'all', sort: 'modified_desc', timeField: 'modified', limit }
    : { scope: 'all', sort: 'taken_desc', limit };
  if (filter.q) q.q = filter.q;
  if (filter.types?.length) q.types = filter.types;
  return q;
}

export function createTimelineStore(
  buckets: readonly TimelineBucket[],
  filter: TimelineFilter,
  fetchPage: FetchPage,
  opts: { limit?: number; maxInFlight?: number; errorMessage?: (e: unknown) => string } = {},
): TimelineStore {
  const limit = opts.limit ?? PAGE_LIMIT;
  const maxInFlight = opts.maxInFlight ?? 3;
  const errorMessage = opts.errorMessage ?? ((e: unknown) => (e instanceof Error ? e.message : '加载失败'));
  let segs: Segment[] = [];
  let snapshot: TimelineSnapshot = { segments: segs, version: 0 };
  let nextId = 1;
  let destroyed = false;
  const listeners = new Set<() => void>();
  const controllers = new Map<number, AbortController>();

  const emit = () => {
    snapshot = { segments: segs, version: snapshot.version + 1 };
    listeners.forEach((l) => l());
  };
  const update = (id: number, patch: Partial<Segment>) => {
    segs = segs.map((s) => (s.id === id ? { ...s, ...patch } : s));
  };

  async function load(id: number) {
    const s = segs.find((x) => x.id === id);
    if (!s || s.loading || s.done || destroyed) return;
    update(id, { loading: true, error: null });
    emit();
    const ac = new AbortController();
    controllers.set(id, ac);
    try {
      const page = await fetchPage(s.cursor ? { ...s.cursorQuery, cursor: s.cursor } : s.cursorQuery, ac.signal);
      const cur = segs.find((x) => x.id === id);
      if (!cur || destroyed) return;
      const add = page.items.filter((it) => !cur.ids.has(it.id));
      const months = assignMonths(buckets, add, cur.months.length ? cur.months[cur.months.length - 1]! : cur.startIdx, filter.basis);
      const ids = new Set(cur.ids);
      add.forEach((it) => ids.add(it.id));
      update(id, {
        items: [...cur.items, ...add],
        months: [...cur.months, ...months],
        ids,
        cursor: page.nextCursor,
        done: !page.nextCursor,
        loadedOnce: true,
        loading: false,
      });
      const merged = mergeSegments(segs);
      segs = merged.segments;
      for (const d of merged.dropped) {
        controllers.get(d)?.abort();
        controllers.delete(d);
      }
      emit();
    } catch (e) {
      if (ac.signal.aborted || destroyed) return;
      if (segs.some((x) => x.id === id)) {
        update(id, { loading: false, error: errorMessage(e) });
        emit();
      }
    } finally {
      if (controllers.get(id) === ac) controllers.delete(id);
    }
  }

  return {
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getSnapshot: () => snapshot,
    ensure(monthIdx) {
      if (destroyed || controllers.size >= maxInFlight) return;
      const plan = planLoad(monthIdx, segs, buckets, limit);
      if (!plan) return;
      if (plan.kind === 'continue') {
        void load(plan.segId);
        return;
      }
      const base = baseQuery(filter, limit);
      const id = nextId++;
      segs = [
        ...segs,
        {
          id,
          startIdx: plan.startIdx,
          items: [],
          months: [],
          ids: new Set(),
          cursor: null,
          // 最新的一段不加上界，包含分桶之后新增的媒体
          cursorQuery: plan.startIdx === 0 ? base : { ...base, to: buckets[plan.startIdx]!.end },
          loadedOnce: false,
          done: false,
          loading: false,
          error: null,
        },
      ];
      void load(id);
    },
    retry(id) {
      update(id, { error: null });
      void load(id);
    },
    patch(ids, patch) {
      segs = segs.map((s) => (s.items.some((it) => ids.has(it.id)) ? { ...s, items: s.items.map((it) => (ids.has(it.id) ? { ...it, ...patch } : it)) } : s));
      emit();
    },
    segmentOf: (id) => segs.find((s) => s.ids.has(id)),
    destroy() {
      destroyed = true;
      controllers.forEach((c) => c.abort());
      controllers.clear();
      listeners.clear();
    },
  };
}
