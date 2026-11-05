import Database from 'better-sqlite3';
import type DatabaseType from 'better-sqlite3';
import { readFile, access, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { defaultPreferences } from '@luvia/contracts';
import { mediaId, virtualPath } from '../core/paths.ts';
import { hashPassword } from '../core/password.ts';

type LegacyUser = { username: string; password: string; isAdmin?: boolean; allowedPaths?: string[]; wallpaperToken?: string };
type LegacyConfig = { title?: string; libraryPaths?: string[]; users?: LegacyUser[] };
type LegacyFile = { rowid: number; id: string; path: string; name: string; size: number; type: string; media_type: string; last_modified: number; thumb_width: number | null; thumb_height: number | null };
type LegacyFavorite = { rowid: number; user_id: string; item_id: string; item_type: string; created_at: number };
type Root = { id: string; root: string };
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

export async function importLegacy(db: DatabaseType.Database, options: { legacyDir: string; mediaRoots: string[]; batchSize?: number }): Promise<void> {
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
  const whitelist = options.mediaRoots.map((root) => {
    if (!path.isAbsolute(root)) throw new Error('媒体根必须为绝对路径');
    return path.resolve(root);
  });
  const configured = config.libraryPaths?.length ? config.libraryPaths : whitelist;
  const rootPaths = [...new Set(configured.map((root) => {
    if (!path.isAbsolute(root)) throw new Error('旧版媒体库不是绝对路径');
    const normalized = path.resolve(root);
    if (whitelist.length && !whitelist.some((base) => isWithin(base, normalized))) throw new Error('旧版媒体库不在允许的挂载根目录内');
    return normalized;
  }))];
  if (whitelist.length) {
    const allowed = await Promise.all(whitelist.map((root) => realpath(root)));
    for (const root of rootPaths) {
      const actual = await realpath(root);
      if (!allowed.some((base) => isWithin(base, actual))) throw new Error('旧版媒体库不在允许的挂载根目录内');
    }
  }
  const roots: Root[] = rootPaths.map((root) => ({ id: idFor('lib', root), root }));
  const importedUsers: LegacyUser[] = [];
  for (const user of config.users ?? []) {
    if (user.allowedPaths !== undefined && (!Array.isArray(user.allowedPaths) || user.allowedPaths.some((p) => typeof p !== 'string' || !path.isAbsolute(p)))) throw new Error('旧版用户授权路径格式无效');
    importedUsers.push({ ...user, password: user.password.startsWith('scrypt$') ? user.password : await hashPassword(user.password) });
  }
  const now = Math.floor(Date.now() / 1000);
  db.transaction(() => {
    for (const root of roots) {
      db.prepare('INSERT OR IGNORE INTO libraries (id,name,root) VALUES (?,?,?)').run(root.id, path.basename(root.root) || root.root, root.root);
      const actual = db.prepare('SELECT id FROM libraries WHERE root=?').get(root.root) as { id: string };
      root.id = actual.id;
    }
    if (typeof config.title === 'string' && config.title.trim()) db.prepare("INSERT OR IGNORE INTO settings (key,value) VALUES ('siteName',?)").run(JSON.stringify(config.title));
    for (const u of importedUsers) {
      const mapped = (u.allowedPaths ?? []).flatMap((p) => {
        const absolute = path.resolve(p);
        const match = mappedPath(absolute, roots);
        if (match) return [virtualPath(match.root.id, match.relative)];
        return roots.filter((r) => isWithin(absolute, r.root)).map((r) => r.id);
      });
      const userId = idFor('usr', u.username);
      db.prepare(`INSERT OR IGNORE INTO users (id,username,password_hash,role,allowed_paths,preferences,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(userId, u.username, u.password, u.isAdmin ? 'admin' : 'user', u.isAdmin ? null : JSON.stringify(mapped), JSON.stringify(defaultPreferences()), now);
      const actual = db.prepare('SELECT id FROM users WHERE username=?').get(u.username) as { id: string };
      if (u.wallpaperToken) db.prepare(`INSERT OR IGNORE INTO api_tokens (id,user_id,token_hash,name,scope,prefix,created_at)
        VALUES (?,?,?,?,?,?,?)`).run(idFor('tok', u.wallpaperToken), actual.id, digest(u.wallpaperToken), '旧版壁纸令牌', 'wallpaper', u.wallpaperToken.slice(0, 8), now);
    }
  }).immediate();
  if (!hasDb) return;
  const source = new Database(legacyPath, { readonly: true, fileMustExist: true });
  try {
    const batchSize = Math.max(1, Math.min(1000, options.batchSize ?? 256));
    const getCheckpoint = (key: string) => {
      const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
      return row ? Number(row.value) : 0;
    };
    const saveCheckpoint = db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    const files = source.prepare(`SELECT rowid,* FROM files WHERE rowid>? ORDER BY rowid LIMIT ?`);
    const insert = db.prepare(`INSERT INTO files (id,legacy_id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,width,height)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'mtime',?,?) ON CONFLICT(id) DO UPDATE SET legacy_id=COALESCE(files.legacy_id, excluded.legacy_id)`);
    let cursor = getCheckpoint('legacy.files.rowid');
    while (true) {
      const batch = files.all(cursor, batchSize) as LegacyFile[];
      if (!batch.length) break;
      db.transaction(() => {
        for (const file of batch) {
          const match = mappedPath(file.path, roots);
          if (!match?.relative) throw new Error('旧版媒体路径无法映射到已配置的媒体库');
          if (!['image', 'video', 'audio'].includes(file.media_type) || !Number.isSafeInteger(file.last_modified) || file.last_modified < 0) throw new Error('旧版媒体记录格式无效');
          if (file.last_modified > 253402300799) throw new Error('旧版修改时间戳超出常用日期范围，需要人工核验');
          const folder = path.posix.dirname(match.relative);
          insert.run(mediaId(match.root.id, match.relative), file.id, match.root.id, match.relative, virtualPath(match.root.id, folder === '.' ? '' : folder), file.name, file.type, file.media_type, file.size, file.last_modified, file.last_modified, file.thumb_width, file.thumb_height);
        }
        cursor = batch.at(-1)!.rowid;
        saveCheckpoint.run('legacy.files.rowid', String(cursor));
      }).immediate();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const favorites = source.prepare('SELECT rowid,* FROM favorites WHERE rowid>? ORDER BY rowid LIMIT ?');
    cursor = getCheckpoint('legacy.favorites.rowid');
    while (true) {
      const batch = favorites.all(cursor, batchSize) as LegacyFavorite[];
      if (!batch.length) break;
      db.transaction(() => {
        for (const favorite of batch) {
          const user = db.prepare('SELECT id FROM users WHERE username=?').get(favorite.user_id) as { id: string } | undefined;
          if (!user) throw new Error('旧版收藏所属用户不存在');
          let itemId: string | undefined;
          if (favorite.item_type === 'file') itemId = (db.prepare('SELECT id FROM files WHERE legacy_id=?').get(favorite.item_id) as { id: string } | undefined)?.id;
          else if (favorite.item_type === 'folder') {
            const match = mappedPath(favorite.item_id, roots);
            if (match) itemId = virtualPath(match.root.id, match.relative);
          }
          if (!itemId) throw new Error('旧版收藏目标无法映射');
          db.prepare('INSERT OR IGNORE INTO favorites (user_id,item_id,item_type,created_at) VALUES (?,?,?,?)')
            .run(user.id, itemId, favorite.item_type, favorite.created_at ?? now);
        }
        cursor = batch.at(-1)!.rowid;
        saveCheckpoint.run('legacy.favorites.rowid', String(cursor));
      }).immediate();
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  } finally { source.close(); }
}
