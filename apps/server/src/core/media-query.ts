import type Database from 'better-sqlite3';
import { randomInt } from 'node:crypto';
import type { z } from 'zod';
import { MediaFilter, MediaListQuery, RandomQuery, MediaItem } from '@luvia/contracts';
import { QueryExecutor } from './query-executor.ts';
import { rowIdRange } from './rowid-range.ts';

type Query = z.output<typeof MediaListQuery>;
type RandomFilter = z.output<typeof RandomQuery>;
type Context = { id: string; allowedPaths: string[] | null; ids?: string[] };
type Params = (string | number)[];
type FileRow = {
  rowid: number; id: string; folder: string; name: string; media_type: 'image' | 'video' | 'audio';
  mime: string; size: number; width: number | null; height: number | null; duration_sec: number | null;
  taken_at: number; taken_at_source: 'metadata' | 'filename' | 'mtime'; modified_at: number; favorite: number;
  thumbhash: string | null; thumb_version: number; thumb_ready: number; latitude: number | null; longitude: number | null;
  playability: 'direct' | 'transcode' | 'unsupported' | null; has_preview: number;
};
type Cursor = { sort: Query['sort']; value: number | string; id: string };

function prefixClause(column: string, prefix: string, params: Params): string {
  params.push(prefix, `${prefix}/`, `${prefix}0`);
  return `(${column} = ? OR (${column} >= ? AND ${column} < ?))`;
}
function allowedClause(paths: string[] | null, params: Params, column = 'f.folder'): string {
  if (paths === null) return '1';
  if (!paths.length) return '0';
  return `(${paths.map((prefix) => prefixClause(column, prefix, params)).join(' OR ')})`;
}
export function where(filter: Partial<Query> | RandomFilter, context: Context, db: Database.Database): { sql: string; params: Params } {
  const params: Params = [];
  const clauses = [allowedClause(context.allowedPaths, params), 'f.missing_at_ms IS NULL', 'EXISTS(SELECT 1 FROM libraries library WHERE library.id=f.library_id AND library.enabled=1)'];
  if (context.ids) { clauses.push('f.id IN (SELECT value FROM json_each(?))'); params.push(JSON.stringify(context.ids)); }
  if (filter.q) {
    if ([...filter.q].length < 3) {
      clauses.push("f.name LIKE ? ESCAPE '\\'");
      params.push(`${filter.q.replace(/[\\%_]/g, '\\$&')}%`);
    } else {
      clauses.push('f.rowid IN (SELECT rowid FROM files_fts WHERE files_fts MATCH ?)');
      params.push(`"${filter.q.replaceAll('"', '""')}"`);
    }
  }
  if (filter.types?.length) { clauses.push(`f.media_type IN (${filter.types.map(() => '?').join(',')})`); params.push(...filter.types); }
  const timeColumn = 'timeField' in filter && filter.timeField === 'modified' ? 'f.modified_at' : 'f.taken_at';
  if (filter.from !== undefined) { clauses.push(`${timeColumn} >= ?`); params.push(filter.from); }
  if (filter.to !== undefined) { clauses.push(`${timeColumn} < ?`); params.push(filter.to); }
  if (filter.cameras?.length) { clauses.push(`f.model IN (${filter.cameras.map(() => '?').join(',')})`); params.push(...filter.cameras); }
  if (filter.orientation) {
    clauses.push(filter.orientation === 'landscape' ? 'f.width > f.height' : filter.orientation === 'portrait' ? 'f.height > f.width' : 'f.width = f.height');
  }
  if (filter.hasLocation !== undefined) clauses.push(filter.hasLocation ? '(f.latitude IS NOT NULL AND f.longitude IS NOT NULL)' : '(f.latitude IS NULL OR f.longitude IS NULL)');
  if (filter.favorite === true || ('scope' in filter && filter.scope === 'favorites')) {
    const includeFolders = 'count' in filter ? filter.favoriteFolders === true : true;
    clauses.push(`(EXISTS (SELECT 1 FROM favorites fav WHERE fav.user_id=? AND fav.item_type='file' AND fav.item_id=f.id)${includeFolders ?
      " OR EXISTS (SELECT 1 FROM favorites fav WHERE fav.user_id=? AND fav.item_type='folder' AND (f.folder=fav.item_id OR (f.folder >= fav.item_id || '/' AND f.folder < fav.item_id || '0')))" : ''})`);
    params.push(context.id);
    if (includeFolders) params.push(context.id);
  }
  if (filter.favorite === false) { clauses.push("NOT EXISTS (SELECT 1 FROM favorites fav WHERE fav.user_id=? AND fav.item_type='file' AND fav.item_id=f.id)"); params.push(context.id); }
  if (filter.under) clauses.push(prefixClause('f.folder', filter.under, params));
  if ('count' in filter && filter.folder) { clauses.push('f.folder = ?'); params.push(filter.folder); }
  if ('count' in filter && filter.exclude?.length) { clauses.push(`f.id NOT IN (${filter.exclude.map(() => '?').join(',')})`); params.push(...filter.exclude); }
  if ('scope' in filter && filter.scope === 'folder') {
    if (!filter.folder) clauses.push('0');
    else if (filter.recursive) clauses.push(prefixClause('f.folder', filter.folder, params));
    else { clauses.push('f.folder = ?'); params.push(filter.folder); }
  }
  if ('scope' in filter && filter.scope === 'album') {
    if (!filter.albumId) clauses.push('0');
    else {
      const album = db.prepare('SELECT kind,filter FROM albums WHERE id=? AND user_id=?').get(filter.albumId, context.id) as { kind: string; filter: string | null } | undefined;
      if (!album) clauses.push('0');
      else if (album.kind === 'manual') {
        clauses.push('f.id IN (SELECT ai.file_id FROM album_items ai WHERE ai.album_id=?)'); params.push(filter.albumId);
      } else {
        const saved = MediaFilter.parse(album.filter ? JSON.parse(album.filter) : {});
        const smart = where(saved, context, db);
        clauses.push(`(${smart.sql})`); params.push(...smart.params);
      }
    }
  }
  return { sql: clauses.join(' AND '), params };
}
function item(row: FileRow): z.output<typeof MediaItem> {
  return {
    id: row.id, name: row.name, folder: row.folder, mediaType: row.media_type, mime: row.mime, size: row.size,
    width: row.width, height: row.height, durationSec: row.duration_sec,
    takenAt: new Date(row.taken_at * 1000).toISOString(), takenAtSource: row.taken_at_source,
    modifiedAt: row.modified_at, favorite: !!row.favorite, thumbhash: row.thumbhash, thumbVersion: row.thumb_ready ? row.thumb_version : 0,
    hasLocation: row.latitude !== null && row.longitude !== null, playability: row.playability, hasPreview: !!row.has_preview,
  };
}
const sorts = {
  taken_desc: { column: 'taken_at', direction: 'DESC', operator: '<' },
  taken_asc: { column: 'taken_at', direction: 'ASC', operator: '>' },
  modified_desc: { column: 'modified_at', direction: 'DESC', operator: '<' },
  size_desc: { column: 'size', direction: 'DESC', operator: '<' },
  name_asc: { column: 'name COLLATE NOCASE', direction: 'ASC', operator: '>' },
} as const;
const selection = `SELECT f.rowid, f.*, EXISTS(SELECT 1 FROM favorites fv WHERE fv.user_id=? AND fv.item_type='file' AND fv.item_id=f.id) AS favorite FROM files f`;
function parseCursor(value: string, sort: Query['sort']): Cursor {
  try {
    if (value.length > 2048) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString()) as Cursor;
    if (cursor.sort !== sort || typeof cursor.id !== 'string' || !cursor.id ||
      (sort === 'name_asc' ? typeof cursor.value !== 'string' : typeof cursor.value !== 'number' || !Number.isFinite(cursor.value))) throw new Error();
    return cursor;
  } catch { throw new Error('无效游标'); }
}
export class MediaReader {
  private cache = new Map<string, { version: string; expires: number; value: unknown }>();
  constructor(privateDb: Database.Database, executor = new QueryExecutor(privateDb)) { this.db = privateDb; this.executor = executor; }
  private db: Database.Database;
  private executor: QueryExecutor;

  one(id: string, context: Context) {
    if (context.ids && !context.ids.includes(id)) return null;
    const params: Params = [];
    const allowed = allowedClause(context.allowedPaths, params);
    const row = this.db.prepare(`${selection} WHERE f.id=? AND f.missing_at_ms IS NULL AND ${allowed} AND EXISTS(SELECT 1 FROM libraries library WHERE library.id=f.library_id AND library.enabled=1)`).get(context.id, id, ...params) as FileRow | undefined;
    return row ? item(row) : null;
  }

  page(filter: Query, context: Context) {
    const condition = where(filter, context, this.db);
    const order = sorts[filter.sort];
    const params: Params = [context.id, ...condition.params];
    let sql = `${selection} WHERE ${condition.sql}`;
    if (filter.cursor) {
      const c = parseCursor(filter.cursor, filter.sort);
      sql += ` AND (f.${order.column} ${order.operator} ? OR (f.${order.column} = ? AND f.id > ?))`;
      params.push(c.value, c.value, c.id);
    }
    const limit = filter.q && [...filter.q].length < 3 ? Math.min(filter.limit, 500) : filter.limit;
    sql += ` ORDER BY f.${order.column} ${order.direction}, f.id ASC LIMIT ?`;
    params.push(limit + 1);
    const rows = this.db.prepare(sql).all(...params) as FileRow[];
    const hasMore = rows.length > limit;
    if (hasMore) rows.pop();
    const last = rows.at(-1);
    const column = order.column.split(' ')[0] as keyof FileRow;
    const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ sort: filter.sort, value: last[column], id: last.id })).toString('base64url') : null;
    return { items: rows.map(item), nextCursor, total: null };
  }

  async buckets(filter: Query, context: Context) {
    const key = JSON.stringify(['buckets', filter, context]);
    const changes = this.db.prepare('SELECT total_changes() AS n').get() as { n: number };
    const version = `${this.db.pragma('data_version', { simple: true })}:${changes.n}`;
    const cached = this.cache.get(key);
    if (cached && cached.version === version && cached.expires > Date.now()) return cached.value;
    const condition = where(filter, context, this.db);
    const unfiltered = context.allowedPaths === null && !context.ids && (filter.timeField === 'modified' || !this.db.prepare('SELECT 1 FROM timeline_rebuild_state WHERE id=1').get()) && !this.db.prepare('SELECT 1 FROM libraries WHERE enabled=0 LIMIT 1').get() && filter.scope === 'all' && !filter.q && !filter.types?.length &&
      filter.from === undefined && filter.to === undefined && !filter.cameras?.length && !filter.orientation &&
      filter.hasLocation === undefined && filter.favorite === undefined && !filter.under;
    const modified = filter.timeField === 'modified';
    const rows = (unfiltered && !modified
      ? this.db.prepare('SELECT month AS key,count FROM timeline_counts ORDER BY month DESC').all()
      // 按修改时间且无筛选时只扫描未缺失文件的修改时间部分索引，不逐行检查媒体库与权限
      : unfiltered
        ? (await this.executor.run([{ sql: `SELECT strftime('%Y-%m', modified_at, 'unixepoch', 'localtime') AS key, count(*) AS count
          FROM files INDEXED BY files_present_modified WHERE missing_at_ms IS NULL GROUP BY key ORDER BY key DESC`, params: [] }]))[0]
        : (await this.executor.run([{ sql: `SELECT strftime('%Y-%m', ${modified ? 'f.modified_at' : 'f.taken_at'}, 'unixepoch', 'localtime') AS key, count(*) AS count
          FROM files f WHERE ${condition.sql} GROUP BY key ORDER BY key DESC`, params: condition.params }]))[0]) as { key: string; count: number }[];
    const buckets = rows.map(({ key, count }) => {
      const [year, month] = key.split('-').map(Number);
      return { key, count, start: Math.floor(new Date(year!, month! - 1, 1).getTime() / 1000), end: Math.floor(new Date(year!, month!, 1).getTime() / 1000) };
    });
    const value = { buckets, total: buckets.reduce((sum, bucket) => sum + bucket.count, 0) };
    if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { version, expires: Date.now() + 10_000, value });
    return value;
  }

  async facets(filter: Query, context: Context) {
    const condition = where(filter, context, this.db);
    const statements = [
      `SELECT f.model AS name,count(*) AS count FROM files f WHERE ${condition.sql} AND f.model IS NOT NULL AND f.model<>'' GROUP BY f.model ORDER BY count DESC,name COLLATE NOCASE`,
      `SELECT CAST(strftime('%Y',f.taken_at,'unixepoch','localtime') AS INTEGER) AS year,count(*) AS count FROM files f WHERE ${condition.sql} GROUP BY year HAVING year IS NOT NULL ORDER BY year DESC`,
      `SELECT f.media_type AS type,count(*) AS count FROM files f WHERE ${condition.sql} GROUP BY f.media_type`,
    ].map((sql) => ({ sql, params: condition.params }));
    const [cameras, years, counts] = await this.executor.run(statements) as [
      { name: string; count: number }[], { year: number; count: number }[], { type: 'image' | 'video' | 'audio'; count: number }[]
    ];
    const types = { image: 0, video: 0, audio: 0 };
    for (const row of counts) if (row.type in types) types[row.type] = row.count;
    return { cameras, years, types };
  }

  async memories(context: Context) {
    const today = new Date();
    const day = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const currentYear = today.getFullYear();
    const filter = MediaListQuery.parse({});
    const condition = where(filter, context, this.db);
    const [groups, recent] = await this.executor.run([
      { sql: `SELECT CAST(strftime('%Y',f.taken_at,'unixepoch','localtime') AS INTEGER) AS year,count(*) AS count FROM files f
        WHERE ${condition.sql} AND strftime('%m-%d',f.taken_at,'unixepoch','localtime')=?
        AND CAST(strftime('%Y',f.taken_at,'unixepoch','localtime') AS INTEGER)<? GROUP BY year ORDER BY year DESC`, params: [...condition.params, day, currentYear] },
      { sql: `${selection} WHERE ${condition.sql} ORDER BY f.created_at DESC,f.id ASC LIMIT 12`, params: [context.id, ...condition.params] },
    ]) as [{ year: number; count: number }[], FileRow[]];
    const onThisDay = groups.map(({ year, count }) => {
      const start = new Date(0); start.setFullYear(year, today.getMonth(), today.getDate()); start.setHours(0, 0, 0, 0);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const from = Math.floor(start.getTime() / 1000); const to = Math.floor(end.getTime() / 1000);
      return { year, count, items: this.page(MediaListQuery.parse({ from, to, limit: 12 }), context).items };
    });
    return { onThisDay, recentlyAdded: recent.map(item), shuffle: this.random(RandomQuery.parse({ count: 12 }), context).items };
  }

  async suggest(query: string, context: Context) {
    const escaped = query.replace(/[\\%_]/g, '\\$&');
    const folderParams: Params = []; const fileParams: Params = [];
    const foldersAllowed = allowedClause(context.allowedPaths, folderParams, 'f.path');
    const filesAllowed = allowedClause(context.allowedPaths, fileParams);
    const [folders, cameras] = await this.executor.run([
      { sql: `SELECT f.path,f.name,f.media_count AS mediaCount FROM folders f JOIN libraries l ON l.id=f.library_id AND l.enabled=1
        WHERE ${foldersAllowed} AND f.missing_at_ms IS NULL AND f.name LIKE ? ESCAPE '\\' ORDER BY f.name COLLATE NOCASE,f.path LIMIT 10`, params: [...folderParams, `%${escaped}%`] },
      { sql: `SELECT DISTINCT f.model AS name FROM files f WHERE ${filesAllowed} AND f.missing_at_ms IS NULL AND EXISTS(SELECT 1 FROM libraries l WHERE l.id=f.library_id AND l.enabled=1) AND f.model LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT 10`, params: [...fileParams, `%${escaped}%`] },
    ]) as [{ path: string; name: string; mediaCount: number }[], { name: string }[]];
    return { folders, cameras: cameras.map((row) => row.name), media: this.page(MediaListQuery.parse({ q: query, limit: 10 }), context).items };
  }

  random(filter: RandomFilter, context: Context, restriction?: RandomFilter) {
    const condition = where(filter, context, this.db);
    if (restriction) {
      const scoped = where(restriction, context, this.db);
      condition.sql += ` AND (${scoped.sql})`;
      condition.params.push(...scoped.params);
    }
    const range = rowIdRange(this.db);
    if (range.min === null || range.max === null) return { items: [] };
    const start = range.max <= 2 ** 48 ? randomInt(range.min, range.max + 1) : range.min;
    const get = (op: '>=' | '<', limit: number) => this.db.prepare(`${selection} WHERE ${condition.sql} AND f.rowid ${op} ? ORDER BY f.rowid LIMIT ?`)
      .all(context.id, ...condition.params, start, limit) as FileRow[];
    const rows = get('>=', filter.count);
    if (rows.length < filter.count) rows.push(...get('<', filter.count - rows.length));
    return { items: rows.map(item) };
  }

  async summary(filter: Query, context: Context) {
    const condition = where(filter, context, this.db);
    const rows = await this.executor.run([{ sql: `SELECT count(*) AS count,min(f.taken_at) AS start,max(f.taken_at) AS end FROM files f WHERE ${condition.sql}`, params: condition.params }]);
    return rows[0]![0] as { count: number; start: number | null; end: number | null };
  }

  contains(filter: Query | RandomFilter, context: Context, id: string): boolean {
    const condition = where(filter, context, this.db);
    return !!this.db.prepare(`SELECT 1 FROM files f WHERE ${condition.sql} AND f.id=?`).get(...condition.params, id);
  }
}
