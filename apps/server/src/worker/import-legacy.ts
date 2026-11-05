import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';
import { readFile, access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { defaultPreferences, WallpaperConfig } from '@luvia/contracts';
import { mediaId, pathAllowed, virtualPath } from '../core/paths.ts';
import { hashPassword } from '../core/password.ts';

type LegacyUser = { username: string; password: string; isAdmin?: boolean; allowedPaths?: string[]; wallpaperToken?: string; wallpaperConfig?: { interval?: unknown; showVideos?: unknown } | null };
type LegacyConfig = { title?: string; libraryPaths?: string[]; users?: LegacyUser[] };
type LegacyFavorite = { source_rowid: number; user_id: string; item_id: string; item_type: string; created_at: number | null };
type Root = { id: string; root: string };
type Counts = { imported: number; pending: number; unmatched: number };
type Pending = { source_key: string; user_id: string | null; absolute_path: string | null; item_type: string; created_at: number };
export class LegacyIdentityUncertainError extends Error {
  constructor() { super('旧账户导入状态无法安全确认，需要人工核验'); }
}
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
    const locked = !!db.prepare("SELECT 1 FROM settings WHERE key='legacy.identity_upgrade_locked'").get();
    for (const user of importedUsers) {
      const mapped = (user.allowedPaths ?? []).flatMap((p) => {
        const absolute = path.resolve(p);
        const match = mappedPath(absolute, roots);
        if (match) return [virtualPath(match.root.id, match.relative)];
        return roots.filter((r) => isWithin(absolute, r.root)).map((r) => r.id);
      });
      let origin = db.prepare('SELECT user_id FROM legacy_import_users WHERE username=?').get(user.username) as { user_id: string } | undefined;
      if (!origin) {
        const occupied = db.prepare('SELECT 1 FROM users WHERE username=?').get(user.username);
        const revoked = db.prepare('SELECT 1 FROM legacy_jwt_revoked_users WHERE username=?').get(user.username);
        if (locked && !occupied && !revoked) throw new LegacyIdentityUncertainError();
        const id = !occupied && !revoked && !locked ? randomUUID() : '';
        if (id) {
          db.prepare(`INSERT INTO users (id,username,password_hash,role,allowed_paths,preferences,created_at)
            VALUES (?,?,?,?,?,?,?)`).run(id, user.username, user.password, user.isAdmin ? 'admin' : 'user', user.isAdmin ? null : JSON.stringify(mapped), JSON.stringify(defaultPreferences()), now);
          db.prepare('INSERT INTO legacy_jwt_users(user_id) VALUES (?)').run(id);
        }
        db.prepare('INSERT INTO legacy_import_users(username,user_id) VALUES (?,?)').run(user.username, id);
        origin = { user_id: id };
      }
      if (locked && !origin.user_id && db.prepare('SELECT 1 FROM users WHERE username=?').get(user.username)) throw new LegacyIdentityUncertainError();
      const actual = db.prepare('SELECT id FROM users WHERE id=? AND username=?').get(origin.user_id, user.username) as { id: string } | undefined;
      if (user.wallpaperToken) {
        const hash = digest(user.wallpaperToken);
        const first = db.prepare('INSERT OR IGNORE INTO legacy_import_tokens(token_hash) VALUES (?)').run(hash).changes;
        const decoded = jwt.decode(user.wallpaperToken);
        if (!first || !actual || locked || !decoded || typeof decoded === 'string' || decoded.isWallpaper !== true || decoded.username !== user.username || !Number.isSafeInteger(decoded.exp)) continue;
        const interval = user.wallpaperConfig?.interval;
        const intervalSec = typeof interval === 'number' && Number.isInteger(interval) && interval >= 5 && interval <= 3600 ? interval : 30;
        const wallpaper = WallpaperConfig.parse({ source: 'library', intervalSec, landscapeOnly: false, includeVideos: user.wallpaperConfig?.showVideos !== false });
        db.prepare(`INSERT OR IGNORE INTO api_tokens (id,user_id,token_hash,name,scope,prefix,created_at,wallpaper,expires_at,legacy_jwt)
          VALUES (?,?,?,?,?,?,?,?,?,1)`).run(idFor('tok', user.wallpaperToken), actual.id, hash, '旧版壁纸令牌', 'wallpaper', user.wallpaperToken.slice(0, 8), now, JSON.stringify(wallpaper), decoded.exp);
      }
    }
    const pending = db.prepare("SELECT value FROM settings WHERE key='legacy.pending'").get() as { value: string } | undefined;
    if ((locked || pending?.value === 'true') && !db.prepare("SELECT 1 FROM users WHERE role='admin' LIMIT 1").get()) throw new LegacyIdentityUncertainError();
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
          const user = db.prepare('SELECT u.id FROM users u JOIN legacy_import_users i ON i.user_id=u.id AND i.username=u.username WHERE u.username=?').get(favorite.user_id) as { id: string } | undefined;
          if (!user) {
            const existing = db.prepare('SELECT 1 FROM users WHERE username=?').get(favorite.user_id);
            const origin = db.prepare('SELECT user_id FROM legacy_import_users WHERE username=?').get(favorite.user_id) as { user_id: string } | undefined;
            if (existing && !origin?.user_id) throw new LegacyIdentityUncertainError();
          }
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
  const roots = db.prepare('SELECT id,root FROM libraries WHERE enabled=1 ORDER BY length(root) DESC,id ASC').all() as Root[];
  let cursor = '';
  while (true) {
    const rows = db.prepare(`SELECT source_key,user_id,absolute_path,item_type,created_at FROM legacy_favorites_pending
      WHERE status IN ('pending','unmatched') AND absolute_path IS NOT NULL AND user_id IS NOT NULL AND source_key>? ORDER BY source_key LIMIT 256`).all(cursor) as Pending[];
    if (!rows.length) break;
    db.transaction(() => {
      options.assertLease?.();
      for (const pending of rows) {
        const user = db.prepare('SELECT role,allowed_paths FROM users WHERE id=?').get(pending.user_id) as { role: string; allowed_paths: string | null } | undefined;
        if (!user) continue;
        let allowed: string[] | null = null;
        if (user.role !== 'admin' && user.allowed_paths !== null) {
          try {
            const parsed: unknown = JSON.parse(user.allowed_paths);
            allowed = Array.isArray(parsed) && parsed.every((value) => typeof value === 'string') ? parsed : [];
          } catch { allowed = []; }
        }
        let itemId: string | undefined;
        for (const root of roots) {
          const match = pending.absolute_path ? mappedPath(pending.absolute_path, [root]) : undefined;
          if (match && pending.item_type === 'file' && match.relative) {
            const id = mediaId(match.root.id, match.relative);
            const file = db.prepare('SELECT folder FROM files WHERE id=?').get(id) as { folder: string } | undefined;
            if (file && pathAllowed(file.folder, allowed)) itemId = id;
          } else if (match && pending.item_type === 'folder') {
            const folder = virtualPath(match.root.id, match.relative);
            if (pathAllowed(folder, allowed) && db.prepare('SELECT 1 FROM folders WHERE path=?').get(folder)) itemId = folder;
          }
          if (itemId) break;
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
