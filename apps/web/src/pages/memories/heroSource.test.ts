import { describe, expect, it } from 'vitest';
import type { MediaItem, Memories } from '@luvia/contracts';
import {
  ancestorsOf, buildMemorySlides, dateParts, fallbackNotice, folderLabel, heroCopy, HERO_RANDOM_COUNT,
  pickHeroSlides, resolveHeroPlan, sourceLabel,
} from './heroSource';

let n = 0;
function media(p: Partial<MediaItem> = {}): MediaItem {
  n++;
  return {
    id: `m${n}`, name: `IMG_${n}.jpg`, folder: 'photos/2021/大理', mediaType: 'image', mime: 'image/jpeg', size: 1,
    width: 4032, height: 3024, durationSec: null, takenAt: '2021-11-03T10:00:00+08:00', takenAtSource: 'metadata',
    modifiedAt: 0, favorite: false, thumbhash: null, thumbVersion: 1, hasLocation: false, playability: null, hasPreview: false,
    ...p,
  };
}
const portrait = (p: Partial<MediaItem> = {}) => media({ width: 3024, height: 4032, ...p });

describe('resolveHeroPlan', () => {
  it('memories 不走随机接口', () => {
    const p = resolveHeroPlan({ heroSource: 'memories', heroFolder: null }, 'unset');
    expect(p).toMatchObject({ source: 'memories', random: null, fallback: null, pending: false });
  });

  it('favorites 带 favorite 与 favoriteFolders', () => {
    const p = resolveHeroPlan({ heroSource: 'favorites', heroFolder: 'photos/x' }, 'ok');
    expect(p.source).toBe('favorites');
    expect(p.random).toEqual({ count: HERO_RANDOM_COUNT, favorite: true, favoriteFolders: true });
    expect(p.countQuery).toEqual({ scope: 'favorites' });
  });

  it('library 不带筛选', () => {
    const p = resolveHeroPlan({ heroSource: 'library', heroFolder: null }, 'unset');
    expect(p.random).toEqual({ count: HERO_RANDOM_COUNT });
    expect(p.fallback).toBeNull();
  });

  it('folder 可用时按 under（含子孙）抽取', () => {
    const p = resolveHeroPlan({ heroSource: 'folder', heroFolder: 'photos/2023/冰岛环岛' }, 'ok', true);
    expect(p).toMatchObject({ source: 'folder', folder: 'photos/2023/冰岛环岛', fallback: null, pending: false });
    expect(p.random).toEqual({ count: HERO_RANDOM_COUNT, under: 'photos/2023/冰岛环岛' });
    expect(p.countQuery).toEqual({ under: 'photos/2023/冰岛环岛' });
  });

  it('folder 仍在确认时标记 pending，不回退', () => {
    const p = resolveHeroPlan({ heroSource: 'folder', heroFolder: 'photos/a' }, 'pending');
    expect(p).toMatchObject({ source: 'folder', pending: true, fallback: null });
  });

  it('folder 抽样结果未知时保持 folder', () => {
    expect(resolveHeroPlan({ heroSource: 'folder', heroFolder: 'photos/a' }, 'ok').source).toBe('folder');
  });

  it.each([
    ['未选择文件夹', { heroSource: 'folder' as const, heroFolder: null }, 'ok' as const, undefined, 'folder-unset'],
    ['文件夹不存在', { heroSource: 'folder' as const, heroFolder: 'gone/x' }, 'missing' as const, undefined, 'folder-missing'],
    ['文件夹为空', { heroSource: 'folder' as const, heroFolder: 'photos/empty' }, 'ok' as const, false, 'folder-empty'],
  ])('%s时回退到整个媒体库', (_n, home, status, has, reason) => {
    const p = resolveHeroPlan(home, status, has);
    expect(p).toMatchObject({ requested: 'folder', source: 'library', fallback: reason, folder: null, pending: false });
    expect(p.random).toEqual({ count: HERO_RANDOM_COUNT });
  });
});

describe('pickHeroSlides', () => {
  it('只取横向照片', () => {
    const a = media(), b = portrait(), c = media({ mediaType: 'video' }), d = media({ width: 3000, height: 3000 });
    expect(pickHeroSlides([a, b, c, d]).map((m) => m.id)).toEqual([a.id]);
  });
  it('最多 max 张', () => {
    expect(pickHeroSlides(Array.from({ length: 10 }, () => media()), 6)).toHaveLength(6);
  });
  it('没有横图时退到任意照片，再退到视频', () => {
    const p = portrait();
    expect(pickHeroSlides([p]).map((m) => m.id)).toEqual([p.id]);
    const v = media({ mediaType: 'video' });
    expect(pickHeroSlides([v]).map((m) => m.id)).toEqual([v.id]);
    expect(pickHeroSlides([])).toEqual([]);
  });
});

describe('buildMemorySlides', () => {
  const mem = (onThisDay: Memories['onThisDay'], shuffle: MediaItem[] = []): Memories => ({ onThisDay, recentlyAdded: [], shuffle });

  it('每年一张横图，按接口顺序', () => {
    const y24 = [portrait(), media({ takenAt: '2024-11-04T09:00:00+08:00' })];
    const y21 = [media(), media(), media()];
    const y19 = [media({ takenAt: '2019-11-01T09:00:00+08:00' }), media()];
    const { slides, fallback } = buildMemorySlides(mem([
      { year: 2024, count: 2, items: y24 }, { year: 2021, count: 30, items: y21 }, { year: 2019, count: 2, items: y19 },
    ]));
    expect(fallback).toBeNull();
    expect(slides.map((s) => s.item.id)).toEqual([y24[1]!.id, y21[0]!.id, y19[0]!.id]);
    expect(slides[1]!.group).toMatchObject({ year: 2021, count: 30 });
  });

  it('不足 3 张时用同年其他横图补足', () => {
    const y21 = [media(), media(), media(), media()];
    const { slides } = buildMemorySlides(mem([{ year: 2021, count: 4, items: y21 }]));
    expect(slides.map((s) => s.item.id)).toEqual(y21.slice(0, 3).map((m) => m.id));
  });

  it('跳过只有竖图的年份', () => {
    const { slides } = buildMemorySlides(mem([{ year: 2022, count: 1, items: [portrait()] }, { year: 2020, count: 1, items: [media()] }]));
    expect(slides.map((s) => s.group?.year)).toEqual([2020]);
  });

  it('往年同期没有横图时改用 shuffle', () => {
    const s = [media(), portrait()];
    const r = buildMemorySlides(mem([{ year: 2022, count: 1, items: [portrait()] }], s));
    expect(r.fallback).toBe('memories-empty');
    expect(r.slides.map((x) => x.item.id)).toEqual([s[0]!.id]);
    expect(r.slides[0]!.group).toBeNull();
  });

  it('全都没有时为空', () => {
    expect(buildMemorySlides(mem([])).slides).toEqual([]);
  });
});

describe('文案', () => {
  const now = new Date('2026-11-05T12:00:00+08:00');
  it('dateParts 按字符串取本地日期，不受时区影响', () => {
    expect(dateParts('2019-12-31T23:30:00-08:00')).toEqual({ y: 2019, m: 12, d: 31 });
  });

  it('folderLabel：媒体库根用媒体库名', () => {
    expect(folderLabel('photos/2025/2025-09 上海')).toBe('2025-09 上海');
    expect(folderLabel('phone', new Map([['phone', '手机备份']]))).toBe('手机备份');
    expect(folderLabel('phone')).toBe('phone');
  });

  it('回忆：几年前、地点与当年数量', () => {
    const item = media({ takenAt: '2021-11-03T10:00:00+08:00' });
    const c = heroCopy({ item, group: { year: 2021, items: [item], count: 58 } }, { plan: { source: 'memories', fallback: null }, now });
    expect(c.title).toBe('5 年前的这几天，在大理');
    expect(c.subtitle).toBe('2021 年 11 月 3 日 · 那年这几天共 58 项');
    expect(c.playLabel).toBe('播放回忆');
    expect(c.scopeLabel).toBe('回忆「2021 年」');
  });

  it('回忆：一年前', () => {
    const item = media({ takenAt: '2025-11-03T10:00:00+08:00' });
    const c = heroCopy({ item, group: { year: 2025, items: [item], count: 1 } }, { plan: { source: 'memories', fallback: null }, now });
    expect(c.title.startsWith('一年前')).toBe(true);
  });

  it('文件夹：来源说明带文件夹名与总数', () => {
    const item = media({ folder: 'photos/2023/冰岛环岛/第一周', takenAt: '2023-07-14T10:00:00+00:00' });
    const c = heroCopy({ item, group: null }, { plan: { source: 'folder', fallback: null }, folderName: '冰岛环岛', total: 1290 });
    expect(c.title).toBe('第一周，2023 年 7 月');
    expect(c.subtitle).toBe('2023 年 7 月 14 日 · 随机来自文件夹「冰岛环岛」，共 1,290 项');
    expect(c.playLabel).toBe('随机播放这个文件夹');
    expect(c.scopeLabel).toBe('文件夹「冰岛环岛」');
  });

  it('收藏与媒体库；总数未知时不显示', () => {
    const item = media();
    expect(heroCopy({ item, group: null }, { plan: { source: 'favorites', fallback: null }, total: null }).subtitle).toBe('2021 年 11 月 3 日 · 随机来自你的收藏');
    const lib = heroCopy({ item, group: null }, { plan: { source: 'library', fallback: 'folder-missing' }, total: 3 });
    expect(lib.playLabel).toBe('随机播放媒体库');
    expect(lib.subtitle).toContain('随机来自整个媒体库，共 3 项');
  });

  it('回退提示与来源按钮', () => {
    expect(fallbackNotice('folder-missing', '旧目录')).toContain('文件夹「旧目录」已不存在');
    expect(fallbackNotice('folder-empty', 'x')).toContain('还没有可展示的照片');
    expect(fallbackNotice(null)).toBeNull();
    expect(fallbackNotice('memories-empty')).toBeNull();
    expect(sourceLabel({ source: 'library', requested: 'folder', fallback: 'folder-missing' })).toBe('整个媒体库（文件夹不可用）');
    expect(sourceLabel({ source: 'folder', requested: 'folder', fallback: null }, '上海')).toBe('文件夹「上海」');
    expect(sourceLabel({ source: 'favorites', requested: 'favorites', fallback: null })).toBe('收藏');
  });

  it('ancestorsOf', () => {
    expect(ancestorsOf('photos/2025/2025-09 上海')).toEqual(['photos', 'photos/2025']);
    expect(ancestorsOf('photos')).toEqual([]);
    expect(ancestorsOf(null)).toEqual([]);
  });
});
