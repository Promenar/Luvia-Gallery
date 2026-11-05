import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import type { AuthState, FolderListing, MediaDetail, TimelineBucket } from '@luvia/contracts';
import { cameraOf, childrenOf, db, folderOf, hostPathOf, isUnder, libraryOf, LIBRARIES, nameOf, pub, rng, svgFor, type MockMedia } from '../db';

const err = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status });
const authState = (): AuthState => ({ initialized: db.initialized, user: db.loggedIn ? db.user : null, siteName: db.siteName, version: '2.0.0-mock' });
const sec = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** 按 MediaListQuery / RandomQuery 的筛选语义过滤模拟媒体。 */
export function filterMedia(sp: URLSearchParams): MockMedia[] {
  const scope = sp.get('scope') ?? 'all';
  const q = sp.get('q')?.toLowerCase();
  const types = sp.get('types')?.split(',');
  const cameras = sp.get('cameras')?.split(',').filter(Boolean);
  const from = sp.get('from'), to = sp.get('to');
  const fav = sp.get('favorite');
  const favFolders = sp.get('favoriteFolders') === 'true' || sp.get('favoriteFolders') === '1';
  const under = sp.get('under');
  const folder = sp.get('folder');
  const recursive = sp.get('recursive') === 'true' || sp.get('recursive') === '1';
  const exclude = new Set(sp.get('exclude')?.split(',') ?? []);
  return db.media.filter((m) => {
    if (scope === 'folder' && folder && !(recursive ? isUnder(m.folder, folder) : m.folder === folder)) return false;
    if (scope !== 'folder' && folder && m.folder !== folder) return false; // random 的 folder 参数：仅直接子媒体
    if (scope === 'favorites' && !(m.favorite || [...db.favoriteFolders].some((f) => isUnder(m.folder, f)))) return false;
    if (fav === 'true' || fav === '1') {
      const viaFolder = favFolders && [...db.favoriteFolders].some((f) => isUnder(m.folder, f));
      if (!m.favorite && !viaFolder) return false;
    }
    if (q && !(m.name.toLowerCase().includes(q) || m.folder.toLowerCase().includes(q))) return false;
    if (types && !types.includes(m.mediaType)) return false;
    if (cameras?.length) {
      const c = cameraOf(m);
      if (!c || !cameras.includes(c.name)) return false;
    }
    if (from && sec(m.takenAt) < Number(from)) return false;
    if (to && sec(m.takenAt) >= Number(to)) return false;
    if (under && !isUnder(m.folder, under)) return false;
    if (exclude.has(m.id)) return false;
    return true;
  });
}

function sortMedia(list: MockMedia[], sort: string | null) {
  const out = [...list];
  if (sort === 'taken_asc') out.reverse();
  else if (sort === 'name_asc') out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
  else if (sort === 'size_desc') out.sort((a, b) => b.size - a.size);
  else if (sort === 'modified_desc') out.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return out;
}

const breadcrumbs = (path: string) => {
  const lib = libraryOf(path);
  const parts = path.split('/');
  return parts.map((_, i) => {
    const p = parts.slice(0, i + 1).join('/');
    return { path: p, name: i === 0 ? lib.name : nameOf(p) };
  });
};

const svgResponse = (m: MockMedia | undefined, edge: number) =>
  m ? new HttpResponse(svgFor(m, edge), { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=3600' } }) : err(404, 'NOT_FOUND', '媒体不存在');
const byId = (id: string | readonly string[] | undefined) => db.media.find((m) => m.id === id);

export const coreHandlers = [
  // 认证
  http.get('/api/v2/auth/state', () => HttpResponse.json(authState())),
  http.post('/api/v2/auth/login', async ({ request }) => {
    const body = (await request.json()) as { username: string; password: string };
    await delay(300);
    if (body.password.length < 4) return err(401, 'UNAUTHORIZED', '用户名或密码不正确');
    db.loggedIn = true;
    return HttpResponse.json({ user: db.user });
  }),
  http.post('/api/v2/auth/setup', async ({ request }) => {
    const body = (await request.json()) as { username: string; siteName?: string };
    db.initialized = true; db.loggedIn = true;
    db.user = { ...db.user, username: body.username };
    if (body.siteName) db.siteName = body.siteName;
    return HttpResponse.json({ user: db.user });
  }),
  http.post('/api/v2/auth/logout', () => { db.loggedIn = false; return new HttpResponse(null, { status: 204 }); }),
  http.patch('/api/v2/me/preferences', async ({ request }) => {
    const patch = (await request.json()) as Record<string, unknown>;
    const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
      const o = { ...a };
      for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge((o[k] as Record<string, unknown>) ?? {}, v as Record<string, unknown>) : v;
      return o;
    };
    db.user = { ...db.user, preferences: merge(db.user.preferences as never, patch) as never };
    return HttpResponse.json(db.user.preferences);
  }),

  // 媒体
  http.get('/api/v2/media', async ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const list = sortMedia(filterMedia(sp), sp.get('sort'));
    const offset = Number(sp.get('cursor') ?? 0);
    const limit = Number(sp.get('limit') ?? 120);
    await delay(120);
    return HttpResponse.json({
      items: list.slice(offset, offset + limit).map(pub),
      nextCursor: offset + limit < list.length ? String(offset + limit) : null,
      total: list.length,
    });
  }),
  http.get('/api/v2/media/buckets', ({ request }) => {
    const list = filterMedia(new URL(request.url).searchParams);
    const map = new Map<string, number>();
    for (const m of list) { const k = m.takenAt.slice(0, 7); map.set(k, (map.get(k) ?? 0) + 1); }
    const buckets: TimelineBucket[] = [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, count]) => {
      const [y, mo] = key.split('-').map(Number) as [number, number];
      return { key, count, start: Date.UTC(y, mo - 1, 1) / 1000, end: Date.UTC(y, mo, 1) / 1000 };
    });
    return HttpResponse.json({ buckets, total: list.length });
  }),
  http.get('/api/v2/media/facets', ({ request }) => {
    const list = filterMedia(new URL(request.url).searchParams);
    const years = new Map<number, number>();
    list.forEach((m) => years.set(Number(m.takenAt.slice(0, 4)), (years.get(Number(m.takenAt.slice(0, 4))) ?? 0) + 1));
    return HttpResponse.json({
      cameras: (() => {
        const counts = new Map<string, number>();
        list.forEach((m) => { const c = cameraOf(m); if (c) counts.set(c.name, (counts.get(c.name) ?? 0) + 1); });
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
      })(),
      years: [...years.entries()].sort((a, b) => b[0] - a[0]).map(([year, count]) => ({ year, count })),
      types: { image: list.filter((m) => m.mediaType === 'image').length, video: list.filter((m) => m.mediaType === 'video').length, audio: 0 },
    });
  }),
  http.get('/api/v2/media/random', ({ request }) => {
    const sp = new URL(request.url).searchParams;
    const list = filterMedia(sp);
    const count = Number(sp.get('count') ?? 24);
    const r = rng(Date.now() % 100000);
    const pick = [...list].sort(() => r() - 0.5).slice(0, count);
    return HttpResponse.json({ items: pick.map(pub) });
  }),
  http.put('/api/v2/media/favorite', async ({ request }) => {
    const { ids, favorite } = (await request.json()) as { ids: string[]; favorite: boolean };
    let updated = 0;
    for (const m of db.media) if (ids.includes(m.id)) { m.favorite = favorite; updated++; }
    return HttpResponse.json({ updated });
  }),
  http.get('/api/v2/memories', () => {
    const now = new Date('2026-11-05T00:00:00Z');
    const md = (d: Date) => d.getUTCMonth() * 31 + d.getUTCDate();
    const byYear = new Map<number, MockMedia[]>();
    for (const m of db.media) {
      const d = new Date(m.takenAt);
      if (d.getUTCFullYear() < now.getUTCFullYear() && Math.abs(md(d) - md(now)) <= 20) {
        const y = d.getUTCFullYear();
        byYear.set(y, [...(byYear.get(y) ?? []), m]);
      }
    }
    const r = rng(42);
    return HttpResponse.json({
      onThisDay: [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([year, items]) => ({ year, count: items.length, items: items.slice(0, 12).map(pub) })),
      recentlyAdded: [...db.media].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 24).map(pub),
      shuffle: [...db.media].filter((m) => m.mediaType === 'image' && (m.width ?? 0) > (m.height ?? 0)).sort(() => r() - 0.5).slice(0, 12).map(pub),
    });
  }),
  http.get('/api/v2/media/:id/thumb', ({ params, request }) => {
    const size = new URL(request.url).searchParams.get('size');
    return svgResponse(byId(params.id), size === 's' ? 320 : size === 'm' ? 900 : 1700);
  }),
  http.get('/api/v2/media/:id/display', ({ params }) => svgResponse(byId(params.id), 4200)),
  http.get('/api/v2/media/:id/original', ({ params }) => svgResponse(byId(params.id), 4200)),
  http.get('/api/v2/media/:id', ({ params }) => {
    const m = byId(params.id);
    if (!m) return err(404, 'NOT_FOUND', '媒体不存在');
    const detail: MediaDetail = {
      ...pub(m),
      exif: (() => {
        const c = cameraOf(m);
        if (!c) return null;
        return c.make === 'FUJIFILM'
          ? { make: c.make, model: c.model, lens: 'XF23mmF1.4 R LM WR', fNumber: 2.8, exposureTime: 1 / 250, iso: 400, focalLength: 23, focalLength35: 35, software: null }
          : { make: c.make, model: c.model, lens: 'iPhone 16 Pro back triple camera 6.765mm f/1.78', fNumber: 1.78, exposureTime: 1 / 120, iso: 64, focalLength: 6.765, focalLength35: 24, software: '18.1' };
      })(),
      location: m.hasLocation ? { lat: 30.25, lon: 120.16, altitude: null } : null,
      video: m.mediaType === 'video' ? { codec: 'h264', audioCodec: 'aac', container: 'mp4', fps: 30, bitrate: 8e6 } : null,
      libraryName: libraryOf(m.folder).name,
      breadcrumbs: breadcrumbs(m.folder),
      albumIds: db.albumIdsOf(m.id),
    };
    return HttpResponse.json(detail);
  }),

  // 文件夹
  http.get('/api/v2/folders', ({ request }) => {
    const path = new URL(request.url).searchParams.get('path');
    if (!path) {
      return HttpResponse.json({ path: '', breadcrumbs: [], folders: LIBRARIES.map((l) => folderOf(l.id)), directMediaCount: 0, hostPath: null, hostRoot: null, favorite: false } satisfies FolderListing);
    }
    const lib = libraryOf(path);
    if (!lib) return err(404, 'NOT_FOUND', '文件夹不存在');
    return HttpResponse.json({
      path, breadcrumbs: breadcrumbs(path), folders: childrenOf(path).map(folderOf),
      directMediaCount: db.media.filter((m) => m.folder === path).length,
      hostPath: hostPathOf(path), hostRoot: lib.hostRoot, favorite: db.favoriteFolders.has(path),
    } satisfies FolderListing);
  }),
  http.get('/api/v2/folders/tree', ({ request }) => {
    const path = new URL(request.url).searchParams.get('path') ?? '';
    const paths = path ? childrenOf(path) : LIBRARIES.map((l) => l.id);
    return HttpResponse.json({
      path,
      nodes: paths.map((p) => { const f = folderOf(p); return { path: p, name: f.name, childCount: f.childCount, mediaCount: f.mediaCount, favorite: f.favorite }; }),
    });
  }),
  http.put('/api/v2/folders/favorite', async ({ request }) => {
    const { path, favorite } = (await request.json()) as { path: string; favorite: boolean };
    if (favorite) db.favoriteFolders.add(path); else db.favoriteFolders.delete(path);
    return HttpResponse.json({ ok: true });
  }),
  http.get('/api/v2/folders/favorites', () => HttpResponse.json({ folders: [...db.favoriteFolders].map(folderOf) })),

  // SSE：模拟环境不推送事件，保持连接
  http.get('/api/v2/events', () => new HttpResponse(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'text/event-stream' } })),
];
