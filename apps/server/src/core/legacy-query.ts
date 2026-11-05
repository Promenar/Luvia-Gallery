import { randomInt } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { QueryExecutor } from './query-executor.ts';
import { rowIdRange } from './rowid-range.ts';

type Value = string | number;
export type LegacyRow = { id: string; relative_path: string; root: string; name: string; mime: string; media_type: string; size: number;
  modified_at: number; width: number | null; height: number | null; favorite: number };
type Options = { userId: string; allowedPaths: string[] | null; folder: string | null; recursive: boolean; favorite: boolean;
  search?: string; mediaType?: string; excludeMediaType?: string; from?: number; to?: number; sort?: string;
  random: boolean; seed: number | null; limit: number; offset: number };

export async function legacyPage(db: Database.Database, executor: QueryExecutor, options: Options): Promise<{ rows: LegacyRow[]; hasMore: boolean }> {
  const parameters: Value[] = [];
  const clauses = ['l.enabled=1'];
  const prefix = (column: string, value: string) => {
    parameters.push(value, `${value}/`, `${value}0`);
    return `(${column}=? OR (${column}>=? AND ${column}<?))`;
  };
  if (options.allowedPaths !== null) {
    clauses.push(options.allowedPaths.length ? `(${options.allowedPaths.map((value) => prefix('f.folder', value)).join(' OR ')})` : '0');
  }
  if (options.folder) {
    if (options.recursive) clauses.push(prefix('f.folder', options.folder));
    else { clauses.push('f.folder=?'); parameters.push(options.folder); }
  }
  if (options.favorite) { clauses.push("EXISTS(SELECT 1 FROM favorites fv WHERE fv.user_id=? AND fv.item_type='file' AND fv.item_id=f.id)"); parameters.push(options.userId); }
  for (const term of options.search?.trim().split(/\s+/).filter(Boolean) ?? []) {
    const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    clauses.push("(f.name LIKE ? ESCAPE '\\' OR f.relative_path LIKE ? ESCAPE '\\')");
    parameters.push(pattern, pattern);
  }
  if (options.mediaType !== undefined) { clauses.push('f.media_type=?'); parameters.push(options.mediaType); }
  if (options.excludeMediaType !== undefined) { clauses.push('f.media_type<>?'); parameters.push(options.excludeMediaType); }
  if (options.from !== undefined && options.to !== undefined) { clauses.push('f.modified_at>=? AND f.modified_at<?'); parameters.push(options.from, options.to); }
  const from = `FROM files f JOIN libraries l ON l.id=f.library_id WHERE ${clauses.join(' AND ')}`;
  const columns = `SELECT f.id,f.relative_path,l.root,f.name,f.mime,f.media_type,f.size,f.modified_at,f.width,f.height,
    EXISTS(SELECT 1 FROM favorites fv WHERE fv.user_id=? AND fv.item_type='file' AND fv.item_id=f.id) AS favorite`;
  const baseParameters = [options.userId, ...parameters];
  let rows: LegacyRow[];
  if (options.random && options.seed === null) {
    const range = rowIdRange(db);
    if (range.min === null || range.max === null) return { rows: [], hasMore: false };
    const start = range.max < 2 ** 48 ? randomInt(range.min, range.max + 1) : range.min;
    const firstCount = options.offset ? Number(((await executor.run([{ sql: `SELECT count(*) AS n ${from} AND f.rowid>=?`, params: [...parameters, start] }]))[0]![0] as { n: number }).n) : 0;
    const firstOffset = options.offset ? Math.min(options.offset, firstCount) : 0;
    const first = (await executor.run([{ sql: `${columns} ${from} AND f.rowid>=? ORDER BY f.rowid LIMIT ? OFFSET ?`,
      params: [...baseParameters, start, options.limit + 1, firstOffset] }]))[0] as LegacyRow[];
    const remainingOffset = Math.max(0, options.offset - firstCount);
    if (first.length < options.limit + 1) {
      const second = (await executor.run([{ sql: `${columns} ${from} AND f.rowid<? ORDER BY f.rowid LIMIT ? OFFSET ?`,
        params: [...baseParameters, start, options.limit + 1 - first.length, remainingOffset] }]))[0] as LegacyRow[];
      first.push(...second);
    }
    rows = first;
  } else {
    const orders: Record<string, string> = {
      dateAsc: 'f.modified_at ASC', dateDesc: 'f.modified_at DESC', nameAsc: 'f.name COLLATE NOCASE ASC',
      nameDesc: 'f.name COLLATE NOCASE DESC', sizeDesc: 'f.size DESC',
    };
    const order = options.random ? 'legacy_rank(legacy_id(l.root,f.relative_path), ?) ASC' : (orders[options.sort ?? ''] ?? orders.dateDesc!);
    rows = (await executor.run([{ sql: `${columns} ${from} ORDER BY ${order}, legacy_id(l.root,f.relative_path) ASC LIMIT ? OFFSET ?`,
      params: [...baseParameters, ...(options.random ? [options.seed!] : []), options.limit + 1, options.offset] }]))[0] as LegacyRow[];
  }
  return { rows: rows.slice(0, options.limit), hasMore: rows.length > options.limit };
}
