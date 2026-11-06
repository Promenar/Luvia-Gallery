import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { MediaItem } from '@luvia/contracts';
import { usePreferences } from '@/stores/session';
import { setDynamicFrom } from '@/theme/ThemeProvider';
import { aspectOf, justifyRows, squareRows } from './justify';
import { useDimensionsVersion } from '@/lib/dimensions';
import { Thumb } from './Thumb';

/** 密度档位对应的目标行高（桌面 / 窄屏）。 */
export const ROW_HEIGHTS = { 1: [120, 78], 2: [150, 94], 3: [180, 112], 4: [220, 136], 5: [270, 168] } as const;
export const GRID_GAP = 4;

export function useRowHeight(width: number) {
  const density = usePreferences().density as keyof typeof ROW_HEIGHTS;
  const [desk, narrow] = ROW_HEIGHTS[density] ?? ROW_HEIGHTS[3];
  return width < 760 ? narrow : desk;
}

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * 网格顶部相对外层滚动容器内容起点的距离。网格上方的标题、子文件夹等高度会变化，
 * 用 ResizeObserver 观察滚动容器的直接子元素、MutationObserver 观察子元素增删来重新测量。
 */
function useScrollMargin(scrollElement: HTMLElement | null | undefined, gridEl: HTMLElement | null) {
  const [margin, setMargin] = useState(0);
  useLayoutEffect(() => {
    if (!scrollElement || !gridEl) return;
    const measure = () => {
      const m = gridEl.getBoundingClientRect().top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop;
      setMargin((prev) => (Math.abs(prev - m) < 0.5 ? prev : m));
    };
    measure();
    const ro = new ResizeObserver(measure);
    const observeChildren = () => { ro.disconnect(); Array.from(scrollElement.children).forEach((c) => ro.observe(c)); ro.observe(scrollElement); };
    observeChildren();
    const mo = new MutationObserver(() => { observeChildren(); measure(); });
    mo.observe(scrollElement, { childList: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [scrollElement, gridEl]);
  return margin;
}

export interface MediaGridProps {
  items: MediaItem[];
  /** 外层滚动容器（网格可位于其中任意位置，自动按实际偏移设置 scrollMargin）；省略时 MediaGrid 自带滚动。 */
  scrollElement?: HTMLElement | null;
  onOpen: (index: number, el: HTMLElement) => void;
  /** 接近底部时调用，用于加载下一页。 */
  onEndReached?: () => void;
  hasMore?: boolean;
  selectedIds?: ReadonlySet<string>;
  className?: string;
}

/**
 * 虚拟化的媒体网格（对齐行或方形，跟随偏好 gridStyle 与 density）。
 * 只渲染视口附近的行，十万级列表也能流畅滚动。
 */
export function MediaGrid({ items, scrollElement, onOpen, onEndReached, hasMore, selectedIds, className }: MediaGridProps) {
  const prefs = usePreferences();
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const ownScroll = useRef<HTMLDivElement>(null);
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const scrollMargin = useScrollMargin(scrollElement, gridEl);
  const rowH = useRowHeight(width);
  const dims = useDimensionsVersion();
  const rows = useMemo(
    () => (prefs.gridStyle === 'square' ? squareRows(items, width, rowH, GRID_GAP) : justifyRows(items, aspectOf, width, rowH, GRID_GAP)),
    // dims：补到新宽高后重新排布
    [items, width, rowH, prefs.gridStyle, dims],
  );
  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollElement ?? ownScroll.current,
    estimateSize: (i) => (rows[i]?.height ?? rowH) + GRID_GAP,
    overscan: 6,
    scrollMargin,
  });
  useEffect(() => { v.measure(); }, [rows, v]);

  const vItems = v.getVirtualItems();
  const lastIndex = vItems.at(-1)?.index ?? 0;
  const endRef = useRef(onEndReached);
  endRef.current = onEndReached;
  useEffect(() => {
    if (hasMore && rows.length && lastIndex >= rows.length - 8) endRef.current?.();
  }, [lastIndex, rows.length, hasMore]);

  const body = (
    <div ref={ref} className="relative w-full" style={{ height: v.getTotalSize() }}>
      {vItems.map((vr) => {
        const row = rows[vr.index]!;
        return (
          <div key={vr.key} className="absolute left-0 flex w-full" style={{ top: vr.start - scrollMargin, gap: GRID_GAP, height: row.height }}>
            {row.cells.map((c) => (
              <Thumb
                key={c.item.id}
                item={c.item}
                width={c.width}
                height={c.height}
                selected={selectedIds?.has(c.item.id)}
                lazy={false}
                onMouseEnter={() => setDynamicFrom(c.item)}
                onClick={(e) => onOpen(c.index, e.currentTarget)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
  if (scrollElement !== undefined) return <div ref={setGridEl} className={className}>{body}</div>;
  return <div ref={ownScroll} className={className ?? 'h-full overflow-y-auto'}>{body}</div>;
}
