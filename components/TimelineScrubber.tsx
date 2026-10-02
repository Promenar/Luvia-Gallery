import React, { useRef, useState } from 'react';

export interface TimelineScrubberProps {
  /** 年份标记：位置为该年首个章节在时间线中的相对高度（0~1） */
  marks: Array<{ year: string; ratio: number }>;
  /** 当前滚动位置（0~1） */
  progress: number;
  /** 拖动或点击时的目标位置（0~1） */
  onScrub: (ratio: number) => void;
  /** 拖动过程中显示的日期气泡文案 */
  labelAt: (ratio: number) => string;
  ariaLabel: string;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * 时间拖动条：右侧细轨道 + 年份刻度，拖动时浮出当前月份气泡。
 * 使用 pointer capture 统一鼠标、触摸与触控笔；同时支持键盘上下键与 PageUp/PageDown 微调。
 */
export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({ marks, progress, onScrub, labelAt, ariaLabel }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragRatio, setDragRatio] = useState<number | null>(null);

  const ratioFromPointer = (clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return 0;
    return clamp01((clientY - rect.top) / rect.height);
  };

  const scrubTo = (ratio: number) => {
    setDragRatio(ratio);
    onScrub(ratio);
  };

  const shownRatio = dragRatio ?? clamp01(progress);

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shownRatio * 100)}
      aria-valuetext={labelAt(shownRatio)}
      tabIndex={0}
      data-testid="timeline-scrubber"
      className="group absolute top-2 right-0 bottom-2 z-30 w-10 cursor-ns-resize touch-none select-none outline-none md:top-20"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        scrubTo(ratioFromPointer(event.clientY));
      }}
      onPointerMove={(event) => {
        if (dragRatio === null) return;
        scrubTo(ratioFromPointer(event.clientY));
      }}
      onPointerUp={() => setDragRatio(null)}
      onPointerCancel={() => setDragRatio(null)}
      onKeyDown={(event) => {
        const step = event.key === 'PageDown' || event.key === 'PageUp' ? 0.1 : 0.02;
        if (event.key === 'ArrowDown' || event.key === 'PageDown') { event.preventDefault(); onScrub(clamp01(progress + step)); }
        if (event.key === 'ArrowUp' || event.key === 'PageUp') { event.preventDefault(); onScrub(clamp01(progress - step)); }
        if (event.key === 'Home') { event.preventDefault(); onScrub(0); }
        if (event.key === 'End') { event.preventDefault(); onScrub(1); }
      }}
    >
      {/* 轨道与年份刻度 */}
      <div className="absolute top-0 right-3 bottom-0 w-px bg-border" aria-hidden="true" />
      {marks.map(mark => (
        <span
          key={mark.year}
          aria-hidden="true"
          className="absolute right-5 -translate-y-1/2 text-[10px] font-medium tabular-nums text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-coarse:opacity-100"
          style={{ top: `${mark.ratio * 100}%` }}
        >
          {mark.year}
        </span>
      ))}
      {/* 当前位置指示 */}
      <div
        aria-hidden="true"
        className="absolute right-[9px] h-6 w-[7px] -translate-y-1/2 rounded-full bg-primary/80 transition-[top] duration-75"
        style={{ top: `${shownRatio * 100}%` }}
      />
      {dragRatio !== null && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-8 -translate-y-1/2 whitespace-nowrap rounded-full border border-border bg-popover px-3 py-1.5 text-sm font-medium tabular-nums text-popover-foreground shadow-md"
          style={{ top: `${dragRatio * 100}%` }}
        >
          {labelAt(dragRatio)}
        </div>
      )}
    </div>
  );
};
