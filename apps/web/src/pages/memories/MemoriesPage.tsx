import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mediaUrls, type MediaItem, type Memories } from '@luvia/contracts';
import { q } from '@/lib/query';
import { aspectOf, justifyRows } from '@/components/media/justify';
import { useDimensionsVersion } from '@/lib/dimensions';
import { GRID_GAP, useElementWidth, useRowHeight } from '@/components/media/MediaGrid';
import { canThumb, Thumb, thumbhashUrl } from '@/components/media/Thumb';
import { openViewer } from '@/stores/viewer';
import { setDynamicFrom } from '@/theme/ThemeProvider';
import { Hero } from './Hero';
import { useHeroData, useLibraryNames } from './hooks';
import { folderLabel } from './heroSource';

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-[34px] px-11 max-md:px-4">
      <h2 className="m-0 mb-3.5 flex flex-wrap items-baseline gap-x-3 text-lg font-semibold">
        {title}{note && <span className="text-[13px] font-normal text-muted">{note}</span>}
      </h2>
      {children}
    </section>
  );
}

/** “那年今日”：每年一张卡片，点击用该年的媒体打开查看器。 */
function OnThisDay({ data }: { data: Memories['onThisDay'] }) {
  const libNames = useLibraryNames();
  return (
    <div className="grid auto-cols-[220px] grid-flow-col gap-3.5 overflow-x-auto pb-2 [scrollbar-width:thin] max-md:auto-cols-[150px] max-md:gap-2.5">
      {data.map((g) => {
        const cover = g.items.find((m) => m.mediaType === 'image') ?? g.items[0];
        if (!cover) return null;
        const ph = thumbhashUrl(cover);
        const place = folderLabel(cover.folder, libNames);
        return (
          <button
            key={g.year}
            type="button"
            aria-label={`${g.year} 年的这几天，${place}，共 ${g.count} 项`}
            onClick={(e) => openViewer({ label: `${g.year} 年的照片`, items: g.items }, 0, { originEl: e.currentTarget })}
            onMouseEnter={() => setDynamicFrom(cover)}
            onFocus={() => setDynamicFrom(cover)}
            className="group/mc relative aspect-[3/4] cursor-pointer overflow-hidden rounded-[var(--r3)] bg-sunken bg-cover text-left after:absolute after:inset-0 after:bg-[linear-gradient(transparent_40%,rgba(0,0,0,.7))]"
            style={{ backgroundImage: ph ? `url(${ph})` : undefined }}
          >
            {canThumb(cover) && (
              <img
                src={mediaUrls.thumb(cover.id, 'm', cover.thumbVersion)}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)] group-hover/mc:scale-105"
              />
            )}
            <span className="absolute bottom-9 left-3.5 z-[1] font-display text-[58px] leading-[.8] font-extrabold text-white max-md:text-[46px]">{g.year}</span>
            <span className="absolute right-3 bottom-[13px] left-3.5 z-[1] truncate text-[12.5px] text-white/85">{place} · {g.count.toLocaleString('zh-CN')} 项</span>
          </button>
        );
      })}
    </div>
  );
}

/** 一行可横向滚动的缩略图。 */
function Strip({ items, label }: { items: MediaItem[]; label: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const h = useRowHeight(width || 1000);
  return (
    <div ref={ref} className="flex gap-[3px] overflow-x-auto pb-2 [scrollbar-width:thin]">
      {items.map((m, i) => (
        <Thumb
          key={m.id}
          item={m}
          width={Math.round(aspectOf(m) * h)}
          height={h}
          className="shrink-0"
          onMouseEnter={() => setDynamicFrom(m)}
          onClick={(e) => openViewer({ label, items }, i, { originEl: e.currentTarget })}
        />
      ))}
    </div>
  );
}

/** 对齐行布局，最多 maxRows 行。 */
function Rows({ items, label, maxRows }: { items: MediaItem[]; label: string; maxRows: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const h = useRowHeight(width || 1000);
  const dims = useDimensionsVersion();
  const rows = useMemo(() => justifyRows(items, aspectOf, width, h, GRID_GAP).slice(0, maxRows), [items, width, h, maxRows, dims]);
  const shown = rows.flatMap((r) => r.cells.map((c) => c.item));
  return (
    <div ref={ref} className="flex flex-col" style={{ gap: GRID_GAP }}>
      {rows.map((r, ri) => (
        <div key={ri} className="flex" style={{ gap: GRID_GAP }}>
          {r.cells.map((c) => (
            <Thumb
              key={c.item.id}
              item={c.item}
              width={Math.floor(c.width)}
              height={Math.round(c.height)}
              onMouseEnter={() => setDynamicFrom(c.item)}
              onClick={(e) => openViewer({ label, items: shown }, shown.indexOf(c.item), { originEl: e.currentTarget })}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function CardsSkeleton() {
  return (
    <div aria-hidden className="grid auto-cols-[220px] grid-flow-col gap-3.5 overflow-hidden max-md:auto-cols-[150px]">
      {Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-[var(--r3)] bg-sunken" />)}
    </div>
  );
}

/** 首页（回忆）：大图轮播、那年今日、最近添加、随便看看。 */
export default function MemoriesPage() {
  const hero = useHeroData();
  const memQ = useQuery(q('memories'));
  const today = new Date();
  const mem = memQ.data;

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto">
      <div className="pb-20">
        <Hero data={hero} />

        <Section title="那年今日" note={`每年的 ${today.getMonth() + 1} 月 ${today.getDate()} 日前后`}>
          {memQ.isPending ? <CardsSkeleton /> : memQ.isError ? (
            <p className="m-0 text-sm text-muted">
              回忆没有加载出来：{memQ.error.message}。
              <button type="button" onClick={() => void memQ.refetch()} className="ml-1 font-semibold text-accent underline-offset-4 hover:underline">重新加载</button>
            </p>
          ) : mem && mem.onThisDay.length > 0 ? <OnThisDay data={mem.onThisDay} /> : (
            <div className="rounded-[var(--r3)] border border-dashed border-line-2 px-5 py-8 text-center">
              <p className="m-0 text-[15px] font-semibold text-fg-2">往年的今天还没有照片</p>
              <p className="mx-auto mt-1.5 mb-0 max-w-md text-[13px] text-muted">媒体库里有往年这几天拍的照片时，这里会每年显示一张。</p>
            </div>
          )}
        </Section>

        {mem && mem.recentlyAdded.length > 0 && (
          <Section title="最近添加" note={`最新加入媒体库的 ${mem.recentlyAdded.length} 项`}>
            <Strip items={mem.recentlyAdded} label="最近添加" />
          </Section>
        )}

        {mem && mem.shuffle.length > 0 && (
          <Section title="随便看看" note="从媒体库里随机挑一组">
            <Rows items={mem.shuffle} label="随便看看" maxRows={2} />
          </Section>
        )}
      </div>
    </div>
  );
}
