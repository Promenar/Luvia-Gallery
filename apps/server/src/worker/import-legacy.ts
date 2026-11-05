import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';
import { readFile, access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { defaultPreferences, WallpaperConfig } from '@luvia/contracts';
import { mediaId, virtualPath } from '../core/paths.ts';
import { hashPassword } from '../core/password.ts';

type LegacyUser = { username: string; password: string; isAdmin?: boolean; allowedPaths?: string[]; wallpaperToken?: string };
type LegacyConfig = { title?: string; libraryPaths?: string[]; users?: LegacyUser[] };
type LegacyFavorite = { source_rowid: number; user_id: string; item_id: string; item_type: string; created_at: number | null };
type Root = { id: string; root: string };
type Counts = { imported: number; pending: number; unmatched: number };
type Pending = { source_key: string; user_id: string | null; absolute_path: string | null; item_type: string; created_at: number };
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const idFor = (label: string, value: string) => `${label}_${createHash('sha256').update(value).digest('base64url').slice(0, 22)}`;
function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function mappedPath(absolute: string, roots: Root[]): { root: Root; relative: string } | undefined {
  if (!path.isAbsolute(absolute)) return undefined;
  const normalized = path.resolve(absolute);
  const root = roots.filter((r) => isWithin(r.root, normalized)).sort((a, b) => b.root.length - a.root.length)[0];
  return root ? { root, relative: path.relative(root.root, normalized).split(path.sep).join('/') } : undefined;
}
async function exists(filename: string): Promise<boolean> {
  try { await access(filename); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function decodedAbsolute(value: string): string | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  const canonical = bytes.toString('base64url');
  if (canonical !== value.replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_')) return null;
  const decoded = bytes.toString('utf8');
  if (!Buffer.from(decoded).equals(bytes) || decoded.includes('\0') || !path.isAbsolute(decoded)) return null;
  return path.resolve(decoded);
}
function counts(db: DatabaseType.Database): Counts {
  const rows = db.prepare('SELECT status,count(*) AS n FROM legacy_favorites_pending GROUP BY status').all() as { status: string; n: number }[];
  const totals: Counts = { imported: 0, pending: 0, unmatched: 0 };
  for (const row of rows) {
    if (row.status === 'matched') totals.imported = row.n;
    else if (row.status === 'pending') totals.pending = row.n;
    else if (row.status === 'unmatched') totals.unmatched = row.n;
  }
  return totals;
}

export async function importLegacy(db: DatabaseType.Database, options: { legacyDir: string; mediaRoots: string[]; fallbackRoots?: string[]; systemRoots?: string[]; batchSize?: number; assertLease?: () => void }): Promise<Counts & { unmappedRoots: number }> {
  const configPath = path.join(options.legacyDir, 'lumina-config.json');
  const legacyPath = path.join(options.legacyDir, 'lumina.db');
  const hasConfig = await exists(configPath);
  const hasDb = await exists(legacyPath);
  if (!hasConfig && !hasDb) throw new Error('没有发现旧版配置或数据库');
  let config: LegacyConfig = {};
  if (hasConfig) {
    const data: unknown = JSON.parse(await readFile(configPath, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('旧版配置格式无效');
    config = data as LegacyConfig;
    if (config.libraryPaths !== undefined && (!Array.isArray(config.libraryPaths) || config.libraryPaths.some((v) => typeof v !== 'string'))) throw new Error('旧版媒体路径格式无效');
    if (config.users !== undefined && (!Array.isArray(config.users) || config.users.some((u) => !u || typeof u.username !== 'string' || !u.username || typeof u.password !== 'string' || !u.password))) throw new Error('旧版用户格式无效');
  }
  const whitelist: string[] = [];
  for (const root of options.mediaRoots) {
    if (!path.isAbsolute(root)) throw new Error('媒体根必须为绝对路径');
    try { whitelist.push(await realpath(root)); } catch { /* 不可访问的挂载不能作为候选。 */ }
  }
  const system = await Promise.all((options.systemRoots ?? []).map(async (root) => {
    try { return await realpath(root); } catch { return path.resolve(root); }
  }));
  const configured = config.libraryPaths ?? options.fallbackRoots ?? [];
  const roots: Root[] = [];
  let unmappedRoots = 0;
  for (const input of [...new Set(configured)]) {
    if (!path.isAbsolute(input)) { unmappedRoots++; continue; }
    const root = path.resolve(input);
    let actual: string;
    try {
      actual = await realpath(root);
      if (!(await stat(actual)).isDirectory()) { unmappedRoots++; continue; }
    } catch { unmappedRoots++; continue; }
    if (!whitelist.some((base) => isWithin(base, actual)) || system.some((base) => isWithin(base, actual) || isWithin(actual, base))) {
      unmappedRoots++;
      continue;
    }
    roots.push({ id: idFor('lib', root), root });
  }
  const importedUsers: LegacyUser[] = [];
  for (const user of config.users ?? []) {
    if (user.allowedPaths !== undefined && (!Array.isArray(user.allowedPaths) || user.allowedPaths.some((p) => typeof p !== 'string' || !path.isAbsolute(p)))) throw new Error('旧版用户授权路径格式无效');
    importedUsers.push({ ...user, password: user.password.startsWith('scrypt$') ? user.password : await hashPassword(user.password) });
  }
  const now = Math.floor(Date.now() / 1000);
  db.transaction(() => {
    options.assertLease?.();
    for (const root of roots) {
      db.prepare('INSERT OR IGNORE INTO libraries (id,name,root) VALUES (?,?,?)').run(root.id, path.basename(root.root) || root.root, root.root);
      root.id = (db.prepare('SELECT id FROM libraries WHERE root=?').get(root.root) as { id: string }).id;
    }
    if (typeof config.title === 'string' && config.title.trim()) db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('siteName',?)").run(JSON.stringify(config.title));
    for (const user of importedUsers) {
      const mapped = (user.allowedPaths ?? []).flatMap((p) => {
        const absolute = path.resolve(p);
        const match = mappedPath(absolute, roots);
        if (match) return [virtualPath(match.root.id, match.relative)];
        return roots.filter((r) => isWithin(absolute, r.root)).map((r) => r.id);
      });
      db.prepare(`INSERT OR IGNORE INTO users (id,username,password_hash,role,allowed_paths,preferences,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(idFor('usr', user.username), user.username, user.password, user.isAdmin ? 'admin' : 'user', user.isAdmin ? null : JSON.stringify(mapped), JSON.stringify(defaultPreferences()), now);
      const actual = db.prepare('SELECT id FROM users WHERE username=?').get(user.username) as { id: string };
      if (user.wallpaperToken) db.prepare(`INSERT OR IGNORE INTO api_tokens (id,user_id,token_hash,name,scope,prefix,created_at,wallpaper)
        VALUES (?,?,?,?,?,?,?,?)`).run(idFor('tok', user.wallpaperToken), actual.id, digest(user.wallpaperToken), '旧版壁纸令牌', 'wallpaper', user.wallpaperToken.slice(0, 8), now, JSON.stringify(WallpaperConfig.parse({ source: 'library' })));
    }
  }).immediate();
  if (!hasDb) return { ...counts(db), unmappedRoots };
  const source = new Database(legacyPath, { readonly: true, fileMustExist: true });
  try {
    const hasTable = (name: string) => !!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    if (!hasTable('favorites')) return { ...counts(db), unmappedRoots };
    const findId = hasTable('files') ? source.prepare('SELECT path FROM files WHERE id=?') : null;
    const findPath = hasTable('files') ? source.prepare('SELECT path FROM files WHERE path=?') : null;
    const favorites = source.prepare('SELECT rowid AS source_rowid,* FROM favorites WHERE rowid>? ORDER BY rowid LIMIT ?');
    const batchSize = Math.max(1, Math.min(1000, options.batchSize ?? 256));
    const row = db.prepare("SELECT value FROM settings WHERE key='legacy.favorites.rowid'").get() as { value: string } | undefined;
    let cursor = row ? Number(row.value) : 0;
    while (true) {
      const batch = favorites.all(cursor, batchSize) as LegacyFavorite[];
      if (!batch.length) break;
      db.transaction(() => {
        options.assertLease?.();
        for (const favorite of batch) {
          const user = db.prepare('SELECT id FROM users WHERE username=?').get(favorite.user_id) as { id: string } | undefined;
          const byId = findId?.get(favorite.item_id) as { path: string } | undefined;
          const byPath = byId ? undefined : findPath?.get(favorite.item_id) as { path: string } | undefined;
          const candidate = byId?.path ?? byPath?.path ?? (favorite.item_type === 'folder' && path.isAbsolute(favorite.item_id) ? favorite.item_id : decodedAbsolute(favorite.item_id));
          const absolute = candidate && path.isAbsolute(candidate) && !candidate.includes('\0') ? path.resolve(candidate) : null;
          const validType = favorite.item_type === 'file' || favorite.item_type === 'folder';
          const key = digest(JSON.stringify([favorite.user_id, favorite.item_type, favorite.item_id]));
          db.prepare(`INSERT OR IGNORE INTO legacy_favorites_pending(source_key,username,user_id,legacy_item,absolute_path,item_type,created_at,status)
            VALUES (?,?,?,?,?,?,?,?)`).run(key, favorite.user_id, user?.id ?? null, favorite.item_id, absolute, favorite.item_type, favorite.created_at ?? now, absolute && user && validType ? 'pending' : 'unmatched');
        }
        cursor = batch.at(-1)!.source_rowid;
        db.prepare("INSERT INTO settings(key,value) VALUES('legacy.favorites.rowid',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(cursor));
      }).immediate();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally { source.close(); }
  return { ...counts(db), unmappedRoots };
}

export function reconcileLegacyFavorites(db: DatabaseType.Database, options: { finalize: boolean; assertLease?: () => void }): Counts {
  const roots = db.prepare('SELECT id,root FROM libraries').all() as Root[];
  let cursor = '';
  while (true) {
    const rows = db.prepare("SELECT source_key,user_id,absolute_path,item_type,created_at FROM legacy_favorites_pending WHERE status='pending' AND source_key>? ORDER BY source_key LIMIT 256").all(cursor) as Pending[];
    if (!rows.length) break;
    db.transaction(() => {
      options.assertLease?.();
      for (const pending of rows) {
        const match = pending.absolute_path ? mappedPath(pending.absolute_path, roots) : undefined;
        let itemId: string | undefined;
        if (match && pending.item_type === 'file' && match.relative) {
          const id = mediaId(match.root.id, match.relative);
          if (db.prepare('SELECT 1 FROM files WHERE id=?').get(id)) itemId = id;
        } else if (match && pending.item_type === 'folder') {
          const folder = virtualPath(match.root.id, match.relative);
          if (db.prepare('SELECT 1 FROM folders WHERE path=?').get(folder)) itemId = folder;
        }
        if (itemId && pending.user_id) {
          db.prepare('INSERT OR IGNORE INTO favorites(user_id,item_id,item_type,created_at) VALUES (?,?,?,?)').run(pending.user_id, itemId, pending.item_type, pending.created_at);
          db.prepare("UPDATE legacy_favorites_pending SET status='matched' WHERE source_key=?").run(pending.source_key);
        } else if (options.finalize) db.prepare("UPDATE legacy_favorites_pending SET status='unmatched' WHERE source_key=?").run(pending.source_key);
      }
    }).immediate();
    cursor = rows.at(-1)!.source_key;
  }
  return counts(db);
}
