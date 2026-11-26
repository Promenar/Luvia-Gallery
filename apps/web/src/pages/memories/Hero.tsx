import { useEffect, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Dialog } from '@base-ui/react/dialog';
import { ChevronDown, ChevronLeft, ChevronRight, GalleryHorizontalEnd, Play } from 'lucide-react';
import { toast } from 'sonner';
import { mediaUrls } from '@luvia/contracts';
import { cn } from '@/lib/cn';
import { canThumb, thumbhashUrl } from '@/components/media/Thumb';
import { usePreferences } from '@/stores/session';
import { setDynamicFrom } from '@/theme/ThemeProvider';
import { openViewer, useViewer, type ViewerScope } from '@/stores/viewer';
import { useLibraryNames, useIsNarrow, useReducedMotion, type HeroData } from './hooks';
import { dateParts, fallbackNotice, heroCopy, HERO_INTERVAL_MS, sourceLabel, type HeroSlide } from './heroSource';
import { HeroSourcePicker } from './HeroSourcePicker';
import './memories.css';

const shownNotices = new Set<string>();

/** 轮播内容来源切换控件；窄屏自动切换为底部抽屉。 */
function HeroSourceControl({ label, open, setOpen, onReroll, className }: {
  label: string; open: boolean; setOpen: (v: boolean) => void; onReroll: () => void; className?: string;
}) {
  const narrow = useIsNarrow();
  const trigger = (
    <>
      <GalleryHorizontalEnd className="size-3.5 shrink-0 text-accent" strokeWidth={1.8} />
      <span className="min-w-0 truncate">来源：{label}</span>
      <ChevronDown className="size-3.5 shrink-0 opacity-70" />
    </>
  );
  const triggerCls = cn(
    'inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-line-2 bg-surface/80 px-3 text-[12px] font-medium text-fg-2 backdrop-blur-md transition-colors hover:bg-accent-soft hover:text-fg',
    className,
  );
  const title = <div className="px-2.5 pt-1.5 pb-1 text-[12.5px] font-semibold text-fg-2">首页轮播内容</div>;

  if (narrow) {
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className={triggerCls}>{trigger}</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup className="glass fixed inset-x-2 bottom-2 z-40 max-h-[78vh] overflow-auto rounded-[calc(var(--r3)+4px)] p-2 pb-[calc(10px+env(safe-area-inset-bottom))] text-fg transition-transform duration-300 ease-[var(--ease-cinema)] outline-none data-[ending-style]:translate-y-[calc(100%+20px)] data-[starting-style]:translate-y-[calc(100%+20px)]">
            <div aria-hidden className="mx-auto mt-1 mb-1 h-1 w-9 rounded-full bg-line-2" />
            <div className="flex items-center justify-between">
              <Dialog.Title render={title} />
              <Dialog.Close className="h-8 rounded-full px-3 text-[13px] font-semibold text-accent">完成</Dialog.Close>
            </div>
            <HeroSourcePicker onDone={() => setOpen(false)} onReroll={() => { onReroll(); setOpen(false); }} />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={triggerCls}>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={8} collisionPadding={16} className="z-40">
          <Popover.Popup className="glass w-80 origin-[var(--transform-origin)] rounded-[calc(var(--r3)+2px)] p-2 text-fg transition-[opacity,scale] duration-150 outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <Popover.Title render={title} />
            <HeroSourcePicker onDone={() => setOpen(false)} onReroll={() => { onReroll(); setOpen(false); }} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** 去掉抽样数量，作为查看器随机续播的筛选条件。 */
function randomFilter(r: Record<string, unknown> | null): Record<string, unknown> {
  const { count: _c, ...rest } = r ?? {};
  return rest;
}

export function Hero({ data }: { data: HeroData }) {
  const { plan, slides, pool, folderName, total, loading, error } = data;
  const style = usePreferences().theme?.style ?? 'cinema';
  const isMono = style === 'monograph';
  const libNames = useLibraryNames();
  const reduce = useReducedMotion();
  const viewerOpen = useViewer((s) => s.open);
  const [cur, setCur] = useState(0);
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState(false);
  const [focusIn, setFocusIn] = useState(false);
  const [popOpen, setPopOpen] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const imgRefs = useRef<(HTMLImageElement | null)[]>([]);
  const [seen, setSeen] = useState<Set<number>>(() => new Set([0, 1]));
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const slideKey = slides.map((s) => s.item.id).join(',');
  useEffect(() => { setCur(0); setSeen(new Set([0, 1])); setTick((t) => t + 1); }, [slideKey]);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  const n = slides.length;
  const idx = n ? ((cur % n) + n) % n : 0;
  const slide: HeroSlide | undefined = slides[idx];
  const nextSlide: HeroSlide | undefined = n > 1 ? slides[(idx + 1) % n] : undefined;
  useEffect(() => { if (slide) setDynamicFrom(slide.item); }, [slide]);

  const notice = plan.requested === 'folder' ? fallbackNotice(plan.fallback, folderName) : null;
  useEffect(() => {
    if (!notice) return;
    const key = `${plan.fallback}:${folderName ?? ''}`;
    if (shownNotices.has(key)) return;
    shownNotices.add(key);
    toast.info(notice);
  }, [notice, plan.fallback, folderName]);

  const go = (i: number) => {
    if (!n) return;
    const next = ((i % n) + n) % n;
    setCur(next);
    setTick((t) => t + 1);
    setSeen((s) => (s.has(next) && s.has((next + 1) % n) ? s : new Set([...s, next, (next + 1) % n])));
  };
  const paused = hover || focusIn || popOpen || viewerOpen || hidden;
  const auto = !reduce && n > 1;

  const label = sourceLabel(plan, folderName);
  const copy = slide ? heroCopy(slide, { plan, folderName, total, libraryNames: libNames }) : null;

  const scopeFor = (s: HeroSlide): { scope: ViewerScope; index: number; shuffle: boolean } => {
    if (s.group) return { scope: { label: copy!.scopeLabel, items: s.group.items }, index: Math.max(0, s.group.items.findIndex((m) => m.id === s.item.id)), shuffle: false };
    const items = pool.length ? pool : slides.map((x) => x.item);
    const random = plan.source === 'memories' ? {} : randomFilter(plan.random as Record<string, unknown> | null);
    return {
      scope: { label: copy!.scopeLabel, items, random, total: plan.source === 'memories' ? null : total },
      index: Math.max(0, items.findIndex((m) => m.id === s.item.id)),
      shuffle: true,
    };
  };
  const play = () => { if (!slide) return; const v = scopeFor(slide); openViewer(v.scope, v.index, { play: true, shuffle: v.shuffle }); };
  const openThis = () => { if (!slide) return; const v = scopeFor(slide); openViewer(v.scope, v.index, { originEl: imgRefs.current[idx] ?? null }); };

  const interactiveProps = {
    onPointerEnter: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHover(true); },
    onPointerLeave: (e: React.PointerEvent) => { if (e.pointerType === 'mouse') setHover(false); },
    onFocus: () => setFocusIn(true),
    onBlur: (e: React.FocusEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false); },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1); }
    },
    onPointerDown: (e: React.PointerEvent) => { if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: React.PointerEvent) => {
      const s = swipe.current; swipe.current = null;
      if (!s) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(idx + (dx < 0 ? 1 : -1));
    },
  };

  if (loading && !slide) {
    return (
      <div className="lv-page-inset pt-6">
        <div aria-hidden className="mx-auto h-[380px] max-w-[1640px] animate-pulse rounded-[var(--r3)] border border-line bg-surface" />
      </div>
    );
  }

  if (!loading && (error || !slide)) {
    const empty = plan.source === 'favorites'
      ? { h: '还没有收藏的照片', p: '在照片上点爱心，或收藏一个文件夹，首页就会从中随机挑选。也可以切换其他轮播内容。' }
      : { h: '还没有可以展示的照片', p: '管理员添加媒体库并完成扫描后，这里会轮播你的照片。' };
    return (
      <div className="lv-page-inset pt-6">
        <section aria-label="首页轮播" className="lv-panel mx-auto grid min-h-[300px] max-w-[1640px] place-items-center px-6 py-10 text-center">
          <div className="max-w-md">
            <h1 className="m-0 text-[22px] font-semibold text-fg">{error ? '轮播照片没有加载出来' : empty.h}</h1>
            <p className="mt-2 text-sm text-muted">{error ? `${error instanceof Error ? error.message : '网络或服务器暂时不可用'}。检查网络后重试。` : empty.p}</p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              {error ? (
                <button type="button" onClick={data.retry} className="inline-flex h-9 items-center rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-fg">
                  重新加载
                </button>
              ) : null}
              <HeroSourceControl label={label} open={popOpen} setOpen={setPopOpen} onReroll={data.reroll} />
            </div>
          </div>
        </section>
      </div>
    );
  }

  const dp = slide ? dateParts(slide.item.takenAt) : null;
  const dateStamp = dp ? `${dp.y}.${String(dp.m).padStart(2, '0')}.${String(dp.d).padStart(2, '0')}` : '';

  const segBar = n > 1 && (
    <div aria-hidden className="flex gap-1.5">
      {slides.map((s, i) => (
        <button
          key={s.item.id}
          type="button"
          tabIndex={-1}
          aria-label={`切换到第 ${i + 1} 帧`}
          onClick={() => go(i)}
          className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-line-2"
        >
          {i < idx && <b className="absolute inset-0 bg-accent" />}
          {i === idx && (auto
            ? <b key={tick} className="luvia-hero-seg absolute inset-y-0 left-0 bg-accent" style={{ ['--seg-ms' as string]: `${HERO_INTERVAL_MS}ms` }} onAnimationEnd={() => go(idx + 1)} />
            : <b className="absolute inset-0 bg-accent" />)}
        </button>
      ))}
    </div>
  );

  /* ========== 皮肤 A（美术馆画册）：期刊开篇（Editorial Spread） ========== */
  if (isMono) {
    return (
      <section
        aria-roledescription="轮播"
        aria-label="首页轮播"
        className={cn('lv-page-inset lv-hero-monograph', paused && 'luvia-hero-paused')}
        {...interactiveProps}
      >
        <div className="flex flex-col justify-between gap-6 py-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 font-mono text-[11px] tracking-[0.16em] text-accent uppercase">
              <span aria-hidden className="inline-block h-px w-6 bg-accent" />
              ARCHIVE ISSUE
            </div>
            <HeroSourceControl label={label} open={popOpen} setOpen={setPopOpen} onReroll={data.reroll} />
          </div>

          {slide && copy && (
            <div aria-live={auto && !paused ? 'off' : 'polite'}>
              <div className="font-serif text-[clamp(70px,8vw,118px)] leading-[0.86] tracking-[-0.025em] text-fg italic">
                {dp?.y}
              </div>
              <h1 className="mt-4 mb-2 font-serif text-[clamp(26px,2.8vw,38px)] leading-[1.2] font-normal text-balance text-fg">
                {copy.title}
              </h1>
              <p className="m-0 text-[13.5px] leading-relaxed text-muted">{copy.subtitle}</p>
              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={play}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-[18px] text-[13.5px] font-medium text-accent-fg hover:brightness-105"
                >
                  <Play className="size-3.5 fill-current" strokeWidth={0} />{copy.playLabel}
                </button>
                <button
                  type="button"
                  onClick={openThis}
                  className="inline-flex h-10 items-center rounded-full border border-line-2 px-[18px] text-[13.5px] font-medium text-fg-2 hover:bg-accent-soft hover:text-fg"
                >
                  打开这张
                </button>
                {n > 1 && (
                  <div className="ml-auto flex gap-1.5">
                    <button type="button" aria-label="上一张" onClick={() => go(idx - 1)} className="grid size-9 place-items-center rounded-full border border-line-2 text-fg-2 hover:bg-accent-soft hover:text-fg">
                      <ChevronLeft className="size-4" />
                    </button>
                    <button type="button" aria-label="下一张" onClick={() => go(idx + 1)} className="grid size-9 place-items-center rounded-full border border-line-2 text-fg-2 hover:bg-accent-soft hover:text-fg">
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {segBar}
        </div>

        <div className="lv-hero-mono-frame">
          <div
            role="button"
            tabIndex={0}
            aria-label={slide ? `打开 ${slide.item.name}` : '打开照片'}
            onClick={openThis}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThis(); } }}
            className="relative aspect-[16/10] w-full cursor-pointer overflow-hidden rounded-[2px] bg-sunken"
          >
            {slides.map((s, i) => {
              const on = i === idx;
              const ph = thumbhashUrl(s.item);
              return (
                <div
                  key={s.item.id}
                  aria-hidden={!on}
                  className={cn('absolute inset-0 bg-cover bg-center transition-opacity duration-[900ms]', on ? 'opacity-100' : 'opacity-0')}
                  style={{ backgroundImage: ph ? `url(${ph})` : undefined }}
                >
                  {(seen.has(i) || on) && canThumb(s.item) && (
                    <img
                      ref={(el) => { imgRefs.current[i] = el; }}
                      src={mediaUrls.thumb(s.item.id, 'l', s.item.thumbVersion)}
                      alt={on ? s.item.name : ''}
                      draggable={false}
                      decoding="async"
                      className={cn('absolute inset-[-3%] h-[106%] w-[106%] max-w-none object-cover', on && !reduce && 'luvia-hero-kb')}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {slide && (
            <div className="flex items-center justify-between gap-3 pt-3 font-mono text-[11px] text-muted">
              <span className="truncate">FIG. {String(idx + 1).padStart(2, '0')} · {dateStamp} · {slide.item.name}</span>
              <span className="shrink-0">{String(idx + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}</span>
            </div>
          )}
        </div>
      </section>
    );
  }

  /* ========== 皮肤 B（液态光场 · 默认）：悬浮光学景深舞台 ========== */
  const bgUrl = slide && canThumb(slide.item) ? mediaUrls.thumb(slide.item.id, 'm', slide.item.thumbVersion) : undefined;
  const bgPlaceholder = slide ? thumbhashUrl(slide.item) : undefined;
  const backdropBg = [bgUrl && `url("${bgUrl}")`, bgPlaceholder && `url("${bgPlaceholder}")`].filter(Boolean).join(', ');

  return (
    <div className="lv-page-inset lv-hero-cinema-wrap">
      <section
        aria-roledescription="轮播"
        aria-label="首页轮播"
        className={cn('lv-hero-cinema', paused && 'luvia-hero-paused')}
        {...interactiveProps}
      >
        <div
          aria-hidden
          className="lv-hero-cinema-bg"
          style={{ backgroundImage: backdropBg || undefined }}
        />
        <div aria-hidden className="lv-hero-cinema-scrim" />

        {/* 左侧信息与控制 */}
        <div className="relative z-[3] flex flex-col justify-between gap-5 text-fg">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-2 text-[12px] font-medium text-fg-2">
              <span aria-hidden className="size-[7px] rounded-full bg-accent shadow-[0_0_12px_var(--accent)]" />
              回忆 · ON THIS DAY
            </span>
            <HeroSourceControl label={label} open={popOpen} setOpen={setPopOpen} onReroll={data.reroll} className="ml-auto" />
          </div>

          {slide && copy && (
            <div aria-live={auto && !paused ? 'off' : 'polite'}>
              <div className="font-sans text-[clamp(62px,6.2vw,90px)] leading-[0.88] font-extralight tracking-[-0.045em] text-fg">
                {dp?.y}
              </div>
              <h1 className="mt-2.5 mb-1.5 text-[clamp(23px,2.3vw,31px)] leading-[1.22] font-medium tracking-[-0.022em] text-balance text-fg">
                {copy.title}
              </h1>
              <p className="m-0 text-[13.5px] leading-relaxed text-fg-2">{copy.subtitle}</p>
              <div className="mt-5 flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={play}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-[18px] text-[13.5px] font-semibold text-accent-fg shadow-[0_10px_24px_-8px_color-mix(in_srgb,var(--accent)_65%,transparent)] hover:brightness-105"
                >
                  <Play className="size-3.5 fill-current" strokeWidth={0} />{copy.playLabel}
                </button>
                <button
                  type="button"
                  onClick={openThis}
                  className="inline-flex h-10 items-center rounded-full border border-line-2 bg-surface/75 px-[18px] text-[13.5px] font-medium text-fg backdrop-blur-md hover:bg-accent-soft"
                >
                  打开这张
                </button>
                {n > 1 && (
                  <div className="ml-auto flex gap-1.5">
                    <button
                      type="button"
                      aria-label="上一张"
                      onClick={() => go(idx - 1)}
                      className="grid size-9 place-items-center rounded-full border border-line-2 bg-surface/70 text-fg-2 backdrop-blur-md hover:bg-accent-soft hover:text-fg"
                    >
                      <ChevronLeft className="size-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="下一张"
                      onClick={() => go(idx + 1)}
                      className="grid size-9 place-items-center rounded-full border border-line-2 bg-surface/70 text-fg-2 backdrop-blur-md hover:bg-accent-soft hover:text-fg"
                    >
                      <ChevronRight className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {segBar}
        </div>

        {/* 右侧受控尺寸主画框（520×330）+ 无遮挡下一帧伴影预告条 */}
        <div className="lv-hero-optical-stage">
          <div
            role="button"
            tabIndex={0}
            aria-label={slide ? `打开 ${slide.item.name}` : '打开照片'}
            onClick={openThis}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openThis(); } }}
            className="lv-hero-optical-card"
          >
            {slides.map((s, i) => {
              const on = i === idx;
              const ph = thumbhashUrl(s.item);
              return (
                <div
                  key={s.item.id}
                  aria-hidden={!on}
                  className={cn('absolute inset-0 bg-cover bg-center transition-opacity duration-[900ms]', on ? 'opacity-100' : 'opacity-0')}
                  style={{ backgroundImage: ph ? `url(${ph})` : undefined }}
                >
                  {(seen.has(i) || on) && canThumb(s.item) && (
                    <img
                      ref={(el) => { imgRefs.current[i] = el; }}
                      src={mediaUrls.thumb(s.item.id, 'l', s.item.thumbVersion)}
                      alt={on ? s.item.name : ''}
                      draggable={false}
                      decoding="async"
                      className={cn('absolute inset-[-3%] h-[106%] w-[106%] max-w-none object-cover', on && !reduce && 'luvia-hero-kb')}
                    />
                  )}
                </div>
              );
            })}
            {slide && (
              <div className="pointer-events-none absolute right-3.5 bottom-3.5 left-3.5 z-[4] flex items-center justify-between gap-2">
                <span className="inline-flex max-w-[78%] items-center gap-2 truncate rounded-full border border-white/16 bg-black/52 px-3 py-1 font-mono text-[11px] text-white/92 backdrop-blur-md">
                  <span className="truncate">{dateStamp} · {slide.item.name}</span>
                </span>
                {n > 1 && (
                  <span className="shrink-0 rounded-full border border-white/16 bg-black/48 px-2.5 py-1 font-mono text-[10.5px] text-white/85 backdrop-blur-md">
                    {idx + 1} / {n}
                  </span>
                )}
              </div>
            )}
          </div>

          {nextSlide && (
            <button
              type="button"
              aria-label={`切换到下一帧：${nextSlide.item.name}`}
              title={`下一帧：${nextSlide.item.name}`}
              onClick={() => go(idx + 1)}
              className="lv-hero-optical-peek"
              style={{
                backgroundImage: thumbhashUrl(nextSlide.item) ? `url(${thumbhashUrl(nextSlide.item)})` : undefined,
                backgroundSize: 'cover',
              }}
            >
              {canThumb(nextSlide.item) && (
                <img
                  src={mediaUrls.thumb(nextSlide.item.id, 'm', nextSlide.item.thumbVersion)}
                  alt=""
                  draggable={false}
                  decoding="async"
                  className="size-full object-cover"
                />
              )}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(transparent,rgb(0_0_0/0.68))] px-2 py-2.5 text-left font-mono text-[10px] text-white/90">
                NEXT →
              </span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
