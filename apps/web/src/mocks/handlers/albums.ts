import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import type { Album, MediaFilter } from '@luvia/contracts';
import { db, isUnder, pub, type MockMedia } from '../db';
import { filterMedia } from './core';

/**
 * 相册模拟（内存存储，刷新页面即重置）。
 * 预置两个手动相册与两个智能相册，内容取自 mocks/db.ts 的媒体。
 * 本文件同时拦截 GET /api/v2/media?scope=album（core 未实现相册范围），因此需登记在 core 之前；
 * 其它 scope 的媒体列表请求不处理，交给 core。
 */
interface MockAlbum {
  id: string;
  name: string;
  description: string | null;
  kind: 'manual' | 'smart';
  filter: MediaFilter | null;
  ids: string[];
  coverId: string | null;
  createdAt: string;
  updatedAt: string;
}

const err = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status });

const idsUnder = (folder: string, n: number, step = 1) =>
  db.media.filter((m) => isUnder(m.folder, folder)).filter((_, i) => i % step === 0).slice(0, n).map((m) => m.id);

let seq = 0;
const albums: MockAlbum[] = [
  {
    id: 'a1', name: '冰岛环岛', description: '两周自驾，一号公路一圈。', kind: 'manual', filter: null,
    ids: idsUnder('photos/2023/冰岛环岛', 48, 2), coverId: null, createdAt: '2024-01-12T10:00:00.000Z', updatedAt: '2026-10-20T09:00:00.000Z',
  },
  {
    id: 'a2', name: '京都与岚山', description: null, kind: 'manual', filter: null,
    ids: idsUnder('photos/2019/京都', 30), coverId: null, createdAt: '2020-02-01T10:00:00.000Z', updatedAt: '2026-09-02T09:00:00.000Z',
  },
  {
    id: 'a3', name: '2025 年的视频', description: null, kind: 'smart',
    // 日期边界按浏览器本地时区的 0 点，与新建对话框的换算一致
    filter: { types: ['video'], from: new Date(2025, 0, 1).getTime() / 1000, to: new Date(2026, 0, 1).getTime() / 1000 },
    ids: [], coverId: null, createdAt: '2025-03-01T10:00:00.000Z', updatedAt: '2026-08-15T09:00:00.000Z',
  },
  {
    id: 'a4', name: '婚礼里收藏的', description: '婚礼那天标了心形的照片。', kind: 'smart',
    filter: { under: 'photos/2025/2025-04 婚礼', favorite: true },
    ids: [], coverId: null, createdAt: '2025-05-01T10:00:00.000Z', updatedAt: '2026-07-01T09:00:00.000Z',
  },
];

/** 把保存的筛选条件转成 MediaListQuery 风格的查询参数，复用 core 的筛选语义。 */
function filterParams(f: MediaFilter): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (v == null || v === '') continue;
    sp.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return sp;
}

function mediaOf(a: MockAlbum): MockMedia[] {
  if (a.kind === 'smart') return a.filter ? filterMedia(filterParams(a.filter)) : [...db.media];
  const set = new Set(a.ids);
  return db.media.filter((m) => set.has(m.id));
}

function toAlbum(a: MockAlbum): Album {
  const list = mediaOf(a); // db.media 按 takenAt 倒序
  const cover = (a.coverId && list.find((m) => m.id === a.coverId)) || list.find((m) => m.mediaType === 'image') || list[0];
  return {
    id: a.id, name: a.name, description: a.description, kind: a.kind, filter: a.filter, count: list.length,
    cover: cover ? pub(cover) : null,
    startAt: list.at(-1)?.takenAt ?? null, endAt: list[0]?.takenAt ?? null,
    createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

const find = (id: unknown) => albums.find((a) => a.id === id);
const touch = (a: MockAlbum) => { a.updatedAt = new Date().toISOString(); };

function sortMedia(list: MockMedia[], sort: string | null) {
  const out = [...list];
  if (sort === 'taken_asc') out.reverse();
  else if (sort === 'name_asc') out.sort((x, y) => x.name.localeCompare(y.name, 'zh-CN', { numeric: true }));
  else if (sort === 'size_desc') out.sort((x, y) => y.size - x.size);
  else if (sort === 'modified_desc') out.sort((x, y) => y.modifiedAt - x.modifiedAt);
  return out;
}

export const albumHandlers = [
  // 媒体列表的相册范围；其它 scope 返回 undefined，由 core 处理
  http.get('/api/v2/media', async ({ request }) => {
    const sp = new URL(request.url).searchParams;
    if (sp.get('scope') !== 'album') return undefined;
    const a = find(sp.get('albumId'));
    if (!a) return err(404, 'NOT_FOUND', '相册不存在或已被删除');
    const inAlbum = new Set(mediaOf(a).map((m) => m.id));
    const list = sortMedia(filterMedia(sp).filter((m) => inAlbum.has(m.id)), sp.get('sort'));
    const offset = Number(sp.get('cursor') ?? 0);
    const limit = Number(sp.get('limit') ?? 120);
    await delay(120);
    return HttpResponse.json({
      items: list.slice(offset, offset + limit).map(pub),
      nextCursor: offset + limit < list.length ? String(offset + limit) : null,
      total: list.length,
    });
  }),

  http.get('/api/v2/albums', async () => {
    await delay(100);
    const sorted = [...albums].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
    return HttpResponse.json({ albums: sorted.map(toAlbum) });
  }),
  http.post('/api/v2/albums', async ({ request }) => {
    const body = (await request.json()) as { name?: string; description?: string | null; kind?: 'manual' | 'smart'; filter?: MediaFilter | null; ids?: string[] };
    const name = body.name?.trim();
    if (!name) return err(400, 'VALIDATION', '相册名称不能为空');
    const kind = body.kind ?? 'manual';
    if (kind === 'smart' && !body.filter) return err(400, 'VALIDATION', '智能相册至少需要一个筛选条件');
    const now = new Date().toISOString();
    const a: MockAlbum = {
      id: `n${++seq}`, name, description: body.description ?? null, kind, filter: kind === 'smart' ? body.filter ?? null : null,
      ids: kind === 'manual' ? [...new Set(body.ids ?? [])] : [], coverId: null, createdAt: now, updatedAt: now,
    };
    albums.push(a);
    return HttpResponse.json(toAlbum(a));
  }),
  http.get('/api/v2/albums/:id', ({ params }) => {
    const a = find(params.id);
    return a ? HttpResponse.json(toAlbum(a)) : err(404, 'NOT_FOUND', '相册不存在或已被删除');
  }),
  http.patch('/api/v2/albums/:id', async ({ params, request }) => {
    const a = find(params.id);
    if (!a) return err(404, 'NOT_FOUND', '相册不存在或已被删除');
    const body = (await request.json()) as { name?: string; description?: string | null; filter?: MediaFilter | null; coverId?: string | null };
    if (body.name !== undefined) {
      if (!body.name.trim()) return err(400, 'VALIDATION', '相册名称不能为空');
      a.name = body.name.trim();
    }
    if (body.description !== undefined) a.description = body.description;
    if (body.filter !== undefined) {
      if (a.kind !== 'smart') return err(400, 'VALIDATION', '手动相册没有筛选条件');
      if (!body.filter) return err(400, 'VALIDATION', '智能相册至少需要一个筛选条件');
      a.filter = body.filter;
    }
    if (body.coverId !== undefined) a.coverId = body.coverId;
    touch(a);
    return HttpResponse.json(toAlbum(a));
  }),
  http.delete('/api/v2/albums/:id', ({ params }) => {
    const i = albums.findIndex((a) => a.id === params.id);
    if (i < 0) return err(404, 'NOT_FOUND', '相册不存在或已被删除');
    albums.splice(i, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post('/api/v2/albums/:id/items', async ({ params, request }) => {
    const a = find(params.id);
    if (!a) return err(404, 'NOT_FOUND', '相册不存在或已被删除');
    if (a.kind !== 'manual') return err(400, 'VALIDATION', '智能相册的内容由筛选条件决定，不能手动加入');
    const { ids } = (await request.json()) as { ids: string[] };
    const before = new Set(a.ids);
    const added = ids.filter((id) => !before.has(id) && db.media.some((m) => m.id === id));
    a.ids.push(...added);
    touch(a);
    return HttpResponse.json({ updated: added.length });
  }),
  http.delete('/api/v2/albums/:id/items', async ({ params, request }) => {
    const a = find(params.id);
    if (!a) return err(404, 'NOT_FOUND', '相册不存在或已被删除');
    if (a.kind !== 'manual') return err(400, 'VALIDATION', '智能相册的内容由筛选条件决定，不能手动移除');
    const { ids } = (await request.json()) as { ids: string[] };
    const remove = new Set(ids);
    const before = a.ids.length;
    a.ids = a.ids.filter((id) => !remove.has(id));
    touch(a);
    return HttpResponse.json({ updated: before - a.ids.length });
  }),
];
