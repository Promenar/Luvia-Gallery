import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TimelineBucket } from '@luvia/contracts';
import { cn } from '@/lib/cn';
import { bucketAtY, layoutRuler, monthLabel, yForBucket } from './ruler';

function useHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setH(el.clientHeight);
    const ro = new ResizeObserver(([e]) => setH(Math.floor(e!.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, h] as const;
}

export interface TimeRulerProps {
  buckets: readonly TimelineBucket[];
  /** 当前所在月份（桶索引）与月内进度。 */
  current: { monthIdx: number; progress: number } | null;
  /** 立即跳到某月；连续拖动时由最终停留的视口加载。 */
  onJump: (monthIdx: number, dragging: boolean) => void;
}

/**
 * 右侧时间尺（桌面）：每年一个刻度，下方 12 条月份分布柱（自上而下 12 月 → 1 月）。
 * 点击或拖动跳到对应月份，指针随滚动位置移动。
 */
export function TimeRuler({ buckets, current, onJump }: TimeRulerProps) {
  const [ref, height] = useHeight<HTMLDivElement>();
  const years = useMemo(() => layoutRuler(buckets, height), [buckets, height]);
  const maxCount = useMemo(() => Math.max(1, ...buckets.map((b) => b.count)), [buckets]);
  const [hover, setHover] = useState<{ y: number; idx: number } | null>(null);
  const dragging = useRef(false);
  const lastJump = useRef(-1);

  const curYear = current ? buckets[current.monthIdx]?.key.slice(0, 4) : undefined;
  const needle = current ? yForBucket(years, current.monthIdx, current.progress) : null;

  const pick = (clientY: number) => {
    const el = ref.current;
    if (!el) return null;
    const y = Math.min(Math.max(clientY - el.getBoundingClientRect().top, 0), height - 1);
    const idx = bucketAtY(years, y);
    return idx < 0 ? null : { y, idx };
  };

  return (
    <div className="absolute top-0 right-0 bottom-0 z-[4] hidden w-[58px] flex-col pt-[78px] pr-2 pb-6 md:flex">
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label="时间尺：拖动或点击跳到对应月份"
        aria-valuemin={0}
        aria-valuemax={Math.max(0, buckets.length - 1)}
        aria-valuenow={current?.monthIdx ?? 0}
        aria-valuetext={current && buckets[current.monthIdx] ? monthLabel(buckets[current.monthIdx]!.key) : undefined}
        className="relative flex-1 cursor-pointer touch-none select-none rounded-[var(--r1)] outline-offset-4"
        onKeyDown={(e) => {
          const cur = current?.monthIdx ?? 0;
          const next = e.key === 'ArrowDown' || e.key === 'PageDown' ? cur + 1 : e.key === 'ArrowUp' || e.key === 'PageUp' ? cur - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? buckets.length - 1 : null;
          if (next == null) return;
          e.preventDefault();
          onJump(Math.min(Math.max(next, 0), buckets.length - 1), false);
        }}
        onPointerDown={(e) => {
          const p = pick(e.clientY);
          if (!p) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          lastJump.current = p.idx;
          setHover(p);
          onJump(p.idx, false);
        }}
        onPointerMove={(e) => {
          const p = pick(e.clientY);
          setHover(p);
          if (dragging.current && p && p.idx !== lastJump.current) {
            lastJump.current = p.idx;
            onJump(p.idx, true);
          }
        }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        onPointerLeave={() => { if (!dragging.current) setHover(null); }}
      >
        {years.map((y) => {
          const on = String(y.year) === curYear;
          const showHist = y.height >= 54;
          return (
            <div key={y.year} className="group/yr absolute right-0 left-0 flex flex-col items-end" style={{ top: y.top, height: y.height }}>
              <b className={cn('font-display text-[13px] leading-none font-semibold text-muted group-hover/yr:text-fg', on && 'text-accent group-hover/yr:text-accent')}>{y.year}</b>
              {showHist && (
                <div aria-hidden className="mt-[3px] flex w-full flex-col items-end gap-px">
                  {y.counts.map((c, s) => (
                    <i
                      key={s}
                      className={cn('block h-[2px] rounded-[2px] bg-line-2', on && c > 0 && 'bg-[color-mix(in_oklab,var(--accent)_65%,transparent)]')}
                      style={{ width: `${c > 0 ? Math.max(14, (c / maxCount) * 100) : 6}%`, opacity: c > 0 ? 1 : 0.35 }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {needle != null && (
          <div aria-hidden className="pointer-events-none absolute right-0 h-[2px] w-[26px] rounded-[2px] bg-accent shadow-[0_0_12px_var(--accent)] transition-[top] duration-[250ms]" style={{ top: needle }} />
        )}
        {hover && buckets[hover.idx] && (
          <div
            aria-hidden
            className="glass pointer-events-none absolute right-[52px] -translate-y-1/2 rounded-[var(--r2)] px-2.5 py-1 text-[12.5px] font-semibold whitespace-nowrap text-fg shadow-[0_10px_24px_-12px_rgba(0,0,0,.6)]"
            style={{ top: hover.y }}
          >
            {monthLabel(buckets[hover.idx]!.key)}
          </div>
        )}
      </div>
    </div>
  );
}

export interface MobileScrubberProps {
  scrollEl: HTMLElement | null;
  scrollTop: number;
  scrollHeight: number;
  /** 当前月份文字，拖动时显示。 */
  label: string | null;
  /** 页面底部留白（底栏等），滑块不进入该区域。 */
  className?: string;
}

/** 手机宽度的简化时间尺：右缘可拖动的滑块，拖动时显示当前月份。内容不足三屏时不显示。 */
export function MobileScrubber({ scrollEl, scrollTop, scrollHeight, label, className }: MobileScrubberProps) {
  const [ref, trackH] = useHeight<HTMLDivElement>();
  const [drag, setDrag] = useState(false);
  const grab = useRef(0);
  const view = scrollEl?.clientHeight ?? 0;
  const max = Math.max(1, scrollHeight - view);
  const THUMB = 44;
  const top = (Math.min(scrollTop, max) / max) * Math.max(0, trackH - THUMB);
  const enabled = scrollHeight > view * 3;

  const moveTo = (clientY: number) => {
    const el = ref.current;
    if (!el || !scrollEl) return;
    const y = clientY - el.getBoundingClientRect().top - grab.current;
    scrollEl.scrollTop = (Math.min(Math.max(y, 0), trackH - THUMB) / Math.max(1, trackH - THUMB)) * max;
  };

  return (
    <div ref={ref} aria-hidden className={cn('pointer-events-none absolute top-[70px] right-0 bottom-6 z-[4] w-7 md:hidden', className)}>
      {enabled && (
        <>
          <div
            className={cn('pointer-events-auto absolute right-1 h-11 w-[22px] touch-none rounded-full border border-line-2 bg-glass backdrop-blur transition-opacity', drag ? 'opacity-100' : 'opacity-70')}
            style={{ top }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              grab.current = e.clientY - e.currentTarget.getBoundingClientRect().top;
              setDrag(true);
            }}
            onPointerMove={(e) => { if (drag) moveTo(e.clientY); }}
            onPointerUp={() => setDrag(false)}
            onPointerCancel={() => setDrag(false)}
          >
            <span className="absolute inset-x-[7px] top-[17px] h-px bg-fg-2" />
            <span className="absolute inset-x-[7px] top-[21px] h-px bg-fg-2" />
            <span className="absolute inset-x-[7px] top-[25px] h-px bg-fg-2" />
          </div>
          {drag && label && (
            <div className="glass absolute right-9 -translate-y-1/2 rounded-[var(--r2)] px-2.5 py-1 text-[12.5px] font-semibold whitespace-nowrap text-fg" style={{ top: top + THUMB / 2 }}>
              {label}
            </div>
          )}
        </>
      )}
    </div>
  );
}
