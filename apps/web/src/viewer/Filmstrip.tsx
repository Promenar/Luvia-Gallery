import type { MediaItem } from '@luvia/contracts';
import { thumbhashUrl } from '@/components/media/Thumb';
import { filmCount, filmWindow } from './sequence';
import { thumbS } from './Stage';

/** 底部胶片条（原型 .film）：以当前项为中心的一段缩略图，按浏览顺序排列。 */
export function Filmstrip({ items, order, pos, viewportW, onPick }: {
  items: readonly MediaItem[];
  order: readonly number[];
  pos: number;
  viewportW: number;
  onPick: (pos: number) => void;
}) {
  const [start, end] = filmWindow(pos, order.length, filmCount(viewportW));
  const cells: { p: number; m: MediaItem }[] = [];
  for (let p = start; p < end; p++) {
    const m = items[order[p]!];
    if (m) cells.push({ p, m });
  }
  return (
    <div className="lv-film" role="group" aria-label="胶片条">
      {cells.map(({ p, m }) => {
        const ph = thumbhashUrl(m);
        const s = thumbS(m);
        return (
          <button
            key={m.id}
            type="button"
            className={p === pos ? 'on' : undefined}
            aria-label={`第 ${p + 1} 项：${m.name}`}
            aria-current={p === pos ? 'true' : undefined}
            style={ph ? { backgroundImage: `url(${ph})` } : undefined}
            onClick={() => onPick(p)}
          >
            {s && <img src={s} alt="" loading="lazy" decoding="async" draggable={false} />}
          </button>
        );
      })}
    </div>
  );
}
