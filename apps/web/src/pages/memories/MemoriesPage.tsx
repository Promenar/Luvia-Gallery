import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mediaUrls, type MediaItem, type Memories } from '@luvia/contracts';
import { q } from '@/lib/query';
import { aspectOf } from '@/components/media/justify';
import { useElementWidth, useRowHeight } from '@/components/media/MediaGrid';
import { canThumb, Thumb, thumbhashUrl } from '@/components/media/Thumb';
import { openViewer } from '@/stores/viewer';
import { setDynamicFrom } from '@/theme/ThemeProvider';
import { Hero } from './Hero';
import { useHeroData, useLibraryNames } from './hooks';
import { folderLabel } from './heroSource';
import { ShuffleWall } from './ShuffleWall';

function Section({ index, title, note, children }: { index: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="lv-page-inset mx-auto mt-[36px] max-w-[1640px]">
      <div className="lv-sec-head">
        <span className="lv-sec-num" aria-hidden>{index}</span>
        <h2 className="lv-sec-title">{title}</h2>
        {note && <span className="text-[13px] font-normal text-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** 每年打开首页时独立抽选封面，点击从该项开始浏览。 */
function OnThisDayCard({ group: { year, count, items }, libNames }: {
  group: Memories['onThisDay'][number];
  libNames: ReadonlyMap<string, string>;
}) {
  const [sample] = useState(Math.random);
  const candidates = items.filter(canThumb);
  const cover = candidates[Math.floor(sample * candidates.length)] ?? items[0];
  if (!cover) return null;
  const ph = thumbhashUrl(cover);
  const place = folderLabel(cover.folder, libNames);
  return (
    <button
      type="button"
      aria-label={`${year} 年的这几天，${place}，共 ${count} 项`}
      onClick={(e) => openViewer({ label: `${year} 年的回忆`, items }, items.indexOf(cover), { originEl: e.currentTarget })}
      onMouseEnter={() => setDynamicFrom(cover)}
      onFocus={() => setDynamicFrom(cover)}
      className="group/mc lv-otd-card lv-spotlight-item cursor-pointer text-left"
    >
      <div
        className="lv-otd-thumb bg-cover bg-center"
        style={{ backgroundImage: ph ? `url(${ph})` : undefined }}
      >
        {canThumb(cover) && (
          <img
            src={mediaUrls.thumb(cover.id, 'm', cover.thumbVersion)}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            className="size-full object-cover transition-transform duration-500 ease-[var(--ease-cinema)] group-hover/mc:scale-105"
          />
        )}
      </div>
      <div className="lv-otd-meta">
        <span className="lv-otd-year">{year}</span>
        <span className="lv-otd-place truncate">{place} · {count.toLocaleString('zh-CN')} 项</span>
      </div>
    </button>
  );
}

function OnThisDay({ data }: { data: Memories['onThisDay'] }) {
  const libNames = useLibraryNames();
  return (
    <div className="lv-spotlight-group grid auto-cols-[224px] grid-flow-col gap-4 overflow-x-auto px-0.5 pt-1 pb-3 [scrollbar-width:thin] max-md:auto-cols-[156px] max-md:gap-3">
      {data.map((group) => <OnThisDayCard key={group.year} group={group} libNames={libNames} />)}
    </div>
  );
}

/** 一行可横向滚动的缩略图。 */
function Strip({ items, label }: { items: MediaItem[]; label: string }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const h = useRowHeight(width || 1000);
  return (
    <div ref={ref} className="flex gap-1.5 overflow-x-auto pb-2.5 [scrollbar-width:thin]">
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

function CardsSkeleton() {
  return (
    <div aria-hidden className="grid auto-cols-[224px] grid-flow-col gap-4 overflow-hidden max-md:auto-cols-[156px]">
      {Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[3/4] animate-pulse rounded-[var(--r3)] bg-sunken" />)}
    </div>
  );
}

/** 首页（回忆）：双皮肤回忆舞台、那年今日、最近添加、随便看看。 */
export default function MemoriesPage() {
  const hero = useHeroData();
  const memQ = useQuery(q('memories'));
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const today = new Date();
  const mem = memQ.data;

  return (
    <div ref={setScrollElement} className="h-full overflow-x-hidden overflow-y-auto">
      <div className="pb-24">
        <Hero data={hero} />

        <Section index="01" title="那年今日" note={`每年的 ${today.getMonth() + 1} 月 ${today.getDate()} 日前后`}>
          {memQ.isPending ? <CardsSkeleton /> : memQ.isError ? (
            <p className="m-0 text-sm text-muted">
              回忆没有加载出来：{memQ.error.message}。
              <button type="button" onClick={() => void memQ.refetch()} className="ml-1 font-semibold text-accent underline-offset-4 hover:underline">重新加载</button>
            </p>
          ) : mem && mem.onThisDay.length > 0 ? <OnThisDay data={mem.onThisDay} /> : (
            <div className="rounded-[var(--r3)] border border-dashed border-line-2 bg-surface/50 px-5 py-8 text-center">
              <p className="m-0 text-[15px] font-semibold text-fg-2">往年的今天还没有照片</p>
              <p className="mx-auto mt-1.5 mb-0 max-w-md text-[13px] text-muted">媒体库里有往年这几天拍的照片时，这里会每年显示一张。</p>
            </div>
          )}
        </Section>

        {mem && mem.recentlyAdded.length > 0 && (
          <Section index="02" title="最近添加" note={`最新加入媒体库的 ${mem.recentlyAdded.length} 项`}>
            <Strip items={mem.recentlyAdded} label="最近添加" />
          </Section>
        )}

        <ShuffleWall scrollElement={scrollElement} />
      </div>
    </div>
  );
}
