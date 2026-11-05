import type Database from 'better-sqlite3';
import path from 'node:path';
import { pathAllowed } from './paths.ts';
import { MediaReader } from './media-query.ts';

type Context = { id: string; allowedPaths: string[] | null; isAdmin: boolean };
type Row = { path: string; name: string; parent: string | null; library_id: string; media_count: number; direct_media_count: number; child_count: number; latest_at: number | null; cover_file_id: string | null; host_root: string | null; favorite: number };

export class FolderReader {
  private db: Database.Database;
  private media: MediaReader;
  constructor(db: Database.Database) { this.db = db; this.media = new MediaReader(db); }
  private select = `SELECT f.*,l.host_root, EXISTS(SELECT 1 FROM favorites x WHERE x.user_id=? AND x.item_type='folder' AND x.item_id=f.path) AS favorite
    FROM folders f JOIN libraries l ON l.id=f.library_id WHERE l.enabled=1`;
  private visible(folder: string, context: Context): boolean {
    return pathAllowed(folder, context.allowedPaths) || !!context.allowedPaths?.some((allowed) => pathAllowed(allowed, [folder]));
  }
  private hostEnabled(context: Context): boolean {
    if (context.isAdmin) return true;
    const row = this.db.prepare("SELECT value FROM settings WHERE key='folders.exposeHostPaths'").get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) === true : false;
  }
  private host(row: Row, context: Context): string | null {
    if (!this.hostEnabled(context) || !row.host_root) return null;
    const relative = row.path.slice(row.library_id.length).replace(/^\//, '');
    return path.posix.join(row.host_root, relative);
  }
  private row(folder: string, context: Context): Row | undefined {
    return this.db.prepare(`${this.select} AND f.path=?`).get(context.id, folder) as Row | undefined;
  }
  private children(folder: string | null, context: Context): Row[] {
    return (folder === null
      ? this.db.prepare(`${this.select} AND f.parent IS NULL`).all(context.id)
      : this.db.prepare(`${this.select} AND f.parent=?`).all(context.id, folder)) as Row[];
  }
  private output(row: Row, context: Context) {
    const accessible = pathAllowed(row.path, context.allowedPaths);
    let count = row.media_count;
    let latest = row.latest_at;
    let children = row.child_count;
    if (!accessible && context.allowedPaths !== null) {
      const allowed = [...new Set(context.allowedPaths)].filter((candidate, _index, all) =>
        pathAllowed(candidate, [row.path]) && !all.some((other) => other !== candidate && pathAllowed(candidate, [other])));
      count = 0; latest = null;
      for (const target of allowed) {
        const selected = this.row(target, context);
        if (selected) {
          count += selected.media_count;
          if (selected.latest_at !== null && (latest === null || selected.latest_at > latest)) latest = selected.latest_at;
        }
      }
      children = this.children(row.path, context).filter((child) => this.visible(child.path, context)).length;
    }
    return { path: row.path, name: row.name, mediaCount: count, childCount: children,
      cover: accessible && row.cover_file_id ? this.media.one(row.cover_file_id, context) : null,
      favorite: !!row.favorite, latestAt: latest === null ? null : new Date(latest * 1000).toISOString(), hostPath: this.host(row, context) };
  }
  list(folder: string, context: Context) {
    const current = folder ? this.row(folder, context) : undefined;
    if (folder && (!current || !this.visible(folder, context))) return null;
    const folders = this.children(folder || null, context).filter((entry) => this.visible(entry.path, context));
    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const parts = folder ? folder.split('/') : [];
    const breadcrumbs = parts.map((part, index) => {
      const full = parts.slice(0, index + 1).join('/');
      return { path: full, name: this.row(full, context)?.name ?? part };
    });
    return { path: folder, breadcrumbs, folders: folders.map((entry) => this.output(entry, context)),
      directMediaCount: current && pathAllowed(folder, context.allowedPaths) ? current.direct_media_count : 0,
      hostPath: current ? this.host(current, context) : null, hostRoot: current && this.hostEnabled(context) ? current.host_root : null,
      favorite: !!current?.favorite };
  }
  get(folder: string, context: Context) {
    const row = this.row(folder, context);
    return row && pathAllowed(folder, context.allowedPaths) ? this.output(row, context) : null;
  }
  tree(folder: string, context: Context) {
    const listing = this.list(folder, context);
    if (!listing) return null;
    return { path: folder, nodes: listing.folders.map(({ path, name, childCount, mediaCount, favorite }) => ({ path, name, childCount, mediaCount, favorite })) };
  }
  favorites(context: Context) {
    const rows = this.db.prepare(`${this.select} AND EXISTS(SELECT 1 FROM favorites x WHERE x.user_id=? AND x.item_type='folder' AND x.item_id=f.path)`)
      .all(context.id, context.id) as Row[];
    return { folders: rows.filter((row) => pathAllowed(row.path, context.allowedPaths)).map((row) => this.output(row, context)) };
  }
  canFavorite(folder: string, context: Context): boolean { return !!this.row(folder, context) && pathAllowed(folder, context.allowedPaths); }
}
