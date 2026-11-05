import type Database from 'better-sqlite3';
import { randomInt } from 'node:crypto';
import type { z } from 'zod';
import { MediaListQuery, RandomQuery, MediaItem } from '@luvia/contracts';

type Query = z.output<typeof MediaListQuery>;
type RandomFilter = z.output<typeof RandomQuery>;
type Context = { id: string; allowedPaths: string[] | null };
type Params = (string | number)[];
type FileRow = {
  rowid: number; id: string; folder: string; name: string; media_type: 'image' | 'video' | 'audio';
  mime: string; size: number; width: number | null; height: number | null; duration_sec: number | null;
  taken_at: number; taken_at_source: 'metadata' | 'filename' | 'mtime'; modified_at: number; favorite: number;
  thumbhash: string | null; thumb_version: number; latitude: number | null; longitude: number | null;
  playability: 'direct' | 'transcode' | 'unsupported' | null; has_preview: number;
};
type Cursor = { sort: Query['sort']; value: number | string; id: string };

function prefixClause(column: string, prefix: string, params: Params): string {
  params.push(prefix, `${prefix}/`, `${prefix}0`);
  return `(${column} = ? OR (${column} >= ? AND ${column} < ?))`;
}
function allowedClause(paths: string[] | null, params: Params): string {
  if (paths === null) return '1';
  if (!paths.length) return '0';
  return `(${paths.map((prefix) => prefixClause('f.folder', prefix, params)).join(' OR ')})`;
}
function where(filter: Partial<Query> | RandomFilter, context: Context): { sql: string; params: Params } {
  const params: Params = [];
  const clauses = [allowedClause(context.allowedPaths, params)];
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
  if (filter.from !== undefined) { clauses.push('f.taken_at >= ?'); params.push(filter.from); }
  if (filter.to !== undefined) { clauses.push('f.taken_at < ?'); params.push(filter.to); }
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
    else { clauses.push('EXISTS (SELECT 1 FROM album_items ai JOIN albums a ON a.id=ai.album_id WHERE ai.file_id=f.id AND a.id=? AND a.user_id=?)'); params.push(filter.albumId, context.id); }
  }
  return { sql: clauses.join(' AND '), params };
}
function item(row: FileRow): z.output<typeof MediaItem> {
  return {
    id: row.id, name: row.name, folder: row.folder, mediaType: row.media_type, mime: row.mime, size: row.size,
    width: row.width, height: row.height, durationSec: row.duration_sec,
    takenAt: new Date(row.taken_at * 1000).toISOString(), takenAtSource: row.taken_at_source,
    modifiedAt: row.modified_at, favorite: !!row.favorite, thumbhash: row.thumbhash, thumbVersion: row.thumb_version,
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
  constructor(privateDb: Database.Database) { this.db = privateDb; }
  private db: Database.Database;

  one(id: string, context: Context) {
    const params: Params = [];
    const allowed = allowedClause(context.allowedPaths, params);
    const row = this.db.prepare(`${selection} WHERE f.id=? AND ${allowed}`).get(context.id, id, ...params) as FileRow | undefined;
    return row ? item(row) : null;
  }

  page(filter: Query, context: Context) {
    const condition = where(filter, context);
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

  buckets(filter: Query, context: Context) {
    const key = JSON.stringify(['buckets', filter, context]);
    const changes = this.db.prepare('SELECT total_changes() AS n').get() as { n: number };
    const version = `${this.db.pragma('data_version', { simple: true })}:${changes.n}`;
    const cached = this.cache.get(key);
    if (cached && cached.version === version && cached.expires > Date.now()) return cached.value;
    const condition = where(filter, context);
    const rows = this.db.prepare(`SELECT strftime('%Y-%m', f.taken_at, 'unixepoch', 'localtime') AS key, count(*) AS count
      FROM files f WHERE ${condition.sql} GROUP BY key ORDER BY key DESC`).all(...condition.params) as { key: string; count: number }[];
    const buckets = rows.map(({ key, count }) => {
      const [year, month] = key.split('-').map(Number);
      return { key, count, start: Math.floor(new Date(year!, month! - 1, 1).getTime() / 1000), end: Math.floor(new Date(year!, month!, 1).getTime() / 1000) };
    });
    const value = { buckets, total: buckets.reduce((sum, bucket) => sum + bucket.count, 0) };
    if (this.cache.size >= 64) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, { version, expires: Date.now() + 10_000, value });
    return value;
  }

  random(filter: RandomFilter, context: Context) {
    const condition = where(filter, context);
    const range = this.db.prepare('SELECT min(rowid) AS min, max(rowid) AS max FROM files').get() as { min: number | null; max: number | null };
    if (range.min === null || range.max === null) return { items: [] };
    const start = range.max <= 2 ** 48 ? randomInt(range.min, range.max + 1) : range.min;
    const get = (op: '>=' | '<', limit: number) => this.db.prepare(`${selection} WHERE ${condition.sql} AND f.rowid ${op} ? ORDER BY f.rowid LIMIT ?`)
      .all(context.id, ...condition.params, start, limit) as FileRow[];
    const rows = get('>=', filter.count);
    if (rows.length < filter.count) rows.push(...get('<', filter.count - rows.length));
    return { items: rows.map(item) };
  }
}
