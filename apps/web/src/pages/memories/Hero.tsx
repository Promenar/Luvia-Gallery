import { useEffect, useRef, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { Dialog } from '@base-ui/react/dialog';
import { ChevronDown, ChevronLeft, ChevronRight, GalleryHorizontalEnd, Play } from 'lucide-react';
import { toast } from 'sonner';
import { mediaUrls } from '@luvia/contracts';
import { cn } from '@/lib/cn';
import { thumbhashUrl } from '@/components/media/Thumb';
import { setDynamicFrom } from '@/theme/ThemeProvider';
import { openViewer, useViewer, type ViewerScope } from '@/stores/viewer';
import { useLibraryNames, useIsNarrow, useReducedMotion, type HeroData } from './hooks';
import { dateParts, fallbackNotice, heroCopy, HERO_INTERVAL_MS, sourceLabel, type HeroSlide } from './heroSource';
import { HeroSourcePicker } from './HeroSourcePicker';
import './memories.css';

const shownNotices = new Set<string>();

/** 右上角“轮播内容”按钮与弹层；手机宽度下改为底部抽屉。 */
function HeroSourceControl({ label, open, setOpen, onReroll, onImage = true }: {
  label: string; open: boolean; setOpen: (v: boolean) => void; onReroll: () => void;
  /** 按钮叠在照片上（白字半透明黑底）；false 时用主题色，适合空状态。 */
  onImage?: boolean;
}) {
  const narrow = useIsNarrow();
  const trigger = (
    <>
      <GalleryHorizontalEnd className="size-4 shrink-0" strokeWidth={1.7} />
      <span className="min-w-0 truncate">轮播内容：{label}</span>
      <ChevronDown className="size-3.5 shrink-0" />
    </>
  );
  const triggerCls = cn(
    'absolute top-[34px] right-7 z-[3] flex h-[34px] max-w-[calc(100%-56px)] items-center gap-2 rounded-full border pr-3 pl-[13px] text-[13px] backdrop-blur-md max-md:top-8 max-md:right-4 max-md:max-w-[calc(100%-32px)]',
    onImage ? 'border-white/16 bg-black/34 text-white hover:bg-black/52' : 'border-line-2 bg-raised text-fg hover:bg-accent-soft',
  );
  const title = <div className="px-2.5 pt-1.5 pb-1 text-[12.5px] font-semibold text-fg-2">首页轮播内容</div>;

  if (narrow) {
    return (
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger className={triggerCls}>{trigger}</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-40 bg-scrim transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
          <Dialog.Popup className="glass fixed inset-x-2 bottom-2 z-40 max-h-[78vh] overflow-auto rounded-[calc(var(--r3)+4px)] p-2 pb-[calc(10px+env(safe-area-inset-bottom))] text-fg shadow-[0_24px_60px_-20px_rgba(0,0,0,.6)] transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)] outline-none data-[ending-style]:translate-y-[calc(100%+20px)] data-[starting-style]:translate-y-[calc(100%+20px)]">
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
        <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={16} className="z-40">
          <Popover.Popup className="glass w-80 origin-[var(--transform-origin)] rounded-[calc(var(--r3)+2px)] p-2 text-fg shadow-[0_24px_60px_-20px_rgba(0,0,0,.6)] transition-[opacity,transform] duration-150 outline-none data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
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
    // 预载下一张
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

  const control = (onImage: boolean) => <HeroSourceControl label={label} open={popOpen} setOpen={setPopOpen} onReroll={data.reroll} onImage={onImage} />;
  const heroCls = 'relative h-[min(74vh,700px)] min-h-[420px] overflow-hidden max-md:h-[min(64dvh,540px)] max-md:min-h-[360px]';

  if (!loading && (error || !slide)) {
    const empty = plan.source === 'favorites'
      ? { h: '还没有收藏的照片', p: '在照片上点爱心，或收藏一个文件夹，首页就会从中随机挑选。也可以在右上角换一个轮播内容。' }
      : { h: '还没有可以展示的照片', p: '管理员添加媒体库并完成扫描后，这里会轮播你的照片。' };
    return (
      <section aria-label="首页轮播" className={cn(heroCls, 'grid place-items-center bg-sunken px-6 max-md:min-h-[320px]')}>
        <div className="max-w-md text-center">
          <h1 className="m-0 text-[22px] font-semibold text-fg">{error ? '轮播照片没有加载出来' : empty.h}</h1>
          <p className="mt-2 text-sm text-muted">{error ? `${error instanceof Error ? error.message : '网络或服务器暂时不可用'}。检查网络后重试。` : empty.p}</p>
          {error ? (
            <button type="button" onClick={data.retry} className="mt-5 inline-flex h-10 items-center rounded-full bg-accent px-[18px] text-[13.5px] font-semibold text-accent-fg">重新加载</button>
          ) : null}
        </div>
        {control(false)}
      </section>
    );
  }

  return (
    <section
      aria-roledescription="轮播"
      aria-label="首页轮播"
      className={cn(heroCls, 'bg-black', paused && 'luvia-hero-paused')}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(false); }}
      onFocus={() => setFocusIn(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusIn(false); }}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement) return;
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); go(idx + 1); }
      }}
      onPointerDown={(e) => { if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY }; }}
      onPointerUp={(e) => {
        const s = swipe.current; swipe.current = null;
        if (!s) return;
        const dx = e.clientX - s.x, dy = e.clientY - s.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(idx + (dx < 0 ? 1 : -1));
      }}
    >
      <div className="absolute inset-0">
        {slides.map((s, i) => {
          const on = i === idx;
          const ph = thumbhashUrl(s.item);
          return (
            <div
              key={s.item.id}
              aria-hidden={!on}
              className={cn('absolute inset-0 bg-cover bg-center transition-opacity duration-[1100ms]', on ? 'opacity-100' : 'opacity-0')}
              style={{ backgroundImage: ph ? `url(${ph})` : undefined }}
            >
              {(seen.has(i) || on) && s.item.thumbVersion > 0 && (
                <img
                  ref={(el) => { imgRefs.current[i] = el; }}
                  src={mediaUrls.thumb(s.item.id, 'l', s.item.thumbVersion)}
                  alt={on ? s.item.name : ''}
                  draggable={false}
                  decoding="async"
                  className={cn('absolute inset-[-4%] h-[108%] w-[108%] max-w-none object-cover', on && !reduce && 'luvia-hero-kb')}
                />
              )}
            </div>
          );
        })}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -bottom-px bg-[linear-gradient(90deg,rgba(0,0,0,.55),transparent_55%),linear-gradient(transparent_50%,var(--bg))]" />

      {n > 1 && (
        <div aria-hidden className="absolute top-[18px] right-7 left-7 z-[2] flex gap-1.5 max-md:right-4 max-md:left-4">
          {slides.map((s, i) => (
            <i key={s.item.id} className="relative h-[3px] flex-1 overflow-hidden rounded-[3px] bg-white/25">
              {i < idx && <b className="absolute inset-0 bg-white" />}
              {i === idx && (auto
                ? <b key={tick} className="luvia-hero-seg absolute inset-y-0 left-0 bg-white" style={{ ['--seg-ms' as string]: `${HERO_INTERVAL_MS}ms` }} onAnimationEnd={() => go(idx + 1)} />
                : <b className="absolute inset-0 bg-white" />)}
            </i>
          ))}
        </div>
      )}

      {slide && copy && (
        <div aria-live={auto && !paused ? 'off' : 'polite'} className="absolute bottom-[72px] left-11 z-[2] max-w-[620px] pr-6 text-white max-md:bottom-[52px] max-md:left-5 max-md:pr-5">
          <div className="font-display text-[clamp(112px,19vw,260px)] leading-[.76] font-extrabold tracking-[-.02em] text-white opacity-95 mix-blend-overlay">
            {dateParts(slide.item.takenAt).y}
          </div>
          <h1 className="mt-[18px] mb-1.5 text-[30px] leading-tight font-semibold tracking-[-.01em] text-balance max-md:text-[23px]">{copy.title}</h1>
          <p className="m-0 text-[15px] text-white/78 max-md:text-[13.5px]">{copy.subtitle}</p>
          <div className="mt-[22px] flex flex-wrap gap-2.5">
            <button type="button" onClick={play} className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-[18px] text-[13.5px] font-semibold text-accent-fg">
              <Play className="size-3.5 fill-current" strokeWidth={0} />{copy.playLabel}
            </button>
            <button type="button" onClick={openThis} className="inline-flex h-10 items-center rounded-full bg-white/14 px-[18px] text-[13.5px] font-semibold text-white backdrop-blur-md hover:bg-white/22">
              打开这张
            </button>
          </div>
        </div>
      )}

      {n > 1 && (
        <div className="absolute right-7 bottom-[72px] z-[2] flex gap-2 max-md:hidden">
          <button type="button" aria-label="上一张" onClick={() => go(idx - 1)} className="grid size-[42px] place-items-center rounded-full bg-white/14 text-white backdrop-blur-md hover:bg-white/24"><ChevronLeft className="size-5" /></button>
          <button type="button" aria-label="下一张" onClick={() => go(idx + 1)} className="grid size-[42px] place-items-center rounded-full bg-white/14 text-white backdrop-blur-md hover:bg-white/24"><ChevronRight className="size-5" /></button>
        </div>
      )}
      {control(true)}
    </section>
  );
}
