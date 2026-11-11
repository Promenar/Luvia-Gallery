import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Check, CircleCheck, Download, Funnel, Heart, HeartOff, LoaderCircle, Play, RotateCw, WandSparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import type { MediaItem, MediaType } from '@luvia/contracts';
import { call, ApiError } from '@/lib/api';
import { invalidate, q } from '@/lib/query';
import { cn } from '@/lib/cn';
import { useElementWidth, useRowHeight } from '@/components/media/MediaGrid';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/kit/dropdown-menu';
import { CommandBar, CommandButton, CommandDivider } from '@/shell/CommandBar';
import { useIsAdmin, usePreferences, useUpdatePreferences } from '@/stores/session';
import { useDimensionsVersion } from '@/lib/dimensions';
import { openViewer, useViewer, type ViewerScope } from '@/stores/viewer';
import { setDynamicFrom } from '@/theme/ThemeProvider';
import {
  anchorAt, buildLayout, dayLabel, displayOrder, folderLabel, monthAtOffset, monthStates, parseKey, resolveAnchor, topFolders,
  type DayGroup, type LayoutCache, type ScrollAnchor, type Segment, type TimeBasis, type TimelineLayout,
} from './timeline';
import { createTimelineStore, type TimelineFilter, type TimelineSnapshot, type TimelineStore } from './store';
import { TimelineTile, type TileApi } from './TimelineTile';
import { MobileScrubber, TimeRuler } from './TimeRuler';
import { monthLabel } from './ruler';
import { BatchCreateDialog } from '@/pages/editor/BatchAutomation';

type TypeFilter = 'all' | 'image' | 'video';
const TYPE_LABEL: Record<TypeFilter, string> = { all: '全部', image: '照片', video: '视频' };
const TYPES_OF: Record<TypeFilter, MediaType[] | undefined> = { all: undefined, image: ['image'], video: ['video'] };

/** 视口参照线：命令条下方，用于判断“当前月份”和滚动锚定。 */
const PROBE = 90;
const FAVORITE_BATCH = 5000;

function useNarrow() {
  const mq = '(max-width: 767px)';
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(mq);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => matchMedia(mq).matches,
  );
}

const EMPTY_SNAPSHOT: TimelineSnapshot = { segments: [], version: 0 };
const noopSubscribe = () => () => {};

/** 按筛选条件与分桶签名创建分段加载容器；分桶变化（媒体增删）时重建。 */
function useTimelineStore(buckets: { key: string; count: number; start: number; end: number }[] | undefined, filter: TimelineFilter, key: string) {
  const [holder, setHolder] = useState<{ key: string; store: TimelineStore } | null>(null);
  useEffect(() => {
    if (!buckets) return;
    const store = createTimelineStore(buckets, filter, (query, signal) => call('listMedia', { query, signal }), {
      errorMessage: (e) => (e instanceof ApiError ? e.message : '网络连接中断，请检查网络后重试'),
    });
    setHolder({ key, store });
    return () => store.destroy();
    // key 已包含 filter 与 buckets 的签名
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const store = holder?.key === key ? holder.store : null;
  const snap = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? (() => EMPTY_SNAPSHOT));
  return { store, snap };
}

export default function PhotosPage() {
  const search = useSearch({ strict: false }) as { q?: string; type?: Exclude<TypeFilter, 'all'> };
  const query = search.q?.trim() || undefined;
  const navigate = useNavigate();
  const prefs = usePreferences();
  const isAdmin = useIsAdmin();
  const editorCaps = useQuery({ ...q('editorCapabilities'), enabled: isAdmin, staleTime: 30_000 });
  const canBatch = !!editorCaps.data?.models.some((model) => model.id === 'slbr' && model.available && model.features.includes('detect'));
  const narrow = useNarrow();

  const typeFilter: TypeFilter = search.type ?? 'all';
  const setTypeFilter = (t: TypeFilter) =>
    void navigate({ to: '/photos', search: (prev: { q?: string }) => ({ q: prev.q, type: t === 'all' ? undefined : t }) });
  const [text, setText] = useState(query ?? '');
  useEffect(() => setText(query ?? ''), [query]);

  const basis = prefs.timelineBasis;
  const updatePrefs = useUpdatePreferences();
  const filter = useMemo<TimelineFilter>(() => ({ q: query, types: TYPES_OF[typeFilter], basis }), [query, typeFilter, basis]);
  const bucketsQ = useQuery(q('buckets', { query: { scope: 'all', ...(query ? { q: query } : {}), ...(filter.types ? { types: filter.types } : {}), ...(basis === 'modified' ? { timeField: 'modified' as const } : {}) } }));
  const buckets = bucketsQ.data?.buckets;
  const sig = buckets ? `${bucketsQ.data!.total}|${buckets.map((b) => `${b.key}:${b.count}`).join(',')}` : '';
  const storeKey = `${query ?? ''}|${typeFilter}|${basis}|${sig}`;
  const { store, snap } = useTimelineStore(buckets, filter, storeKey);
  const segments = snap.segments;

  /* ---------- 布局 ---------- */
  const [contentRef, width] = useElementWidth<HTMLDivElement>();
  const rowH = useRowHeight(width);
  const gap = narrow ? 2 : 3;
  const TOP = narrow ? 70 : 78;
  const BOTTOM = narrow ? 110 : 120;
  const PAD_L = narrow ? 2 : 18;
  const PAD_R = narrow ? 2 : 72;
  const monthHeight = narrow ? 88 : 110;
  // 容器重建（媒体增删）的间隙仍按分桶显示占位，避免内容高度塌陷丢失滚动位置
  const states = useMemo(() => (buckets ? monthStates(store ? segments : [], buckets) : []), [buckets, segments, store]);
  const cacheRef = useRef<LayoutCache>(new Map());
  const dims = useDimensionsVersion();
  const dimsRef = useRef(dims);
  const layout: TimelineLayout = useMemo(() => {
    // 补到新宽高后重新排布已缓存的日期
    if (cacheRef.current.size > 4000 || dimsRef.current !== dims) { cacheRef.current.clear(); dimsRef.current = dims; }
    return buildLayout(buckets ?? [], states, { width, rowHeight: rowH, gap, square: prefs.gridStyle === 'square', monthHeight, dayHeight: 42, basis }, cacheRef.current);
  }, [buckets, states, width, rowH, gap, prefs.gridStyle, monthHeight, basis, dims]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const setScrollNode = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);
  // 虚拟列表只在可见范围变化时重绘；时间尺指针与悬浮月份标题需要逐帧的滚动位置
  const [scrollTop, setScrollTop] = useState(0);
  const v = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => layout.rows[i]?.height ?? 0,
    getItemKey: (i) => layout.rows[i]?.key ?? i,
    paddingStart: TOP,
    paddingEnd: BOTTOM,
    overscan: 4,
  });

  /* ---------- 滚动锚定：上方内容高度变化时保持视线所在的图不动 ---------- */
  const anchorRef = useRef<ScrollAnchor | null>(null);
  const layoutRef = useRef(layout);
  useLayoutEffect(() => {
    layoutRef.current = layout;
    v.measure();
    const el = scrollRef.current;
    const a = anchorRef.current;
    if (!el || !a || el.scrollTop <= 0) return;
    const y = resolveAnchor(layout, a);
    if (y == null) return;
    const target = y + TOP - PROBE;
    if (Math.abs(target - el.scrollTop) > 1) el.scrollTop = target;
  }, [layout, v, TOP]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        anchorRef.current = anchorAt(layoutRef.current, el.scrollTop - TOP + PROBE);
        setScrollTop(el.scrollTop);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [TOP, scrollEl]);

  // 筛选变化：回到顶部
  useEffect(() => {
    anchorRef.current = null;
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query, typeFilter]);

  const vItems = v.getVirtualItems();
  const current = layout.rows.length ? monthAtOffset(layout, scrollTop - TOP + PROBE) : null;

  /* ---------- 按实际像素预取，避免虚拟列表的行级超扫命中远处月份 ---------- */
  const prefetchEnd = scrollTop + (scrollEl?.clientHeight ?? 0) * 1.5;
  const gapKey = vItems.flatMap(({ index }) => {
    const row = layout.rows[index];
    const top = TOP + layout.offsets[index]!;
    return row?.kind === 'gap' && top < prefetchEnd && top + row.height > scrollTop ? [row.monthIdx] : [];
  }).join(',');
  useEffect(() => {
    if (!store || !gapKey) return;
    const t = setTimeout(() => gapKey.split(',').forEach((m) => store.ensure(Number(m))), 80);
    return () => clearTimeout(t);
  }, [gapKey, store, snap.version]);

  const jumpTo = useCallback(
    (monthIdx: number, dragging: boolean) => {
      const el = scrollRef.current;
      const top = layoutRef.current.monthTop[monthIdx];
      if (!el || top == null || top < 0) return;
      el.scrollTo({ top: TOP + top - (narrow ? 64 : 0), behavior: 'instant' });
      anchorRef.current = anchorAt(layoutRef.current, el.scrollTop - TOP + PROBE);
      setScrollTop(el.scrollTop);
      if (!dragging && states[monthIdx]?.status === 'unloaded') store?.ensure(monthIdx);
    },
    [TOP, narrow, states, store],
  );

  /* ---------- 选择 ---------- */
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [selectMode, setSelectMode] = useState(false);
  const selecting = selectMode || selected.size > 0;
  const lastPicked = useRef<string | null>(null);
  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelectMode(false);
    lastPicked.current = null;
  }, []);
  useEffect(clearSelection, [query, typeFilter, clearSelection]);

  const itemsById = useMemo(() => {
    const m = new Map<string, MediaItem>();
    for (const s of segments) for (const it of s.items) m.set(it.id, it);
    return m;
  }, [segments]);

  const label = query ? `搜索「${query}」` : '全部照片';
  const scopeFor = useCallback(
    (seg: Segment): ViewerScope => ({
      label,
      items: seg.items,
      query: seg.cursorQuery,
      nextCursor: seg.cursor,
      total: seg.startIdx === 0 ? (bucketsQ.data?.total ?? null) : null,
    }),
    [label, bucketsQ.data?.total],
  );

  const handlers = useRef<TileApi>(null as unknown as TileApi);
  handlers.current = {
    toggle(item, shift) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (shift && lastPicked.current && lastPicked.current !== item.id) {
          const order = displayOrder(states);
          const a = order.findIndex((m) => m.id === lastPicked.current);
          const b = order.findIndex((m) => m.id === item.id);
          if (a >= 0 && b >= 0) {
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(order[i]!.id);
            return next;
          }
        }
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      lastPicked.current = item.id;
    },
    activate(item, el, e) {
      if (selecting || e.shiftKey) {
        handlers.current.toggle(item, e.shiftKey);
        return;
      }
      const seg = store?.segmentOf(item.id);
      if (!seg) return;
      openViewer(scopeFor(seg), seg.items.findIndex((m) => m.id === item.id), { originEl: el });
    },
    longPress(item) {
      setSelected((prev) => new Set(prev).add(item.id));
      lastPicked.current = item.id;
    },
  };
  const api = useMemo<TileApi>(
    () => ({
      toggle: (...a) => handlers.current.toggle(...a),
      activate: (...a) => handlers.current.activate(...a),
      longPress: (...a) => handlers.current.longPress(...a),
    }),
    [],
  );

  const toggleDay = (day: DayGroup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const all = day.items.every((m) => next.has(m.id));
      for (const m of day.items) {
        if (all) next.delete(m.id);
        else next.add(m.id);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !useViewer.getState().open) clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting, clearSelection]);

  // 查看器里改了收藏：同步到时间线已加载项
  useEffect(() => {
    if (!store) return;
    return useViewer.subscribe((s, prev) => {
      if (!s.scope || s.scope.items === prev.scope?.items) return;
      const fav = new Set<string>();
      const unfav = new Set<string>();
      for (const it of s.scope.items) {
        const mine = itemsByIdRef.current.get(it.id);
        if (mine && mine.favorite !== it.favorite) (it.favorite ? fav : unfav).add(it.id);
      }
      if (fav.size) store.patch(fav, { favorite: true });
      if (unfav.size) store.patch(unfav, { favorite: false });
    });
  }, [store]);
  const itemsByIdRef = useRef(itemsById);
  itemsByIdRef.current = itemsById;

  // 首次加载后以第一张照片设定动态强调色
  const tinted = useRef(false);
  const topSeg = segments.find((s) => s.startIdx === 0 && s.loadedOnce);
  useEffect(() => {
    if (tinted.current || !topSeg?.items.length) return;
    tinted.current = true;
    setDynamicFrom(topSeg.items.find((m) => m.mediaType === 'image') ?? topSeg.items[0]);
  }, [topSeg]);

  /* ---------- 批量操作 ---------- */
  const [busy, setBusy] = useState<null | 'favorite' | 'download' | 'batch'>(null);
  const [batchItems, setBatchItems] = useState<MediaItem[] | null>(null);
  const selectedItems = useMemo(() => [...selected].map((id) => itemsById.get(id)).filter(Boolean) as MediaItem[], [selected, itemsById]);
  const allFavorite = selectedItems.length > 0 && selectedItems.every((m) => m.favorite);

  const runFavorite = async () => {
    if (!store || !selected.size) return;
    const ids = [...selected];
    const favorite = !allFavorite;
    setBusy('favorite');
    try {
      let updated = 0;
      for (let i = 0; i < ids.length; i += FAVORITE_BATCH) {
        updated += (await call('setFavorite', { body: { ids: ids.slice(i, i + FAVORITE_BATCH), favorite } })).updated;
      }
      store.patch(new Set(ids), { favorite });
      void invalidate('listMedia', 'buckets', 'facets', 'memories');
      toast.success(favorite ? `已收藏 ${updated} 项` : `已取消收藏 ${updated} 项`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '收藏没有保存，请检查网络后重试');
    } finally {
      setBusy(null);
    }
  };

  const runDownload = async () => {
    if (!selected.size) return;
    if (selected.size > 5000) {
      toast.error('一次最多打包下载 5000 项，请减少选择后再试');
      return;
    }
    setBusy('download');
    try {
      const t = await call('createDownload', { body: { ids: [...selected] } });
      const a = document.createElement('a');
      a.href = t.url;
      a.download = t.fileName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.success(`正在下载 ${t.fileName}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : '打包下载没有开始，请检查网络后重试');
    } finally {
      setBusy(null);
    }
  };

  const openBatch = async () => {
    if (!selected.size) return;
    if (selected.size > 1000) { toast.error('一次最多选择 1000 项，请减少选择后重试'); return; }
    setBusy('batch');
    try {
      const ids = [...selected];
      const resolved: MediaItem[] = [];
      for (let i = 0; i < ids.length; i += 8) {
        const group = await Promise.all(ids.slice(i, i + 8).map(async (id) => {
          const known = itemsById.get(id);
          return known?.source ? known : call('mediaDetail', { params: { id } });
        }));
        resolved.push(...group);
      }
      const images = resolved.filter((item) => item.mediaType === 'image');
      if (!images.length) { toast.error('请选择图片'); return; }
      if (images.some((item) => !item.source)) { toast.error('部分图片缺少源版本，请刷新后重试'); return; }
      if (images.length < resolved.length) toast.info(`已跳过 ${resolved.length - images.length} 项非图片媒体`);
      setBatchItems(images);
    } catch (error) { toast.error(error instanceof ApiError ? error.message : '无法读取所选图片，请重试'); }
    finally { setBusy(null); }
  };

  const play = () => {
    if (!topSeg?.items.length) return;
    openViewer(scopeFor(topSeg), 0, { play: true });
  };

  /* ---------- 渲染 ---------- */
  const total = bucketsQ.data?.total;
  const filtered = !!query || typeFilter !== 'all';
  let body: React.ReactNode = null;
  if (bucketsQ.isPending) body = <CenterNote><LoaderCircle className="size-5 animate-spin" />正在加载照片…</CenterNote>;
  else if (bucketsQ.isError) {
    body = (
      <CenterNote>
        <p className="text-[15px] font-semibold text-fg">照片时间线没有加载出来</p>
        <p>{bucketsQ.error instanceof ApiError ? bucketsQ.error.message : '网络连接中断，请检查网络后重试。'}</p>
        <button type="button" onClick={() => void bucketsQ.refetch()} className="mt-2 inline-flex h-10 items-center gap-2 rounded-full bg-accent px-[18px] text-[13.5px] font-semibold text-accent-fg">
          <RotateCw className="size-4" />重新加载
        </button>
      </CenterNote>
    );
  } else if (total === 0 && !filtered) {
    body = (
      <CenterNote>
        <p className="text-[15px] font-semibold text-fg">这里还没有照片</p>
        <p className="max-w-[420px]">照片和视频需要先由管理员在控制台添加并启用媒体库，扫描完成后会按拍摄时间出现在这里。</p>
        {isAdmin ? (
          <Link to="/admin" search={{ tab: 'libraries' }} className="mt-2 inline-flex h-10 items-center rounded-full bg-accent px-[18px] text-[13.5px] font-semibold text-accent-fg">
            前往控制台启用媒体库
          </Link>
        ) : (
          <p>如果你已经有照片，请联系管理员启用媒体库。</p>
        )}
      </CenterNote>
    );
  } else if (total === 0) {
    body = (
      <CenterNote>
        <p className="text-[15px] font-semibold text-fg">{query ? `没有找到与「${query}」匹配的${typeFilter === 'all' ? '照片或视频' : TYPE_LABEL[typeFilter]}` : `还没有${TYPE_LABEL[typeFilter]}`}</p>
        <p>可以换个关键词，或者清除筛选查看全部照片。</p>
        <button
          type="button"
          onClick={() => void navigate({ to: '/photos', search: {} })}
          className="mt-2 inline-flex h-10 items-center rounded-full border border-line-2 px-[18px] text-[13.5px] font-semibold text-fg-2 hover:bg-accent-soft"
        >
          清除搜索和筛选
        </button>
      </CenterNote>
    );
  }

  // 悬浮月份标题：桌面为完整标题（被下一个月顶出）；手机为命令条下方的简化标签，标题行滚入命令条后出现
  const stickyIdx = (() => {
    const y = scrollTop - TOP;
    const at = layout.rows.length ? monthAtOffset(layout, Math.max(0, y)) : null;
    if (!at || y <= (layout.monthTop[at.monthIdx] ?? 0) + (narrow ? 40 : 0)) return null;
    let next = -1;
    for (let i = at.monthIdx + 1; i < layout.monthTop.length; i++) if (layout.monthTop[i]! >= 0) { next = layout.monthTop[i]!; break; }
    const shift = next >= 0 ? Math.min(0, next - y - monthHeight) : 0;
    return { monthIdx: at.monthIdx, shift };
  })();

  const monthMeta = (mi: number) => {
    const b = buckets![mi]!;
    const st = states[mi]!;
    const { year, month } = parseKey(b.key);
    const places = topFolders(st.items);
    return { year, month, title: places.join('、') || `${year} 年 ${month} 月`, count: b.count, video: st.items.some((m) => m.mediaType === 'video') };
  };

  return (
    <div className="group/page relative h-full overflow-hidden" data-selecting={selecting}>
      <CommandBar
        aria-label="照片命令条"
        search={{
          value: text,
          onChange: setText,
          onSubmit: (v) => void navigate({ to: '/photos', search: (prev: { type?: Exclude<TypeFilter, 'all'> }) => ({ q: v || undefined, type: prev.type }) }),
          onClear: () => {
            setText('');
            if (query) void navigate({ to: '/photos', search: (prev: { type?: Exclude<TypeFilter, 'all'> }) => ({ type: prev.type }) });
          },
          placeholder: '搜索文件名或文件夹，回车查找',
          label: '搜索照片和视频',
        }}
      >
        <CommandDivider className="max-md:hidden" />
        <CommandButton icon={<Play className="fill-current" strokeWidth={0} />} onClick={play} disabled={!topSeg?.items.length} aria-label="从第一张开始播放幻灯片" className="max-md:px-2.5">
          <span className="max-md:hidden">播放</span>
        </CommandButton>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <CommandButton icon={<Funnel />} active={typeFilter !== 'all'} aria-label={`类型筛选：${TYPE_LABEL[typeFilter]}`} className="max-md:px-2.5">
                <span className="max-md:hidden">{typeFilter === 'all' ? '筛选' : TYPE_LABEL[typeFilter]}</span>
              </CommandButton>
            }
          />
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuGroup>
              <DropdownMenuLabel>显示类型</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
                {(Object.keys(TYPE_LABEL) as TypeFilter[]).map((k) => (
                  <DropdownMenuRadioItem key={k} value={k}>{TYPE_LABEL[k]}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>按时间排列</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={basis} onValueChange={(v) => updatePrefs.mutate({ timelineBasis: v as TimeBasis })}>
                <DropdownMenuRadioItem value="modified">修改时间</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="taken">拍摄时间</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <CommandButton
          icon={<CircleCheck />}
          active={selecting}
          aria-pressed={selecting}
          aria-label={selecting ? '退出选择' : '选择照片'}
          onClick={() => (selecting ? clearSelection() : setSelectMode(true))}
          className="max-md:px-2.5"
        >
          <span className="max-md:hidden">选择</span>
        </CommandButton>
      </CommandBar>

      <div
        ref={setScrollNode}
        className="absolute inset-0 overflow-x-hidden overflow-y-auto [overflow-anchor:none] [scrollbar-width:thin] max-md:scrollbar-none"
      >
        {body}
        <div style={{ paddingLeft: PAD_L, paddingRight: PAD_R }}>
            <div ref={contentRef} className="relative w-full" style={{ height: body ? 0 : TOP + layout.total + BOTTOM }}>
              {!body &&
                buckets &&
                vItems.map((vi) => {
                  const row = layout.rows[vi.index];
                  if (!row) return null;
                  const top = TOP + layout.offsets[vi.index]!;
                  const style = { top, height: row.height };
                  if (row.kind === 'month') {
                    return (
                      <div key={vi.key} className={cn('absolute inset-x-0', !narrow && stickyIdx?.monthIdx === row.monthIdx && 'invisible')} style={style}>
                        <MonthHeader {...monthMeta(row.monthIdx)} height={row.height} />
                      </div>
                    );
                  }
                  if (row.kind === 'day') {
                    const allSel = selecting && row.day.items.every((m) => selected.has(m.id));
                    return (
                      <div key={vi.key} className="group/day absolute inset-x-0" style={style}>
                        <DayHeader day={row.day} allSelected={allSel} onToggle={() => toggleDay(row.day)} />
                      </div>
                    );
                  }
                  if (row.kind === 'tiles') {
                    return (
                      <div key={vi.key} role="list" className="absolute left-0 flex" style={{ top, height: row.cellHeight, gap }}>
                        {row.cells.map((c) => {
                          const it = itemsById.get(c.item.id) ?? c.item;
                          return (
                            <div key={c.item.id} role="listitem" className="contents">
                              <TimelineTile item={it} width={c.width} height={c.height} selected={selected.has(it.id)} hoverPreview={prefs.hoverPreview} api={api} />
                            </div>
                          );
                        })}
                      </div>
                    );
                  }
                  const seg = states[row.monthIdx]?.segId != null ? segments.find((s) => s.id === states[row.monthIdx]!.segId) : undefined;
                  const err = seg?.error ?? segments.find((s) => s.error && s.startIdx === row.monthIdx)?.error;
                  const errSeg = seg?.error ? seg : segments.find((s) => s.error && s.startIdx === row.monthIdx);
                  return (
                    <div key={vi.key} className="absolute inset-x-0" style={style}>
                      <GapRow rowHeight={rowH} gap={gap} error={err ?? null} onRetry={errSeg && store ? () => store.retry(errSeg.id) : undefined} />
                    </div>
                  );
                })}
            </div>
        </div>
      </div>

      {!body && buckets && stickyIdx && narrow && (
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-[60px] z-[3] flex h-9 items-center gap-2 bg-[linear-gradient(var(--bg)_60%,transparent)] px-3.5 text-[13px]">
          <b className="font-semibold text-fg">{monthLabel(buckets[stickyIdx.monthIdx]!.key)}</b>
          <span className="text-muted">{buckets[stickyIdx.monthIdx]!.count.toLocaleString('zh-CN')} 项</span>
        </div>
      )}
      {!body && buckets && stickyIdx && !narrow && (
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 z-[3]"
          style={{ left: PAD_L, width: width || undefined, transform: `translateY(${stickyIdx.shift}px)` }}
        >
          <MonthHeader {...monthMeta(stickyIdx.monthIdx)} height={monthHeight} />
        </div>
      )}

      {!body && buckets && buckets.length > 0 && (
        <>
          <TimeRuler buckets={buckets} current={current} onJump={jumpTo} />
          <MobileScrubber
            scrollEl={scrollEl}
            scrollTop={scrollTop}
            scrollHeight={TOP + layout.total + BOTTOM}
            label={current && buckets[current.monthIdx] ? monthLabel(buckets[current.monthIdx]!.key) : null}
          />
        </>
      )}

      <SelectionBar
        count={selected.size}
        allFavorite={allFavorite}
        busy={busy}
        onFavorite={() => void runFavorite()}
        onDownload={() => void runDownload()}
        canBatch={canBatch}
        onBatch={() => void openBatch()}
        onClear={clearSelection}
      />
      {batchItems && <BatchCreateDialog items={batchItems} onClose={() => setBatchItems(null)} onCreated={() => {
        setBatchItems(null); clearSelection(); void navigate({ to: '/editor', search: { tab: 'batches' } });
      }} />}
    </div>
  );
}

function CenterNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 px-6 pt-20 pb-24 text-center text-[13.5px] text-muted">
      {children}
    </div>
  );
}

function MonthHeader({ year, month, title, count, video, height }: { year: number; month: number; title: string; count: number; video: boolean; height: number }) {
  return (
    <div className="flex items-end gap-4 bg-[linear-gradient(var(--bg)_70%,transparent)] pt-7 pb-2.5 max-md:pl-3" style={{ height }}>
      <span className="font-display text-[92px] leading-[.78] font-extrabold tracking-[-.01em] text-fg max-md:text-[64px]">{month}</span>
      <div className="flex min-w-0 flex-col pb-1 leading-[1.35]">
        <b className="truncate text-[15px] font-semibold text-fg">{title}</b>
        <span className="text-[12.5px] text-muted">{count.toLocaleString('zh-CN')} 项{video ? '，含视频' : ''}</span>
      </div>
      <span className="ml-auto pb-1.5 font-display text-[22px] font-semibold text-muted max-md:pr-3">{year}</span>
    </div>
  );
}

function DayHeader({ day, allSelected, onToggle }: { day: DayGroup; allSelected: boolean; onToggle: () => void }) {
  const place = day.items[0] ? folderLabel(day.items[0].folder) : null;
  return (
    <div className="flex h-full items-baseline gap-2.5 px-0.5 pt-3.5 pb-2 text-[13px] text-fg-2 max-md:px-3">
      <b className="font-semibold text-fg">{dayLabel(day)}</b>
      {place && <span className="min-w-0 truncate">{place}</span>}
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={allSelected}
        aria-label={allSelected ? `取消选择 ${dayLabel(day)} 的 ${day.items.length} 项` : `选择 ${dayLabel(day)} 的 ${day.items.length} 项`}
        className={cn(
          'ml-auto grid size-[18px] flex-none self-center place-items-center rounded-full border-[1.5px] border-line-2 opacity-0 transition-opacity duration-150 group-hover/day:opacity-100 focus-visible:opacity-100 group-data-[selecting=true]/page:opacity-100',
          allSelected && 'border-accent bg-accent text-accent-fg',
        )}
      >
        {allSelected && <Check className="size-3" strokeWidth={3} />}
      </button>
    </div>
  );
}

function GapRow({ rowHeight, gap, error, onRetry }: { rowHeight: number; gap: number; error: string | null; onRetry?: () => void }) {
  if (error) {
    return (
      <div className="flex h-full max-h-[240px] flex-col items-center justify-center gap-2 rounded-[var(--r2)] border border-line text-center text-[13px] text-muted">
        <p>这一段照片没有加载出来：{error}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-2 px-3.5 text-[13px] font-semibold text-fg-2 hover:bg-accent-soft">
            <RotateCw className="size-3.5" />重试
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className="h-full opacity-60"
      style={{
        paddingTop: 42,
        backgroundImage: `linear-gradient(to bottom, var(--sunken) ${rowHeight}px, transparent ${rowHeight}px)`,
        backgroundSize: `100% ${rowHeight + gap}px`,
        backgroundOrigin: 'content-box',
        backgroundRepeat: 'repeat-y',
        backgroundClip: 'content-box',
      }}
    />
  );
}

function SelectionBar({ count, allFavorite, busy, onFavorite, onDownload, onClear, canBatch, onBatch }: {
  count: number; allFavorite: boolean; busy: null | 'favorite' | 'download' | 'batch'; onFavorite: () => void; onDownload: () => void; onClear: () => void;
  canBatch: boolean; onBatch: () => void;
}) {
  const show = count > 0;
  return (
    <div
      role="toolbar"
      aria-label="已选项操作"
      aria-hidden={!show}
      inert={!show}
      className={cn(
        'glass absolute bottom-[22px] left-1/2 z-[7] flex items-center gap-1 rounded-[calc(var(--r3)+4px)] p-1.5 whitespace-nowrap shadow-[0_18px_40px_-18px_rgba(0,0,0,.6)] transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)]',
        show ? '-translate-x-1/2 translate-y-0' : '-translate-x-1/2 translate-y-[calc(100%+40px)]',
      )}
    >
      <span className="pr-3 pl-2.5 font-semibold" aria-live="polite">已选 {count.toLocaleString('zh-CN')} 项</span>
      <CommandButton icon={busy === 'favorite' ? <LoaderCircle className="animate-spin" /> : allFavorite ? <HeartOff /> : <Heart />} onClick={onFavorite} disabled={!!busy} aria-label={allFavorite ? '取消收藏' : '收藏'}>
        <span className="max-md:hidden">{allFavorite ? '取消收藏' : '收藏'}</span>
      </CommandButton>
      <CommandButton icon={busy === 'download' ? <LoaderCircle className="animate-spin" /> : <Download />} onClick={onDownload} disabled={!!busy} aria-label="下载">
        <span className="max-md:hidden">下载</span>
      </CommandButton>
      {canBatch && <CommandButton icon={busy === 'batch' ? <LoaderCircle className="animate-spin" /> : <WandSparkles />} onClick={onBatch} disabled={!!busy} aria-label="自动修复">
        <span className="max-md:hidden">自动修复</span>
      </CommandButton>}
      <CommandButton icon={<X />} onClick={onClear} aria-label="取消选择" />
    </div>
  );
}
