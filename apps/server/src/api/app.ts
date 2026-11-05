import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { access, realpath, stat, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { ZodError } from 'zod';
import { CSRF_HEADER, endpoints, JobAction, Preferences, WallpaperConfig, defaultPreferences } from '@luvia/contracts';
import type { User } from '@luvia/contracts';
import { hashPassword, verifyPassword } from '../core/password.ts';
import { MediaReader } from '../core/media-query.ts';
import { FolderReader } from '../core/folder-reader.ts';
import { pathAllowed, secureMediaPath } from '../core/paths.ts';
import { sendFile } from './binary.ts';
import { jobView, publishJob } from '../core/job-view.ts';
import type { JobRecord } from '../core/job-view.ts';
import { detectMounts } from '../core/mounts.ts';
import type { Mount } from '../core/mounts.ts';
import { readSettings, writeSettings } from '../core/settings.ts';
import { cacheKey, cachePath, enqueueMediaTask } from '../core/media-cache.ts';
import type { Variant } from '../core/media-cache.ts';

type UserRow = {
  id: string; username: string; password_hash: string; role: 'admin' | 'user';
  allowed_paths: string | null; preferences: string; created_at: number; last_login_at: number | null;
};
type TokenRow = {
  id: string; name: string; scope: 'read' | 'wallpaper'; prefix: string;
  created_at: number; last_used_at: number | null; expires_at: number | null; wallpaper: string | null;
};
type Identity = { user: UserRow; kind: 'session' | 'token'; scope?: string; sessionHash?: string };
type Options = { db: Database.Database; legacyPending: boolean | (() => boolean); secureCookies?: boolean; mounts?: () => Promise<Mount[]>; systemRoots?: string[]; cacheDir?: string };
class HttpError extends Error { constructor(publicStatus: number, code: string, message: string) { super(message); this.statusCode = publicStatus; this.code = code; } statusCode: number; code: string; }
const fail = (status: number, code: string, message: string): never => { throw new HttpError(status, code, message); };
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => Math.floor(Date.now() / 1000);
const iso = (n: number | null) => n === null ? null : new Date(n * 1000).toISOString();
const secret = () => randomBytes(32).toString('base64url');
const userOut = (u: UserRow): User => ({
  id: u.id, username: u.username, role: u.role,
  allowedPaths: u.role === 'admin' ? null : u.allowed_paths === null ? null : JSON.parse(u.allowed_paths),
  preferences: Preferences.parse(JSON.parse(u.preferences)), createdAt: iso(u.created_at)!, lastLoginAt: iso(u.last_login_at),
});
const tokenOut = (t: TokenRow) => ({
  id: t.id, name: t.name, scope: t.scope, prefix: t.prefix,
  wallpaper: t.scope === 'wallpaper' ? WallpaperConfig.parse(t.wallpaper ? JSON.parse(t.wallpaper) : {}) : null,
  createdAt: iso(t.created_at)!, lastUsedAt: iso(t.last_used_at), expiresAt: iso(t.expires_at),
});

export async function createApp(options: Options): Promise<FastifyInstance> {
  const { db } = options;
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const identities = new WeakMap<FastifyRequest, Identity>();
  const media = new MediaReader(db);
  const folders = new FolderReader(db);
  const attempts = new Map<string, number[]>();
  const secure = options.secureCookies ?? process.env.NODE_ENV === 'production';
  const systemRoots = options.systemRoots ?? [path.resolve(process.env.DATA_DIR ?? 'data'), path.resolve(process.env.CACHE_DIR ?? 'cache')];
  const configuredMediaRoots = (process.env.MEDIA_ROOT ?? '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => path.resolve(part));
  const getMounts = options.mounts ?? (() => process.platform === 'darwin'
    ? Promise.resolve(configuredMediaRoots.map((containerPath): Mount => ({ containerPath, hostPath: null, kind: 'candidate', libraryId: null, readOnly: true, mediaEstimate: null })))
    : detectMounts({ mediaRoots: configuredMediaRoots, systemRoots, hostPaths: process.env.LUVIA_HOST_PATHS }));
  const within = (root: string, target: string) => {
    const relative = path.relative(root, target);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  async function findRoot(root: string): Promise<{ root: string; hostRoot: string | null }> {
    if (!path.isAbsolute(root)) return fail(400, 'VALIDATION', '媒体库路径必须为绝对路径');
    const normalized = path.resolve(root);
    let actual: string;
    try { actual = await realpath(normalized); if (!(await stat(actual)).isDirectory()) return fail(400, 'VALIDATION', '媒体库路径必须是目录'); }
    catch (error) { if (error instanceof HttpError) throw error; return fail(400, 'VALIDATION', '媒体库路径不可访问'); }
    for (const system of systemRoots) {
      let resolved: string;
      try { resolved = await realpath(system); } catch { resolved = path.resolve(system); }
      if (within(resolved, actual) || within(actual, resolved)) return fail(400, 'VALIDATION', '媒体库不能包含系统目录');
    }
    const candidates = (await getMounts()).filter((mount) => mount.kind === 'candidate' && within(mount.containerPath, normalized))
      .sort((a, b) => b.containerPath.length - a.containerPath.length);
    for (const mount of candidates) {
      let realMount: string;
      try { realMount = await realpath(mount.containerPath); } catch { continue; }
      if (!within(realMount, actual)) continue;
      const relative = path.relative(mount.containerPath, normalized).split(path.sep).join('/');
      return { root: normalized, hostRoot: mount.hostPath ? path.posix.join(mount.hostPath, relative) : null };
    }
    return fail(400, 'VALIDATION', '媒体库路径不在检测到的挂载内');
  }
  const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
  const countUsers = db.prepare('SELECT count(*) AS n FROM users');
  const pending = () => typeof options.legacyPending === 'function' ? options.legacyPending() : options.legacyPending;

  function authenticate(req: FastifyRequest): Identity | undefined {
    const auth = req.headers.authorization;
    if (auth) {
      const match = /^Bearer ([A-Za-z0-9._~+\/-]+={0,2})$/i.exec(auth);
      if (!match) return undefined;
      const row = db.prepare(`SELECT u.*, t.scope AS token_scope FROM api_tokens t JOIN users u ON u.id=t.user_id
        WHERE t.token_hash=? AND (t.expires_at IS NULL OR t.expires_at>?)`).get(digest(match[1]!), now()) as (UserRow & { token_scope: string }) | undefined;
      return row ? { user: row, kind: 'token', scope: row.token_scope } : undefined;
    }
    const value = req.cookies.luvia_session;
    if (!value || value.length > 256) return undefined;
    const sessionHash = digest(value);
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?`).get(sessionHash, now()) as UserRow | undefined;
    return row ? { user: row, kind: 'session', sessionHash } : undefined;
  }
  function requireUser(req: FastifyRequest): Identity {
    return identities.get(req) ?? fail(401, 'UNAUTHORIZED', '请先登录');
  }
  function makeSession(reply: FastifyReply, userId: string, remember: boolean): void {
    const value = secret();
    db.prepare('INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)')
      .run(digest(value), userId, now(), now() + 30 * 86400);
    reply.setCookie('luvia_session', value, {
      httpOnly: true, sameSite: 'lax', secure, path: '/', ...(remember ? { maxAge: 30 * 86400 } : {}),
    });
  }
  function limitLogin(ip: string): void {
    const cutoff = Date.now() - 60_000;
    const previous = (attempts.get(ip) ?? []).filter((v) => v > cutoff);
    if (previous.length >= 10) fail(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试');
    previous.push(Date.now());
    attempts.set(ip, previous);
    if (attempts.size > 10000) {
      for (const [key, values] of attempts) if (!values.some((v) => v > cutoff)) attempts.delete(key);
      if (attempts.size > 10000) attempts.delete(attempts.keys().next().value!);
    }
  }
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: 'VALIDATION', message: '请求参数无效' } });
    if (err instanceof HttpError) return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    return reply.code(500).send({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
  });
  app.addHook('onRequest', async (req) => {
    const url = new URL(req.raw.url ?? '/', 'http://localhost');
    if (url.pathname.startsWith('/api/v2/') && [...url.searchParams.keys()].some((key) => key.toLowerCase() === 'token')) {
      fail(400, 'VALIDATION', '不允许在 URL 中传递令牌');
    }
    const identity = authenticate(req);
    if (url.pathname.startsWith('/api/v2/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && identity?.kind !== 'token' && req.headers[CSRF_HEADER.toLowerCase()] !== '1') {
      fail(403, 'FORBIDDEN', '请求缺少安全标头');
    }
    if (identity) identities.set(req, identity);
  });
  function register<K extends keyof typeof endpoints>(name: K, handler: (req: FastifyRequest, reply: FastifyReply, body: any) => unknown | Promise<unknown>): void {
    const def = endpoints[name];
    app.route({ method: def.method, url: def.path, handler: async (req, reply) => {
      const identity = identities.get(req);
      if (def.auth !== 'public' && !identity) fail(401, 'UNAUTHORIZED', '请先登录');
      if (def.auth === 'admin' && (identity?.kind !== 'session' || identity.user.role !== 'admin')) fail(403, 'FORBIDDEN', '需要管理员会话');
      if (identity?.kind === 'token' && identity.scope === 'wallpaper' && name !== 'randomMedia') fail(403, 'FORBIDDEN', '令牌权限不足');
      if (identity?.kind === 'token' && def.auth !== 'public' && req.method !== 'GET') fail(403, 'FORBIDDEN', '令牌仅支持读取');
      const body = 'body' in def && def.body ? def.body.parse(req.body) : undefined;
      const result = await handler(req, reply, body);
      if (reply.sent) return;
      if (def.response === null) return reply.code(204).send();
      const parsed = def.response.safeParse(result);
      if (!parsed.success) fail(500, 'INTERNAL', '服务器响应无效');
      return parsed.data;
    }});
  }
  register('authState', async (req) => {
    const user = identities.get(req)?.user;
    const site = db.prepare("SELECT value FROM settings WHERE key='siteName'").get() as { value: string } | undefined;
    return { initialized: (countUsers.get() as { n: number }).n > 0, user: user ? userOut(user) : null, siteName: site ? JSON.parse(site.value) : 'Luvia Gallery', version: '2.0.0-alpha.0' };
  });
  register('setup', async (req, reply, body) => {
    if (pending()) fail(503, 'MIGRATION_PENDING', '旧数据导入尚未完成');
    if ((countUsers.get() as { n: number }).n > 0) fail(409, 'CONFLICT', '系统已经初始化');
    limitLogin(req.ip);
    const passwordHash = await hashPassword(body.password);
    const u: UserRow = { id: randomUUID(), username: body.username, password_hash: passwordHash, role: 'admin', allowed_paths: null, preferences: JSON.stringify(defaultPreferences()), created_at: now(), last_login_at: now() };
    db.transaction(() => {
      if ((countUsers.get() as { n: number }).n > 0) fail(409, 'CONFLICT', '系统已经初始化');
      if (pending()) fail(503, 'MIGRATION_PENDING', '旧数据导入尚未完成');
      db.prepare('INSERT INTO users (id,username,password_hash,role,allowed_paths,preferences,created_at,last_login_at) VALUES (@id,@username,@password_hash,@role,@allowed_paths,@preferences,@created_at,@last_login_at)').run(u);
      if (body.siteName) db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('siteName',?)").run(JSON.stringify(body.siteName));
      makeSession(reply, u.id, true);
    }).immediate();
    return { user: userOut(u) };
  });
  register('login', async (req, reply, body) => {
    limitLogin(req.ip);
    const u = (findUser.get(body.username) as UserRow | undefined) ?? fail(401, 'UNAUTHORIZED', '用户名或密码错误');
    const verification = await verifyPassword(body.password, u.password_hash);
    if (!verification.valid) fail(401, 'UNAUTHORIZED', '用户名或密码错误');
    const upgraded = verification.needsUpgrade ? await hashPassword(body.password) : null;
    db.transaction(() => {
      u.last_login_at = now();
      const updated = db.prepare('UPDATE users SET password_hash=?, last_login_at=? WHERE id=? AND password_hash=?')
        .run(upgraded ?? u.password_hash, u.last_login_at, u.id, u.password_hash);
      if (!updated.changes) fail(409, 'CONFLICT', '账户状态已经变化');
      makeSession(reply, u.id, body.remember);
    }).immediate();
    return { user: userOut(u) };
  });
  register('logout', async (req, reply) => {
    const identity = requireUser(req);
    if (identity.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(identity.sessionHash);
    reply.clearCookie('luvia_session', { path: '/', httpOnly: true, secure, sameSite: 'lax' });
  });
  register('updatePreferences', async (req, _reply, body) => {
    const identity = requireUser(req);
    const old = userOut(identity.user).preferences;
    const merged = Preferences.parse({ ...old, ...body, theme: { ...old.theme, ...body.theme }, home: { ...old.home, ...body.home }, slideshow: { ...old.slideshow, ...body.slideshow } });
    db.prepare('UPDATE users SET preferences=? WHERE id=?').run(JSON.stringify(merged), identity.user.id);
    return merged;
  });
  register('changePassword', async (req, _reply, body) => {
    const identity = requireUser(req);
    if (identity.kind !== 'session') fail(403, 'FORBIDDEN', '需要会话验证');
    if (!(await verifyPassword(body.current, identity.user.password_hash)).valid) fail(401, 'UNAUTHORIZED', '当前密码错误');
    const next = await hashPassword(body.next);
    db.transaction(() => {
      const update = db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').run(next, identity.user.id, identity.user.password_hash);
      if (!update.changes) fail(409, 'CONFLICT', '账户状态已经变化');
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(identity.user.id);
    }).immediate();
  });
  register('listTokens', async (req) => {
    const identity = requireUser(req);
    if (identity.kind !== 'session') fail(403, 'FORBIDDEN', '需要会话验证');
    return { tokens: (db.prepare('SELECT * FROM api_tokens WHERE user_id=? ORDER BY created_at DESC').all(identity.user.id) as TokenRow[]).map(tokenOut) };
  });
  register('createToken', async (req, _reply, body) => {
    const identity = requireUser(req);
    if (identity.kind !== 'session') fail(403, 'FORBIDDEN', '需要会话验证');
    if (body.scope !== 'wallpaper' && body.wallpaper !== undefined) fail(400, 'VALIDATION', '普通令牌不能设置壁纸配置');
    const token = secret();
    const t: TokenRow = { id: randomUUID(), name: body.name, scope: body.scope, prefix: token.slice(0, 8), created_at: now(), last_used_at: null, expires_at: body.expiresAt ? Math.floor(new Date(body.expiresAt).getTime() / 1000) : null, wallpaper: body.scope === 'wallpaper' ? JSON.stringify(WallpaperConfig.parse(body.wallpaper ?? {})) : null };
    if (t.expires_at !== null && (!Number.isFinite(t.expires_at) || t.expires_at <= now())) fail(400, 'VALIDATION', '令牌过期时间无效');
    db.prepare('INSERT INTO api_tokens (id,user_id,token_hash,name,scope,prefix,created_at,expires_at,wallpaper) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(t.id, identity.user.id, digest(token), t.name, t.scope, t.prefix, t.created_at, t.expires_at, t.wallpaper);
    return { token, meta: tokenOut(t) };
  });
  register('updateToken', async (req, _reply, body) => {
    const identity = requireUser(req);
    if (identity.kind !== 'session') fail(403, 'FORBIDDEN', '需要会话验证');
    const { id } = req.params as { id: string };
    const existing = db.prepare('SELECT * FROM api_tokens WHERE id=? AND user_id=?').get(id, identity.user.id) as TokenRow | undefined;
    const t = existing ?? fail(404, 'NOT_FOUND', '令牌不存在');
    if (t.scope !== 'wallpaper' && body.wallpaper !== undefined) fail(400, 'VALIDATION', '普通令牌不能设置壁纸配置');
    const raw = req.body as { wallpaper?: Record<string, unknown> };
    const supplied = raw.wallpaper ? Object.fromEntries(Object.keys(raw.wallpaper).map((key) => [key, body.wallpaper?.[key]])) : {};
    const wallpaper = t.scope === 'wallpaper' ? JSON.stringify(WallpaperConfig.parse({ ...tokenOut(t).wallpaper, ...supplied })) : null;
    db.prepare('UPDATE api_tokens SET name=?, wallpaper=? WHERE id=? AND user_id=?').run(body.name ?? t.name, wallpaper, id, identity.user.id);
    return tokenOut({ ...t, name: body.name ?? t.name, wallpaper });
  });
  register('deleteToken', async (req) => {
    const identity = requireUser(req);
    if (identity.kind !== 'session') fail(403, 'FORBIDDEN', '需要会话验证');
    const { id } = req.params as { id: string };
    if (!db.prepare('DELETE FROM api_tokens WHERE id=? AND user_id=?').run(id, identity.user.id).changes) fail(404, 'NOT_FOUND', '令牌不存在');
  });
  function mediaContext(req: FastifyRequest) {
    const u = userOut(requireUser(req).user);
    return { id: u.id, allowedPaths: u.allowedPaths };
  }
  function folderContext(req: FastifyRequest) {
    const user = userOut(requireUser(req).user);
    return { id: user.id, allowedPaths: user.allowedPaths, isAdmin: user.role === 'admin' };
  }
  register('folders', async (req) => {
    const query = endpoints.folders.query.parse(req.query);
    return folders.list(query.path ?? '', folderContext(req)) ?? fail(404, 'NOT_FOUND', '文件夹不存在或不可访问');
  });
  register('folderTree', async (req) => {
    const query = endpoints.folderTree.query.parse(req.query);
    return folders.tree(query.path ?? '', folderContext(req)) ?? fail(404, 'NOT_FOUND', '文件夹不存在或不可访问');
  });
  register('setFolderFavorite', async (req, _reply, body) => {
    const context = folderContext(req);
    if (!folders.canFavorite(body.path, context)) fail(403, 'FORBIDDEN', '文件夹不可访问');
    if (body.favorite) db.prepare("INSERT OR IGNORE INTO favorites(user_id,item_id,item_type) VALUES (?,?,'folder')").run(context.id, body.path);
    else db.prepare("DELETE FROM favorites WHERE user_id=? AND item_id=? AND item_type='folder'").run(context.id, body.path);
    return { ok: true };
  });
  register('favoriteFolders', async (req) => folders.favorites(folderContext(req)));
  register('setFavorite', async (req, _reply, body) => {
    const context = mediaContext(req);
    const ids = [...new Set(body.ids as string[])];
    const find = db.prepare('SELECT folder FROM files WHERE id=?');
    const add = db.prepare("INSERT OR IGNORE INTO favorites (user_id,item_id,item_type) VALUES (?,?,'file')");
    const remove = db.prepare("DELETE FROM favorites WHERE user_id=? AND item_id=? AND item_type='file'");
    const updated = db.transaction(() => {
      for (const id of ids) {
        const row = find.get(id) as { folder: string } | undefined;
        if (!row || !pathAllowed(row.folder, context.allowedPaths)) fail(403, 'FORBIDDEN', '媒体不可访问');
      }
      let changes = 0;
      for (const id of ids) changes += Number((body.favorite ? add : remove).run(context.id, id).changes);
      return changes;
    }).immediate();
    return { updated };
  });
  register('listMedia', async (req) => {
    const q = endpoints.listMedia.query.parse(req.query);
    try { return media.page(q, mediaContext(req)); }
    catch (err) { if (err instanceof Error && err.message === '无效游标') fail(400, 'VALIDATION', '无效游标'); throw err; }
  });
  register('buckets', async (req) => media.buckets(endpoints.buckets.query.parse(req.query), mediaContext(req)));
  register('randomMedia', async (req) => {
    const query = endpoints.randomMedia.query.parse(req.query);
    if (query.exclude && query.exclude.length > 500) fail(400, 'VALIDATION', '排除的媒体不能超过 500 个');
    return media.random(query, mediaContext(req));
  });
  type BinaryRow = { id: string; name: string; relative_path: string; folder: string; mime: string; media_type: string; root: string; size: number; modified_at: number; width: number | null; height: number | null };
  async function binaryMedia(req: FastifyRequest, id: string): Promise<{ row: BinaryRow; filename: string }> {
    const identity = requireUser(req);
    const row = db.prepare(`SELECT f.id,f.name,f.relative_path,f.folder,f.mime,f.media_type,f.size,f.modified_at,f.width,f.height,l.root FROM files f
      JOIN libraries l ON l.id=f.library_id WHERE f.id=? AND l.enabled=1`).get(id) as BinaryRow | undefined;
    const allowed = userOut(identity.user).allowedPaths;
    if (!row || !pathAllowed(row.folder, allowed)) return fail(404, 'NOT_FOUND', '媒体不存在或不可访问');
    let filename: string;
    try { filename = await secureMediaPath(row.root, row.relative_path); }
    catch { return fail(404, 'NOT_FOUND', '媒体不可访问'); }
    return { row, filename };
  }
  const cacheDir = options.cacheDir ?? path.resolve(process.env.CACHE_DIR ?? 'cache');
  const exists = async (filename: string) => { try { await access(filename); return true; } catch { return false; } };
  async function cachedMedia(req: FastifyRequest, reply: FastifyReply, row: BinaryRow, variant: Variant, wait: boolean) {
    const filename = cachePath(cacheDir, row, variant);
    if (!await exists(filename)) {
      const jobId = enqueueMediaTask(db, row, variant);
      if (wait) {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !req.raw.aborted) {
          await delay(50);
          if (await exists(filename)) break;
          const job = db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId) as { status: string } | undefined;
          if (!job || job.status === 'failed' || job.status === 'cancelled') return fail(404, 'NOT_FOUND', '媒体缓存生成失败');
        }
      }
      if (!await exists(filename)) return reply.header('Retry-After', '1').code(202).send({ status: 'pending' });
    }
    const touched = Date.now();
    db.prepare('UPDATE cache_entries SET last_access_at=? WHERE cache_key=? AND last_access_at<?')
      .run(touched, cacheKey(row, variant), touched - 60_000);
    return sendFile(req, reply, filename, { mime: 'image/webp', name: row.name, etagKey: cacheKey(row, variant) });
  }
  app.get('/api/v2/media/:id/:resource', async (req, reply) => {
    const { id, resource } = req.params as { id: string; resource: string };
    if (!['original', 'display', 'thumb', 'tiles.dzi'].includes(resource)) return fail(404, 'NOT_FOUND', '媒体资源不存在');
    const { row, filename } = await binaryMedia(req, id);
    if (resource === 'thumb') {
      const parsed = (req.query as { size?: string }).size ?? 'm';
      if (parsed !== 's' && parsed !== 'm' && parsed !== 'l') return fail(400, 'VALIDATION', '缩略图尺寸无效');
      return cachedMedia(req, reply, row, { kind: 'thumb', size: parsed }, true);
    }
    if (resource === 'tiles.dzi') {
      if (row.media_type !== 'image') return fail(404, 'NOT_FOUND', '媒体不支持深度缩放');
      if (!row.width || !row.height) {
        enqueueMediaTask(db, row, { kind: 'dimensions' });
        return reply.header('Retry-After', '1').code(202).send({ status: 'pending' });
      }
      if (Math.max(row.width, row.height) <= 8192) return fail(404, 'NOT_FOUND', '媒体不支持深度缩放');
      return reply.type('application/xml; charset=utf-8').send(`<?xml version="1.0" encoding="UTF-8"?><Image TileSize="256" Overlap="0" Format="webp" Url="/api/v2/media/${encodeURIComponent(id)}/tiles/" xmlns="http://schemas.microsoft.com/deepzoom/2008"><Size Width="${row.width}" Height="${row.height}"/></Image>`);
    }
    if (resource === 'display') {
      if (row.media_type !== 'image') return fail(404, 'NOT_FOUND', '媒体不支持图像显示');
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'].includes(row.mime))
        return cachedMedia(req, reply, row, { kind: 'display' }, false);
    }
    const download = resource === 'original' && (req.query as { download?: string }).download === '1';
    return sendFile(req, reply, filename, { mime: row.mime, name: row.name, download, etagKey: row.id });
  });
  app.get('/api/v2/media/:id/tiles/:level/:tile', async (req, reply) => {
    const { id, level: rawLevel, tile } = req.params as { id: string; level: string; tile: string };
    const match = /^(\d+)_(\d+)\.webp$/.exec(tile);
    if (!match || !/^\d+$/.test(rawLevel)) return fail(404, 'NOT_FOUND', '瓦片不存在');
    const level = Number(rawLevel); const col = Number(match[1]); const tileRow = Number(match[2]);
    const { row } = await binaryMedia(req, id);
    if (row.media_type === 'image' && (!row.width || !row.height)) {
      enqueueMediaTask(db, row, { kind: 'dimensions' });
      return reply.header('Retry-After', '1').code(202).send({ status: 'pending' });
    }
    if (!row.width || !row.height || Math.max(row.width, row.height) <= 8192 || !Number.isSafeInteger(level) || !Number.isSafeInteger(col) || !Number.isSafeInteger(tileRow))
      return fail(404, 'NOT_FOUND', '瓦片不存在');
    const maxLevel = Math.ceil(Math.log2(Math.max(row.width, row.height)));
    if (level > maxLevel) return fail(404, 'NOT_FOUND', '瓦片不存在');
    const scale = 2 ** (maxLevel - level);
    if (col * 256 >= Math.ceil(row.width / scale) || tileRow * 256 >= Math.ceil(row.height / scale)) return fail(404, 'NOT_FOUND', '瓦片不存在');
    return cachedMedia(req, reply, row, { kind: 'tile', level, col, row: tileRow }, false);
  });
  type LibraryRow = { id: string; name: string; root: string; enabled: number; status: string; last_scan_at: number | null; host_root: string | null; host_root_source: 'auto' | 'manual' | null; exclude: string; media_count: number };
  const librarySql = 'SELECT l.*,COALESCE(f.media_count,0) AS media_count FROM libraries l LEFT JOIN folders f ON f.path=l.id';
  const libraryOut = (row: LibraryRow) => ({ id: row.id, name: row.name, root: row.root, enabled: !!row.enabled,
    status: row.status, lastScanAt: iso(row.last_scan_at), hostRoot: row.host_root, hostRootSource: row.host_root_source,
    exclude: JSON.parse(row.exclude), mediaCount: row.media_count });
  register('listLibraries', async () => ({ libraries: (db.prepare(`${librarySql} ORDER BY l.name COLLATE NOCASE,l.id`).all() as LibraryRow[]).map(libraryOut) }));
  register('createLibrary', async (_req, _reply, body) => {
    const resolved = await findRoot(body.root);
    if (db.prepare('SELECT 1 FROM libraries WHERE root=?').get(resolved.root)) fail(409, 'CONFLICT', '媒体库已经存在');
    const id = randomUUID();
    const manual = typeof body.hostRoot === 'string';
    db.prepare('INSERT INTO libraries(id,name,root,enabled,host_root,host_root_source,exclude) VALUES (?,?,?,?,?,?,?)')
      .run(id, body.name, resolved.root, body.enabled ? 1 : 0, manual ? body.hostRoot : resolved.hostRoot,
        manual ? 'manual' : resolved.hostRoot ? 'auto' : null, JSON.stringify(body.exclude ?? ['@eaDir', '#recycle', '.*', '.thumbnails']));
    return libraryOut(db.prepare(`${librarySql} WHERE l.id=?`).get(id) as LibraryRow);
  });
  register('updateLibrary', async (req, _reply, body) => {
    const { id } = req.params as { id: string };
    const row = (db.prepare(`${librarySql} WHERE l.id=?`).get(id) as LibraryRow | undefined) ?? fail(404, 'NOT_FOUND', '媒体库不存在');
    let hostRoot = row.host_root; let source = row.host_root_source;
    if (body.hostRoot !== undefined) {
      if (body.hostRoot === null) {
        try { hostRoot = (await findRoot(row.root)).hostRoot; } catch (error) { if (!(error instanceof HttpError)) throw error; hostRoot = null; }
        source = hostRoot ? 'auto' : null;
      } else { hostRoot = body.hostRoot; source = 'manual'; }
    }
    db.prepare('UPDATE libraries SET name=?,enabled=?,host_root=?,host_root_source=?,exclude=? WHERE id=?')
      .run(body.name ?? row.name, body.enabled === undefined ? row.enabled : body.enabled ? 1 : 0, hostRoot, source,
        body.exclude === undefined ? row.exclude : JSON.stringify(body.exclude), id);
    return libraryOut(db.prepare(`${librarySql} WHERE l.id=?`).get(id) as LibraryRow);
  });
  register('deleteLibrary', async (req) => {
    const { id } = req.params as { id: string };
    if (!db.prepare('DELETE FROM libraries WHERE id=?').run(id).changes) fail(404, 'NOT_FOUND', '媒体库不存在');
  });
  register('mounts', async () => {
    const libraries = db.prepare('SELECT id,root FROM libraries').all() as { id: string; root: string }[];
    const estimateRow = db.prepare("SELECT value FROM settings WHERE key='mount.estimates'").get() as { value: string } | undefined;
    const estimates = estimateRow ? JSON.parse(estimateRow.value) as Record<string, number | null> : {};
    return { mounts: (await getMounts()).map((mount) => {
      const library = libraries.find((entry) => entry.root === mount.containerPath);
      const mediaEstimate = Number.isSafeInteger(estimates[mount.containerPath]) && estimates[mount.containerPath]! >= 0 ? estimates[mount.containerPath] : null;
      return library && mount.kind === 'candidate' ? { ...mount, kind: 'library', libraryId: library.id, mediaEstimate } : { ...mount, mediaEstimate };
    }) };
  });
  register('fsList', async (req) => {
    const query = endpoints.fsList.query.parse(req.query);
    if (!query.path) return { path: '', parent: null, dirs: (await getMounts()).filter((entry) => entry.kind === 'candidate').map((entry) => ({ name: path.basename(entry.containerPath), path: entry.containerPath })) };
    const root = await findRoot(query.path);
    const entries = await readdir(root.root, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => ({ name: entry.name, path: path.join(root.root, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    let parent: string | null = path.dirname(root.root);
    try { await findRoot(parent); } catch { parent = null; }
    return { path: root.root, parent, dirs };
  });
  register('getSettings', async () => readSettings(db));
  register('updateSettings', async (_req, _reply, body) => writeSettings(db, body));
  register('listJobs', async (req) => {
    const query = endpoints.listJobs.query.parse(req.query);
    const rows = db.prepare(`SELECT * FROM jobs WHERE (? IS NULL OR status=?)
      ORDER BY CASE WHEN status IN ('running','queued') THEN 0 ELSE 1 END, created_at DESC, id DESC LIMIT ?`)
      .all(query.status ?? null, query.status ?? null, query.limit) as JobRecord[];
    return { jobs: rows.map(jobView) };
  });
  register('createJob', async (_req, _reply, body) => {
    if (body.libraryId && !db.prepare('SELECT 1 FROM libraries WHERE id=?').get(body.libraryId)) fail(404, 'NOT_FOUND', '媒体库不存在');
    const labels: Record<string, string> = { scan: '扫描媒体库', metadata: '提取元数据', thumbnails: '生成缩略图', previews: '生成预览', health_check: '健康检查', cache_prune: '清理缓存', import_legacy: '导入旧版数据' };
    const id = randomUUID();
    return db.transaction(() => {
      const inserted = db.prepare("INSERT OR IGNORE INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES (?,?,?,'queued','manual',?,?,?)")
        .run(id, body.type, labels[body.type], JSON.stringify({ libraryId: body.libraryId ?? null }), now(), body.type === 'cache_prune' ? 'system:cache-prune' : null);
      if (!inserted.changes) fail(409, 'CONFLICT', '相同作业已在队列中');
      publishJob(db, id);
      return jobView(db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRecord);
    }).immediate();
  });
  register('jobAction', async (req) => {
    const { id, action: rawAction } = req.params as { id: string; action: string };
    const action = JobAction.parse(rawAction);
    return db.transaction(() => {
      const row = (db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRecord | undefined) ?? fail(404, 'NOT_FOUND', '作业不存在');
      const transitions: Record<string, Record<string, string>> = {
        pause: { queued: 'paused', running: 'paused' }, resume: { paused: 'queued' },
        cancel: { queued: 'cancelled', running: 'cancelled', paused: 'cancelled' }, retry: { failed: 'queued', cancelled: 'queued' },
      };
      const next = transitions[action]?.[row.status];
      if (!next) fail(409, 'CONFLICT', '当前状态不支持该操作');
      db.prepare('UPDATE jobs SET status=?,owner=NULL,heartbeat_at=NULL,lease_expires_at=NULL,finished_at=? WHERE id=?')
        .run(next, next === 'cancelled' ? now() : null, id);
      publishJob(db, id);
      return jobView(db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRecord);
    }).immediate();
  });
  register('system', async () => {
    const row = db.prepare("SELECT value FROM settings WHERE key='worker.ffmpeg'").get() as { value: string } | undefined;
    const ffmpeg = row ? JSON.parse(row.value) : { available: false, version: null, hwaccels: [] };
    const sqlite = db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
    return { version: '2.0.0-alpha.0', commit: null, node: process.version, platform: `${process.platform}-${process.arch}`, sqlite: sqlite.version,
      ffmpeg, sharp: { version: sharp.versions.sharp, heif: sharp.format.heif?.input?.fileSuffix?.includes('.heic') ?? false },
      dataDir: path.resolve(process.env.DATA_DIR ?? 'data'), cacheDir: path.resolve(process.env.CACHE_DIR ?? 'cache') };
  });
  app.get('/api/v2/events', async (req, reply) => {
    const identity = requireUser(req);
    if (identity.scope === 'wallpaper') fail(403, 'FORBIDDEN', '令牌权限不足');
    const last = req.headers['last-event-id'];
    let cursor = typeof last === 'string' && /^\d{1,15}$/.test(last) ? Number(last) :
      (db.prepare('SELECT COALESCE(max(id),0) AS n FROM job_events').get() as { n: number }).n;
    reply.hijack();
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    reply.raw.write(': connected\n\n');
    let lastPing = Date.now();
    let waitingDrain = false;
    const send = (value: string) => {
      if (!reply.raw.write(value)) {
        waitingDrain = true;
        reply.raw.once('drain', () => { waitingDrain = false; });
      }
    };
    const timer = setInterval(() => {
      try {
        const current = authenticate(req);
        if (!current) {
          reply.raw.write('event: session\ndata: {"reason":"revoked"}\n\n');
          clearInterval(timer); reply.raw.end(); return;
        }
        if (waitingDrain) return;
        const records = db.prepare('SELECT id,event_type,payload FROM job_events WHERE id>? ORDER BY id LIMIT 256').all(cursor) as { id: number; event_type: string; payload: string }[];
        for (const record of records) {
          cursor = record.id;
          if (record.event_type === 'job' && (current.kind !== 'session' || current.user.role !== 'admin')) continue;
          if (record.event_type === 'library') {
            const event = JSON.parse(record.payload) as { folders: string[]; added: number; removed: number; updated: number };
            const allowed = userOut(current.user).allowedPaths;
            if (allowed !== null && event.folders.length) {
              event.folders = event.folders.filter((folder) => pathAllowed(folder, allowed));
              if (!event.folders.length) continue;
            }
            send(`id: ${record.id}\nevent: library\ndata: ${JSON.stringify(event)}\n\n`);
          } else if (record.event_type === 'job') send(`id: ${record.id}\nevent: job\ndata: ${record.payload}\n\n`);
          if (waitingDrain) break;
        }
        if (!waitingDrain && Date.now() - lastPing >= 25_000) { send(': ping\n\n'); lastPing = Date.now(); }
      } catch { clearInterval(timer); reply.raw.end(); }
    }, 250);
    timer.unref();
    reply.raw.on('close', () => clearInterval(timer));
  });
  return app;
}
