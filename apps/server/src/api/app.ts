import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { constants } from 'node:fs';
import { access, realpath, stat, lstat, readdir, open as openFile } from 'node:fs/promises';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import jwt from 'jsonwebtoken';
import { ZipArchive } from 'archiver';
import { ZodError } from 'zod';
import { CSRF_HEADER, endpoints, JobAction, MediaListQuery, Preferences, RandomQuery, ShareTarget, WallpaperConfig, defaultPreferences } from '@luvia/contracts';
import type { User } from '@luvia/contracts';
import { hashPassword, verifyPassword } from '../core/password.ts';
import { MediaReader } from '../core/media-query.ts';
import { QueryExecutor } from '../core/query-executor.ts';
import { legacyPage } from '../core/legacy-query.ts';
import type { LegacyRow } from '../core/legacy-query.ts';
import { Observability } from '../core/observability.ts';
import { noteThumbnail } from '../core/folder-covers.ts';
import { ensureHls, hlsCacheKey, hlsDirectory, hlsId } from '../core/hls.ts';
import type { HlsSession } from '../core/hls.ts';
import { FolderReader } from '../core/folder-reader.ts';
import { mediaId, pathAllowed, secureMediaPath, virtualPath } from '../core/paths.ts';
import { sendFile } from './binary.ts';
import { jobView, publishJob } from '../core/job-view.ts';
import type { JobRecord } from '../core/job-view.ts';
import { detectMounts } from '../core/mounts.ts';
import type { Mount } from '../core/mounts.ts';
import { readSettings, writeSettings } from '../core/settings.ts';
import { cacheKey, cachePath, enqueueMediaTask, releaseMediaWaiter } from '../core/media-cache.ts';
import type { Variant } from '../core/media-cache.ts';

type UserRow = {
  id: string; username: string; password_hash: string; role: 'admin' | 'user';
  allowed_paths: string | null; preferences: string; created_at: number; last_login_at: number | null;
};
type TokenRow = {
  id: string; name: string; scope: 'read' | 'wallpaper'; prefix: string;
  created_at: number; last_used_at: number | null; expires_at: number | null; wallpaper: string | null;
};
type Identity = { user: UserRow; kind: 'session' | 'token' | 'legacy'; scope?: string; sessionHash?: string; tokenHash?: string; wallpaper?: string | null };
type Options = { db: Database.Database; legacyPending: boolean | (() => boolean); secureCookies?: boolean; mounts?: () => Promise<Mount[]>; systemRoots?: string[]; cacheDir?: string; staticDir?: string; legacyJwtSecret?: string };
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
  const app = Fastify({ logger: false, routerOptions: { maxParamLength: 8192 } });
  await app.register(cookie);
  const identities = new WeakMap<FastifyRequest, Identity>();
  const queries = new QueryExecutor(db);
  const media = new MediaReader(db, queries);
  const observability = new Observability(db);
  app.addHook('onClose', async () => { await queries.close(); });
  app.addHook('onClose', async () => { observability.close(); });
  app.addHook('onResponse', async (req, reply) => {
    observability.record(reply.elapsedTime);
    if (reply.statusCode >= 500) observability.logger.error({ ctx: { method: req.method, route: req.routeOptions.url ?? 'unknown', status: reply.statusCode } }, '请求处理失败');
  });
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
  const isLegacyPath = (pathname: string) => pathname === '/api/scan/results' || pathname === '/api/library/folders' || pathname.startsWith('/api/thumb/') || pathname.startsWith('/api/file/');

  function tokenIdentity(value: string, legacy: boolean): Identity | undefined {
    if (!value || value.length > 4096) return undefined;
    const row = db.prepare(`SELECT u.*, t.scope AS token_scope, t.wallpaper AS token_wallpaper,t.legacy_jwt AS token_legacy_jwt FROM api_tokens t JOIN users u ON u.id=t.user_id
      WHERE t.token_hash=? AND (t.expires_at IS NULL OR t.expires_at>?)`).get(digest(value), now()) as (UserRow & { token_scope: string; token_wallpaper: string | null; token_legacy_jwt: number }) | undefined;
    if (row) {
      if (row.token_legacy_jwt) {
        if (!options.legacyJwtSecret) return undefined;
        try {
          const decoded = jwt.verify(value, options.legacyJwtSecret, { algorithms: ['HS256'] });
          if (typeof decoded !== 'object' || decoded.isWallpaper !== true || decoded.username !== row.username || !Number.isSafeInteger(decoded.exp)) return undefined;
        } catch { return undefined; }
      }
      return { user: row, kind: 'token', scope: row.token_scope, tokenHash: digest(value), wallpaper: row.token_wallpaper };
    }
    if (legacy && options.legacyJwtSecret) {
      try {
        const decoded = jwt.verify(value, options.legacyJwtSecret, { algorithms: ['HS256'] });
        if (typeof decoded !== 'object' || typeof decoded.username !== 'string' || decoded.isWallpaper === true) return undefined;
        const user = typeof decoded.sub === 'string'
          ? db.prepare(`SELECT u.* FROM users u JOIN legacy_jwt_sessions s ON s.user_id=u.id
              WHERE s.token_hash=? AND s.expires_at>? AND u.id=? AND u.username=?`).get(digest(value), now(), decoded.sub, decoded.username) as UserRow | undefined
          : db.prepare(`SELECT u.* FROM users u JOIN legacy_jwt_users legacy ON legacy.user_id=u.id
              WHERE u.username=? AND NOT EXISTS(SELECT 1 FROM legacy_jwt_revoked_users r WHERE r.username=u.username)`).get(decoded.username) as UserRow | undefined;
        return user ? { user, kind: 'legacy', scope: 'read', tokenHash: digest(value) } : undefined;
      } catch { return undefined; }
    }
    return undefined;
  }
  function authenticate(req: FastifyRequest): Identity | undefined {
    const auth = req.headers.authorization;
    if (auth) {
      const match = /^Bearer ([A-Za-z0-9._~+\/-]+={0,2})$/i.exec(auth);
      if (!match) return undefined;
      const pathname = new URL(req.raw.url ?? '/', 'http://localhost').pathname;
      return tokenIdentity(match[1]!, isLegacyPath(pathname));
    }
    const value = req.cookies.luvia_session;
    if (!value || value.length > 256) return undefined;
    const sessionHash = digest(value);
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>?`).get(sessionHash, now()) as UserRow | undefined;
    return row ? { user: row, kind: 'session', sessionHash } : undefined;
  }
  function authenticateRequest(req: FastifyRequest): Identity | undefined {
    const url = new URL(req.raw.url ?? '/', 'http://localhost');
    const queryTokens = isLegacyPath(url.pathname) ? url.searchParams.getAll('token') : [];
    return authenticate(req) ?? (queryTokens.length ? tokenIdentity(queryTokens.at(-1)!, true) : undefined);
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
  function revokeLegacyUser(id: string): void {
    db.prepare('INSERT OR IGNORE INTO legacy_jwt_revoked_users(username) SELECT username FROM users WHERE id=?').run(id);
    db.prepare('DELETE FROM legacy_jwt_users WHERE user_id=?').run(id);
    db.prepare('DELETE FROM legacy_jwt_sessions WHERE user_id=?').run(id);
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
    const identity = authenticateRequest(req);
    if (url.pathname.startsWith('/api/v2/') && req.method !== 'GET' && identity?.kind === 'session' && req.headers[CSRF_HEADER.toLowerCase()] !== '1') {
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
      revokeLegacyUser(identity.user.id);
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
  function requireCurrentAdmin(identity: Identity): void {
    if (identity.kind !== 'session' || !identity.sessionHash || !db.prepare(`SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.role='admin'`).get(identity.sessionHash, now())) {
      fail(403, 'FORBIDDEN', '需要管理员会话');
    }
  }
  function checkedAllowedPaths(paths: string[] | null): string | null {
    if (paths === null) return null;
    if (paths.some((value) => !pathAllowed(value, null))) return fail(400, 'VALIDATION', '目录权限路径无效');
    return JSON.stringify([...new Set(paths)]);
  }
  register('listUsers', async () => ({
    users: (db.prepare('SELECT * FROM users ORDER BY created_at, username').all() as UserRow[]).map(userOut),
  }));
  register('createUser', async (req, _reply, body) => {
    const identity = requireUser(req);
    const allowedPaths = checkedAllowedPaths(body.allowedPaths);
    const passwordHash = await hashPassword(body.password);
    const user: UserRow = {
      id: randomUUID(), username: body.username, password_hash: passwordHash, role: body.role,
      allowed_paths: body.role === 'admin' ? null : allowedPaths,
      preferences: JSON.stringify(defaultPreferences()), created_at: now(), last_login_at: null,
    };
    db.transaction(() => {
      requireCurrentAdmin(identity);
      if (findUser.get(user.username)) fail(409, 'CONFLICT', '用户名已经存在');
      db.prepare('INSERT INTO users (id,username,password_hash,role,allowed_paths,preferences,created_at,last_login_at) VALUES (@id,@username,@password_hash,@role,@allowed_paths,@preferences,@created_at,@last_login_at)').run(user);
    }).immediate();
    return userOut(user);
  });
  register('updateUser', async (req, _reply, body) => {
    const identity = requireUser(req);
    const { id } = req.params as { id: string };
    const allowedPaths = body.allowedPaths === undefined ? undefined : checkedAllowedPaths(body.allowedPaths);
    const passwordHash = body.password === undefined ? undefined : await hashPassword(body.password);
    return db.transaction(() => {
      requireCurrentAdmin(identity);
      const user = (db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow | undefined) ?? fail(404, 'NOT_FOUND', '用户不存在');
      const role = body.role ?? user.role;
      if (user.role === 'admin' && role !== 'admin' && (db.prepare("SELECT count(*) AS n FROM users WHERE role='admin'").get() as { n: number }).n <= 1) {
        fail(409, 'CONFLICT', '必须保留至少一名管理员');
      }
      user.role = role;
      user.allowed_paths = role === 'admin' ? null : (allowedPaths === undefined ? user.allowed_paths : allowedPaths);
      user.password_hash = passwordHash ?? user.password_hash;
      db.prepare('UPDATE users SET role=?, allowed_paths=?, password_hash=? WHERE id=?').run(user.role, user.allowed_paths, user.password_hash, id);
      if (passwordHash !== undefined) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); revokeLegacyUser(id); }
      return userOut(user);
    }).immediate();
  });
  register('deleteUser', async (req) => {
    const identity = requireUser(req);
    const { id } = req.params as { id: string };
    db.transaction(() => {
      requireCurrentAdmin(identity);
      const user = (db.prepare('SELECT * FROM users WHERE id=?').get(id) as UserRow | undefined) ?? fail(404, 'NOT_FOUND', '用户不存在');
      if (user.role === 'admin' && (db.prepare("SELECT count(*) AS n FROM users WHERE role='admin'").get() as { n: number }).n <= 1) {
        fail(409, 'CONFLICT', '必须保留至少一名管理员');
      }
      db.prepare('DELETE FROM users WHERE id=?').run(id);
    }).immediate();
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
  type AlbumRow = { id: string; user_id: string; name: string; description: string | null; kind: 'manual' | 'smart'; filter: string | null; cover_id: string | null; created_at: number; updated_at: number };
  const albumQuery = (id: string) => MediaListQuery.parse({ scope: 'album', albumId: id, limit: 1 });
  function ownedAlbum(id: string, userId: string): AlbumRow {
    return (db.prepare('SELECT * FROM albums WHERE id=? AND user_id=?').get(id, userId) as AlbumRow | undefined) ?? fail(404, 'NOT_FOUND', '相册不存在');
  }
  async function albumOut(row: AlbumRow, context: { id: string; allowedPaths: string[] | null }) {
    const query = albumQuery(row.id);
    const summary = await media.summary(query, context);
    const cover = row.cover_id && media.contains(query, context, row.cover_id) ? media.one(row.cover_id, context) : media.page(query, context).items[0] ?? null;
    return { id: row.id, name: row.name, description: row.description, kind: row.kind, filter: row.filter ? JSON.parse(row.filter) : null,
      count: summary.count, cover, startAt: iso(summary.start), endAt: iso(summary.end), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! };
  }
  function requireVisibleMedia(ids: string[], context: { id: string; allowedPaths: string[] | null }): void {
    const find = db.prepare('SELECT f.folder FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1 WHERE f.id=?');
    for (const id of ids) {
      const row = find.get(id) as { folder: string } | undefined;
      if (!row || !pathAllowed(row.folder, context.allowedPaths)) fail(403, 'FORBIDDEN', '媒体不可访问');
    }
  }
  register('listAlbums', async (req) => {
    const context = mediaContext(req);
    const rows = db.prepare('SELECT * FROM albums WHERE user_id=? ORDER BY updated_at DESC,id DESC').all(context.id) as AlbumRow[];
    const albums = [];
    for (let index = 0; index < rows.length; index += 32) albums.push(...await Promise.all(rows.slice(index, index + 32).map((row) => albumOut(row, context))));
    return { albums };
  });
  register('createAlbum', async (req, _reply, body) => {
    const context = mediaContext(req);
    const ids = [...new Set((body.ids ?? []) as string[])];
    if (body.kind === 'smart' && ids.length) fail(400, 'VALIDATION', '智能相册不能手动加入媒体');
    if (body.kind === 'manual' && body.filter != null) fail(400, 'VALIDATION', '手动相册不能设置筛选条件');
    const id = randomUUID(); const timestamp = now();
    db.transaction(() => {
      requireVisibleMedia(ids, context);
      db.prepare('INSERT INTO albums(id,user_id,name,description,kind,filter,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, context.id, body.name, body.description ?? null, body.kind, body.filter == null ? null : JSON.stringify(body.filter), timestamp, timestamp);
      const add = db.prepare('INSERT INTO album_items(album_id,file_id,created_at) VALUES (?,?,?)');
      for (const mediaId of ids) add.run(id, mediaId, timestamp);
    }).immediate();
    return albumOut(ownedAlbum(id, context.id), context);
  });
  register('getAlbum', async (req) => {
    const context = mediaContext(req); const { id } = req.params as { id: string };
    return albumOut(ownedAlbum(id, context.id), context);
  });
  register('updateAlbum', async (req, _reply, body) => {
    const context = mediaContext(req); const { id } = req.params as { id: string };
    db.transaction(() => {
      const row = ownedAlbum(id, context.id);
      if (row.kind === 'manual' && body.filter != null) fail(400, 'VALIDATION', '手动相册不能设置筛选条件');
      const filter = body.filter === undefined ? row.filter : body.filter === null ? null : JSON.stringify(body.filter);
      db.prepare('UPDATE albums SET name=?,description=?,filter=?,updated_at=? WHERE id=? AND user_id=?')
        .run(body.name ?? row.name, body.description === undefined ? row.description : body.description, filter, now(), id, context.id);
      if (body.coverId !== undefined) {
        if (body.coverId !== null && !media.contains(albumQuery(id), context, body.coverId)) fail(403, 'FORBIDDEN', '封面不属于可访问的相册');
        db.prepare('UPDATE albums SET cover_id=? WHERE id=? AND user_id=?').run(body.coverId, id, context.id);
      }
    }).immediate();
    return albumOut(ownedAlbum(id, context.id), context);
  });
  register('deleteAlbum', async (req) => {
    const context = mediaContext(req); const { id } = req.params as { id: string };
    if (!db.prepare('DELETE FROM albums WHERE id=? AND user_id=?').run(id, context.id).changes) fail(404, 'NOT_FOUND', '相册不存在');
  });
  function changeAlbumItems(req: FastifyRequest, ids: string[], add: boolean) {
    const context = mediaContext(req); const { id } = req.params as { id: string };
    return db.transaction(() => {
      const album = ownedAlbum(id, context.id);
      if (album.kind !== 'manual') fail(409, 'CONFLICT', '智能相册不能手动修改媒体');
      const unique = [...new Set(ids)]; requireVisibleMedia(unique, context);
      const change = db.prepare(add ? 'INSERT OR IGNORE INTO album_items(album_id,file_id,created_at) VALUES (?,?,?)' : 'DELETE FROM album_items WHERE album_id=? AND file_id=?');
      let updated = 0;
      for (const mediaId of unique) updated += Number((add ? change.run(id, mediaId, now()) : change.run(id, mediaId)).changes);
      if (!add && album.cover_id && unique.includes(album.cover_id)) db.prepare('UPDATE albums SET cover_id=NULL WHERE id=?').run(id);
      if (updated) db.prepare('UPDATE albums SET updated_at=? WHERE id=?').run(now(), id);
      return { updated };
    }).immediate();
  }
  register('addAlbumItems', async (req, _reply, body) => changeAlbumItems(req, body.ids, true));
  register('removeAlbumItems', async (req, _reply, body) => changeAlbumItems(req, body.ids, false));
  register('setFavorite', async (req, _reply, body) => {
    const context = mediaContext(req);
    const ids = [...new Set(body.ids as string[])];
    const find = db.prepare('SELECT f.folder FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1 WHERE f.id=?');
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
  register('facets', async (req) => media.facets(endpoints.facets.query.parse(req.query), mediaContext(req)));
  register('memories', async (req) => media.memories(mediaContext(req)));
  register('suggest', async (req) => {
    const { q } = endpoints.suggest.query.parse(req.query);
    const context = mediaContext(req);
    const escaped = q.replace(/[\\%_]/g, '\\$&');
    const rows = db.prepare("SELECT * FROM albums WHERE user_id=? AND name LIKE ? ESCAPE '\\' ORDER BY updated_at DESC,id DESC LIMIT 10")
      .all(context.id, `%${escaped}%`) as AlbumRow[];
    const [suggestions, albums] = await Promise.all([media.suggest(q, context), Promise.all(rows.map((row) => albumOut(row, context)))]);
    return { ...suggestions, albums: albums.map(({ id, name, count }) => ({ id, name, count })) };
  });
  register('randomMedia', async (req) => {
    const query = endpoints.randomMedia.query.parse(req.query);
    if (query.exclude && query.exclude.length > 500) fail(400, 'VALIDATION', '排除的媒体不能超过 500 个');
    return media.random(query, mediaContext(req));
  });
  register('mediaDetail', async (req) => {
    const context = mediaContext(req); const { id } = req.params as { id: string };
    const item = media.one(id, context) ?? fail(404, 'NOT_FOUND', '媒体不存在或不可访问');
    const row = db.prepare(`SELECT f.*,l.name AS library_name FROM files f JOIN libraries l ON l.id=f.library_id
      WHERE f.id=? AND l.enabled=1`).get(id) as Record<string, any> | undefined;
    if (!row) return fail(404, 'NOT_FOUND', '媒体不存在或不可访问');
    const exif = { make: row.make, model: row.model, lens: row.lens, fNumber: row.f_number, exposureTime: row.exposure_time,
      iso: row.iso, focalLength: row.focal_length, focalLength35: row.focal_length35, software: row.software };
    const video = { codec: row.codec, audioCodec: row.audio_codec, container: row.container, fps: row.fps, bitrate: row.bitrate };
    const parts = item.folder.split('/');
    return { ...item,
      exif: item.mediaType === 'image' && Object.values(exif).some((value) => value !== null) ? exif : null,
      location: row.latitude !== null && row.longitude !== null ? { lat: row.latitude, lon: row.longitude, altitude: row.altitude } : null,
      video: item.mediaType === 'video' && Object.values(video).some((value) => value !== null) ? video : null,
      libraryName: row.library_name,
      breadcrumbs: parts.map((part, index) => ({ name: index === 0 ? row.library_name : part, path: parts.slice(0, index + 1).join('/') })),
      albumIds: (db.prepare(`SELECT ai.album_id FROM album_items ai JOIN albums a ON a.id=ai.album_id
        WHERE ai.file_id=? AND a.user_id=? AND a.kind='manual' ORDER BY ai.album_id`).all(id, context.id) as { album_id: string }[]).map((album) => album.album_id),
    };
  });
  type BinaryRow = { id: string; name: string; relative_path: string; folder: string; mime: string; media_type: string; root: string; size: number; modified_at: number; width: number | null; height: number | null };
  async function binaryMediaFor(context: { id: string; allowedPaths: string[] | null; ids?: string[] }, id: string): Promise<{ row: BinaryRow; filename: string }> {
    const row = db.prepare(`SELECT f.id,f.name,f.relative_path,f.folder,f.mime,f.media_type,f.size,f.modified_at,f.width,f.height,l.root FROM files f
      JOIN libraries l ON l.id=f.library_id WHERE f.id=? AND l.enabled=1`).get(id) as BinaryRow | undefined;
    if (!row || !pathAllowed(row.folder, context.allowedPaths) || context.ids && !context.ids.includes(id)) return fail(404, 'NOT_FOUND', '媒体不存在或不可访问');
    let filename: string;
    try { filename = await secureMediaPath(row.root, row.relative_path); }
    catch { return fail(404, 'NOT_FOUND', '媒体不可访问'); }
    return { row, filename };
  }
  async function binaryMedia(req: FastifyRequest, id: string) {
    const result = await binaryMediaFor(mediaContext(req), id);
    mediaAuthorization(req, result.row)();
    return result;
  }
  const cacheDir = options.cacheDir ?? path.resolve(process.env.CACHE_DIR ?? 'cache');
  const exists = async (filename: string) => { try { await access(filename); return true; } catch { return false; } };
  async function legacyThumbnail(row: BinaryRow): Promise<string | undefined> {
    const source = path.join(row.root, row.relative_path);
    const hash = createHash('md5').update(Buffer.from(source).toString('base64')).digest('hex');
    const filename = path.join(cacheDir, hash.slice(0, 2), hash.slice(2, 4), `${hash}.webp`);
    try {
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.mtimeMs < row.modified_at * 1000) return undefined;
      const [root, actual] = await Promise.all([realpath(cacheDir), realpath(filename)]);
      const relative = path.relative(root, actual);
      return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? actual : undefined;
    } catch { return undefined; }
  }
  async function cachedMedia(req: FastifyRequest, reply: FastifyReply, row: BinaryRow, variant: Variant, wait: boolean, authorize?: () => unknown) {
    const filename = cachePath(cacheDir, row, variant);
    if (!await exists(filename)) {
      if (variant.kind === 'thumb' && variant.size === 'm') {
        const previous = await legacyThumbnail(row);
        if (previous) {
          authorize?.();
          enqueueMediaTask(db, row, variant);
          return sendFile(req, reply, previous, { mime: 'image/webp', name: row.name, etagKey: `legacy:${cacheKey(row, variant)}`, authorize });
        }
      }
      const waiter = wait ? randomUUID() : undefined;
      const jobId = enqueueMediaTask(db, row, variant, { waiter });
      if (wait) {
        let disconnected = false; let released = false; let ready = false; let renewal = Date.now() + 5000;
        const release = (cancel: boolean) => {
          if (released) return;
          released = true;
          try { releaseMediaWaiter(db, jobId, waiter!, cancel); } catch { /* 服务关闭时数据库可能已关闭。 */ }
        };
        const close = () => { if (!reply.raw.writableFinished) { disconnected = true; release(true); } };
        reply.raw.once('close', close);
        try {
          const deadline = Date.now() + 120_000;
          while (Date.now() < deadline && !req.raw.aborted && !disconnected) {
            await delay(50);
            if (await exists(filename)) { ready = true; break; }
            const job = db.prepare('SELECT status FROM jobs WHERE id=?').get(jobId) as { status: string } | undefined;
            if (!job || job.status === 'failed' || job.status === 'cancelled') return fail(404, 'NOT_FOUND', '媒体缓存生成失败');
            if (Date.now() >= renewal) {
              db.prepare('UPDATE media_waiters SET lease_expires_at=unixepoch()+30 WHERE id=? AND job_id=?').run(waiter, jobId);
              renewal = Date.now() + 5000;
            }
          }
          if (disconnected || req.raw.aborted) return reply;
          if (!ready) return fail(404, 'NOT_FOUND', '媒体缓存生成超时');
        } finally {
          reply.raw.off('close', close);
          release(!ready);
        }
      }
      if (!await exists(filename)) { authorize?.(); return reply.header('Retry-After', '1').code(202).send({ status: 'pending' }); }
    }
    authorize?.();
    const touched = Date.now();
    const key = cacheKey(row, variant);
    const recorded = db.prepare('SELECT source_size,source_modified FROM cache_entries WHERE cache_key=?').get(key) as { source_size: number | null; source_modified: number | null } | undefined;
    if (!recorded || recorded.source_size !== row.size || recorded.source_modified !== row.modified_at) {
      let info;
      try { info = await lstat(filename); } catch { return fail(404, 'NOT_FOUND', '媒体缓存不可访问'); }
      if (!info.isFile() || info.isSymbolicLink()) return fail(404, 'NOT_FOUND', '媒体缓存不可访问');
      authorize?.();
      db.prepare(`INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at,media_id,variant,source_size,source_modified) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(cache_key) DO UPDATE SET bytes=excluded.bytes,last_access_at=excluded.last_access_at,media_id=excluded.media_id,variant=excluded.variant,source_size=excluded.source_size,source_modified=excluded.source_modified`)
        .run(key, path.relative(cacheDir, filename), info.size, touched, row.id, variant.kind, row.size, row.modified_at);
    } else db.prepare('UPDATE cache_entries SET last_access_at=? WHERE cache_key=? AND last_access_at<?').run(touched, key, touched - 60_000);
    if (variant.kind === 'thumb') db.transaction(() => {
      const changed = db.prepare('UPDATE files SET thumb_ready=1,thumb_version=CASE WHEN thumb_version=0 THEN 1 ELSE thumb_version END WHERE id=? AND size=? AND modified_at=? AND thumb_ready=0')
        .run(row.id, row.size, row.modified_at);
      if (changed.changes) noteThumbnail(db, row.id);
    }).immediate();
    return sendFile(req, reply, filename, { mime: 'image/webp', name: row.name, etagKey: key, authorize });
  }
  function identityPrincipal(identity: Identity): string {
    const key = identity.kind === 'session' ? identity.sessionHash : identity.tokenHash;
    if (!key) return fail(401, 'UNAUTHORIZED', '需要有效会话或令牌');
    return digest(`${identity.kind}:${key}`);
  }
  function mediaAuthorization(req: FastifyRequest, row: BinaryRow): () => void {
    const principal = identityPrincipal(requireUser(req));
    return () => {
      const current = authenticateRequest(req) ?? fail(401, 'UNAUTHORIZED', '会话已失效');
      if (identityPrincipal(current) !== principal || !pathAllowed(row.folder, userOut(current.user).allowedPaths) ||
        !db.prepare(`SELECT 1 FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1
          WHERE f.id=? AND f.folder=? AND f.size=? AND f.modified_at=?`).get(row.id, row.folder, row.size, row.modified_at)) {
        fail(404, 'NOT_FOUND', '媒体不可访问');
      }
    };
  }
  async function hlsResponse(req: FastifyRequest, reply: FastifyReply, row: BinaryRow, principal: string, resource: string, authorize: () => unknown) {
    if (resource !== 'index.m3u8' && !/^seg-\d{6}\.ts$/.test(resource)) return fail(404, 'NOT_FOUND', 'HLS 资源不存在');
    const current = db.prepare('SELECT playability FROM files WHERE id=?').get(row.id) as { playability: string | null } | undefined;
    if (row.media_type !== 'video' || current?.playability !== 'transcode' || !readSettings(db).transcode.enabled) return fail(404, 'NOT_FOUND', '视频不需要转码或转码已关闭');
    const id = hlsId(row, principal);
    let session = resource === 'index.m3u8' ? ensureHls(db, row, principal)
      : db.prepare('SELECT * FROM hls_sessions WHERE id=? AND principal_hash=?').get(id, principal) as HlsSession | undefined;
    if (!session) return fail(404, 'NOT_FOUND', 'HLS 会话不存在');
    db.prepare('UPDATE hls_sessions SET last_access_at=? WHERE id=? AND principal_hash=?').run(Date.now(), id, principal);
    if (!session.generation) return resource === 'index.m3u8' ? reply.header('Retry-After', '1').code(202).send({ status: 'pending' }) : fail(404, 'NOT_FOUND', 'HLS 分片尚未就绪');
    const filename = path.join(hlsDirectory(cacheDir, id, session.generation), resource);
    let info;
    try { info = await lstat(filename); } catch {
      authorize();
      if (resource !== 'index.m3u8') return fail(404, 'NOT_FOUND', 'HLS 分片尚未就绪');
      if (session.state === 'ready') {
        db.prepare("UPDATE hls_sessions SET state='failed' WHERE id=? AND state='ready' AND generation=?").run(id, session.generation);
        session = ensureHls(db, row, principal);
      }
      return reply.header('Retry-After', '1').code(202).send({ status: 'pending' });
    }
    if (!info.isFile() || info.isSymbolicLink()) return fail(404, 'NOT_FOUND', 'HLS 资源不可访问');
    authorize();
    const generation = session.generation;
    db.transaction(() => {
      const active = db.prepare('SELECT 1 FROM hls_sessions WHERE id=? AND principal_hash=? AND generation=?').get(id, principal, generation);
      if (!active) fail(404, 'NOT_FOUND', 'HLS 会话已经变化');
      const touched = Date.now();
      db.prepare('UPDATE hls_sessions SET last_access_at=? WHERE id=? AND principal_hash=?').run(touched, id, principal);
      db.prepare(`INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at,media_id,variant,source_size,source_modified,hls_session_id)
        VALUES (?,?,?,?,?,'hls',?,?,?) ON CONFLICT(cache_key) DO UPDATE SET bytes=excluded.bytes,last_access_at=excluded.last_access_at`)
        .run(hlsCacheKey(id, generation, resource), path.relative(path.resolve(cacheDir), filename), info.size, touched, row.id, row.size, row.modified_at, id);
    }).immediate();
    return sendFile(req, reply, filename, { mime: resource === 'index.m3u8' ? 'application/vnd.apple.mpegurl' : 'video/mp2t', name: resource,
      etagKey: hlsCacheKey(id, generation, resource), authorize });
  }
  app.get('/api/v2/media/:id/hls/:resource', async (req, reply) => {
    const { id, resource } = req.params as { id: string; resource: string };
    const identity = requireUser(req); const principal = identityPrincipal(identity);
    const { row } = await binaryMedia(req, id);
    const authorize = () => {
      const current = authenticate(req) ?? fail(401, 'UNAUTHORIZED', '会话已失效');
      if (identityPrincipal(current) !== principal || !pathAllowed(row.folder, userOut(current.user).allowedPaths)) fail(404, 'NOT_FOUND', '媒体不可访问');
      if (!db.prepare(`SELECT 1 FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1
        WHERE f.id=? AND f.size=? AND f.modified_at=? AND f.playability='transcode'`).get(id, row.size, row.modified_at) || !readSettings(db).transcode.enabled) fail(404, 'NOT_FOUND', '媒体不可访问');
    };
    authorize();
    return hlsResponse(req, reply, row, principal, resource, authorize);
  });
  app.get('/api/v2/media/:id/:resource', async (req, reply) => {
    const { id, resource } = req.params as { id: string; resource: string };
    if (!['original', 'display', 'thumb', 'preview', 'tiles.dzi'].includes(resource)) return fail(404, 'NOT_FOUND', '媒体资源不存在');
    const { row, filename } = await binaryMedia(req, id);
    if (resource === 'thumb') {
      const parsed = (req.query as { size?: string }).size ?? 'm';
      if (parsed !== 's' && parsed !== 'm' && parsed !== 'l') return fail(400, 'VALIDATION', '缩略图尺寸无效');
      return cachedMedia(req, reply, row, { kind: 'thumb', size: parsed }, true, mediaAuthorization(req, row));
    }
    if (resource === 'preview') {
      if (row.media_type !== 'video') return fail(404, 'NOT_FOUND', '视频预览不存在');
      const variant: Variant = { kind: 'preview' };
      const preview = cachePath(cacheDir, row, variant);
      if (!await exists(preview)) {
        db.prepare('UPDATE files SET has_preview=0 WHERE id=? AND size=? AND modified_at=?').run(row.id, row.size, row.modified_at);
        return fail(404, 'NOT_FOUND', '视频预览不存在');
      }
      const touched = Date.now();
      db.prepare('UPDATE cache_entries SET last_access_at=? WHERE cache_key=? AND last_access_at<?')
        .run(touched, cacheKey(row, variant), touched - 60_000);
      return sendFile(req, reply, preview, { mime: 'video/mp4', name: row.name, etagKey: cacheKey(row, variant), authorize: mediaAuthorization(req, row) });
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
        return cachedMedia(req, reply, row, { kind: 'display' }, false, mediaAuthorization(req, row));
    }
    const download = resource === 'original' && (req.query as { download?: string }).download === '1';
    return sendFile(req, reply, filename, { mime: row.mime, name: row.name, download, etagKey: row.id, authorize: mediaAuthorization(req, row) });
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
    return cachedMedia(req, reply, row, { kind: 'tile', level, col, row: tileRow }, false, mediaAuthorization(req, row));
  });
  type ShareRow = { id: string; user_id: string; token: string; title: string; target: string; password_hash: string | null; allow_download: number; expires_at: number | null; created_at: number; view_count: number };
  type ShareTargetValue = ReturnType<typeof ShareTarget.parse>;
  function shareByToken(token: string): ShareRow {
    return (db.prepare('SELECT * FROM shares WHERE token=? AND (expires_at IS NULL OR expires_at>?)').get(token, now()) as ShareRow | undefined)
      ?? fail(404, 'NOT_FOUND', '分享不存在或已过期');
  }
  function shareScope(row: ShareRow) {
    const owner = (db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id) as UserRow | undefined) ?? fail(404, 'NOT_FOUND', '分享不存在');
    const ownerInfo = userOut(owner); const target = ShareTarget.parse(JSON.parse(row.target));
    const context = { id: owner.id, allowedPaths: ownerInfo.allowedPaths, ...(target.type === 'media' ? { ids: target.ids } : {}) };
    const query = MediaListQuery.parse(target.type === 'album' ? { scope: 'album', albumId: target.albumId, limit: 1 }
      : target.type === 'folder' ? { scope: 'folder', folder: target.path, recursive: true, limit: 1 } : { limit: 1 });
    return { owner, target, context, query };
  }
  async function shareOut(row: ShareRow) {
    const { owner, target, context, query } = shareScope(row);
    const summary = await media.summary(query, context);
    const cover = media.page(query, context).items[0] ?? null;
    return { id: row.id, token: row.token, title: row.title, target, ownerUsername: owner.username, hasPassword: !!row.password_hash,
      allowDownload: !!row.allow_download, expiresAt: iso(row.expires_at), createdAt: iso(row.created_at)!, viewCount: row.view_count,
      mediaCount: summary.count, cover };
  }
  function shareCookie(row: ShareRow) { return `luvia_share_${row.id.replaceAll('-', '')}`; }
  function shareUnlocked(req: FastifyRequest, row: ShareRow): boolean {
    if (!row.password_hash) return true;
    const value = req.cookies[shareCookie(row)];
    return !!value && value.length <= 256 && !!db.prepare('SELECT 1 FROM share_sessions WHERE token_hash=? AND share_id=? AND expires_at>?')
      .get(digest(value), row.id, now());
  }
  function currentSessionUser(identity: Identity): UserRow {
    if (identity.kind !== 'session' || !identity.sessionHash) return fail(403, 'FORBIDDEN', '需要会话验证');
    return (db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`)
      .get(identity.sessionHash, now()) as UserRow | undefined) ?? fail(401, 'UNAUTHORIZED', '会话已失效');
  }
  function validateShareTarget(target: ShareTargetValue, owner: UserRow): void {
    const info = userOut(owner); const context = { id: owner.id, allowedPaths: info.allowedPaths };
    if (target.type === 'media') requireVisibleMedia(target.ids, context);
    else if (target.type === 'album') ownedAlbum(target.albumId, owner.id);
    else if (!folders.canFavorite(target.path, { ...context, isAdmin: owner.role === 'admin' })) fail(403, 'FORBIDDEN', '文件夹不可访问');
  }
  register('listShares', async (req) => {
    const identity = requireUser(req); const query = endpoints.listShares.query.parse(req.query);
    const all = query.all === '1' && identity.kind === 'session' && identity.user.role === 'admin';
    const rows = (all ? db.prepare('SELECT * FROM shares ORDER BY created_at DESC,id DESC').all()
      : db.prepare('SELECT * FROM shares WHERE user_id=? ORDER BY created_at DESC,id DESC').all(identity.user.id)) as ShareRow[];
    const shares = [];
    for (let index = 0; index < rows.length; index += 32) shares.push(...await Promise.all(rows.slice(index, index + 32).map(shareOut)));
    return { shares };
  });
  register('createShare', async (req, _reply, body) => {
    const identity = requireUser(req);
    const expires = body.expiresAt == null ? null : Math.floor(Date.parse(body.expiresAt) / 1000);
    if (expires !== null && (!Number.isFinite(expires) || expires <= now())) fail(400, 'VALIDATION', '分享过期时间无效');
    const passwordHash = body.password ? await hashPassword(body.password) : null;
    const id = randomUUID(); const token = secret();
    db.transaction(() => {
      const owner = currentSessionUser(identity);
      validateShareTarget(body.target, owner);
      db.prepare(`INSERT INTO shares(id,user_id,token,title,target,password_hash,allow_download,expires_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(id, owner.id, token, body.title ?? '分享的媒体', JSON.stringify(body.target), passwordHash, body.allowDownload ? 1 : 0, expires, now());
    }).immediate();
    return shareOut(shareByToken(token));
  });
  register('deleteShare', async (req) => {
    const identity = requireUser(req); const { id } = req.params as { id: string };
    const user = currentSessionUser(identity);
    const result = user.role === 'admin' ? db.prepare('DELETE FROM shares WHERE id=?').run(id)
      : db.prepare('DELETE FROM shares WHERE id=? AND user_id=?').run(id, user.id);
    if (!result.changes) fail(404, 'NOT_FOUND', '分享不存在');
  });
  register('publicShare', async (req) => {
    const { token } = req.params as { token: string }; const row = shareByToken(token);
    const unlocked = shareUnlocked(req, row); const owner = (db.prepare('SELECT username FROM users WHERE id=?').get(row.user_id) as { username: string } | undefined) ?? fail(404, 'NOT_FOUND', '分享不存在');
    if (!unlocked) return { title: row.title, ownerUsername: owner.username, requiresPassword: true, unlocked: false, allowDownload: !!row.allow_download, expiresAt: iso(row.expires_at), mediaCount: null, cover: null };
    db.prepare('UPDATE shares SET view_count=view_count+1 WHERE id=?').run(row.id);
    const before = shareScope(row).context;
    const output = await shareOut(row);
    const current = shareByToken(token);
    if (!shareUnlocked(req, current) || current.target !== row.target || JSON.stringify(shareScope(current).context) !== JSON.stringify(before)) fail(409, 'CONFLICT', '分享权限已经变化，请重试');
    return { title: row.title, ownerUsername: owner.username, requiresPassword: !!row.password_hash, unlocked: true, allowDownload: !!row.allow_download,
      expiresAt: iso(row.expires_at), mediaCount: output.mediaCount, cover: output.cover ? { ...output.cover, favorite: false } : null };
  });
  register('unlockShare', async (req, reply, body) => {
    const { token } = req.params as { token: string }; const row = shareByToken(token);
    if (!row.password_hash) return;
    limitLogin(req.ip);
    if (!(await verifyPassword(body.password, row.password_hash)).valid) return fail(401, 'UNAUTHORIZED', '分享密码错误');
    const value = secret(); const expires = Math.min(row.expires_at ?? now() + 7 * 86400, now() + 7 * 86400);
    db.transaction(() => {
      const current = shareByToken(token);
      if (current.password_hash !== row.password_hash) fail(409, 'CONFLICT', '分享状态已经变化');
      db.prepare('INSERT INTO share_sessions(token_hash,share_id,expires_at) VALUES (?,?,?)').run(digest(value), row.id, expires);
    }).immediate();
    reply.setCookie(shareCookie(row), value, { httpOnly: true, sameSite: 'lax', secure, path: `/api/v2/public/shares/${row.token}`, maxAge: Math.max(0, expires - now()) });
  });
  register('publicShareMedia', async (req) => {
    const { token } = req.params as { token: string }; const row = shareByToken(token);
    if (!shareUnlocked(req, row)) fail(403, 'FORBIDDEN', '请先解锁分享');
    const query = endpoints.publicShareMedia.query.parse(req.query); const scope = shareScope(row);
    try {
      const page = media.page({ ...scope.query, limit: query.limit, cursor: query.cursor }, scope.context);
      return { ...page, items: page.items.map((entry) => ({ ...entry, favorite: false })) };
    } catch (err) { if (err instanceof Error && err.message === '无效游标') fail(400, 'VALIDATION', '无效游标'); throw err; }
  });
  app.get('/api/v2/public/shares/:token/media/:id/:resource', async (req, reply) => {
    const { token, id, resource } = req.params as { token: string; id: string; resource: string };
    if (!['thumb', 'original', 'preview'].includes(resource)) return fail(404, 'NOT_FOUND', '媒体资源不存在');
    const authorize = () => {
      const share = shareByToken(token);
      if (!shareUnlocked(req, share)) return fail(403, 'FORBIDDEN', '请先解锁分享');
      const scope = shareScope(share);
      if (!media.contains(scope.query, scope.context, id)) return fail(404, 'NOT_FOUND', '媒体不属于分享');
      if (resource === 'original' && !share.allow_download) return fail(403, 'FORBIDDEN', '分享未允许下载原文件');
      return scope;
    };
    const scope = authorize();
    const { row, filename } = await binaryMediaFor(scope.context, id);
    authorize();
    if (resource === 'thumb') {
      const size = (req.query as { size?: string }).size ?? 'm';
      if (size !== 's' && size !== 'm' && size !== 'l') return fail(400, 'VALIDATION', '缩略图尺寸无效');
      return cachedMedia(req, reply, row, { kind: 'thumb', size }, true, authorize);
    }
    if (resource === 'preview') {
      if (row.media_type !== 'video') return fail(404, 'NOT_FOUND', '视频预览不存在');
      const variant: Variant = { kind: 'preview' }; const filename = cachePath(cacheDir, row, variant);
      if (!await exists(filename)) return fail(404, 'NOT_FOUND', '视频预览不存在');
      authorize();
      const touched = Date.now();
      db.prepare('UPDATE cache_entries SET last_access_at=? WHERE cache_key=? AND last_access_at<?').run(touched, cacheKey(row, variant), touched - 60_000);
      return sendFile(req, reply, filename, { mime: 'video/mp4', name: row.name, etagKey: cacheKey(row, variant), authorize });
    }
    return sendFile(req, reply, filename, { mime: row.mime, name: row.name, download: (req.query as { download?: string }).download === '1', etagKey: row.id, authorize });
  });
  app.get('/api/v2/public/shares/:token/media/:id/hls/:resource', async (req, reply) => {
    const { token, id, resource } = req.params as { token: string; id: string; resource: string };
    const authorize = () => {
      const share = shareByToken(token);
      if (!shareUnlocked(req, share)) return fail(403, 'FORBIDDEN', '请先解锁分享');
      const scope = shareScope(share);
      if (!media.contains(scope.query, scope.context, id)) return fail(404, 'NOT_FOUND', '媒体不属于分享');
      return { share, scope };
    };
    const initial = authorize();
    const { row } = await binaryMediaFor(initial.scope.context, id);
    const check = () => {
      authorize();
      if (!db.prepare(`SELECT 1 FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1
        WHERE f.id=? AND f.size=? AND f.modified_at=? AND f.playability='transcode'`).get(id, row.size, row.modified_at) || !readSettings(db).transcode.enabled) fail(404, 'NOT_FOUND', '媒体不可访问');
    };
    check();
    const cookieName = `luvia_hls_${initial.share.id.replaceAll('-', '')}`;
    let visitor = req.cookies[cookieName];
    if (!visitor || !/^[A-Za-z0-9_-]{32,128}$/.test(visitor)) {
      if (resource !== 'index.m3u8') return fail(404, 'NOT_FOUND', 'HLS 会话不存在');
      visitor = secret();
      reply.setCookie(cookieName, visitor, { httpOnly: true, sameSite: 'lax', secure, path: `/api/v2/public/shares/${initial.share.token}`, maxAge: 7200 });
    }
    const principal = digest(`share:${initial.share.id}:${digest(visitor)}`);
    return hlsResponse(req, reply, row, principal, resource, check);
  });
  type DownloadTarget = ReturnType<typeof endpoints.createDownload.body.parse>;
  function validateDownload(target: DownloadTarget, owner: UserRow): void {
    const user = userOut(owner); const context = { id: owner.id, allowedPaths: user.allowedPaths };
    if ('ids' in target) requireVisibleMedia([...new Set(target.ids)], context);
    else if ('albumId' in target) ownedAlbum(target.albumId, owner.id);
    else if (!folders.canFavorite(target.folder, { ...context, isAdmin: owner.role === 'admin' })) fail(403, 'FORBIDDEN', '文件夹不可访问');
  }
  function downloadScope(target: DownloadTarget, owner: UserRow) {
    const user = userOut(owner);
    const context = { id: owner.id, allowedPaths: user.allowedPaths, ...('ids' in target ? { ids: [...new Set(target.ids)] } : {}) };
    const query = MediaListQuery.parse('albumId' in target ? { scope: 'album', albumId: target.albumId, limit: 100 }
      : 'folder' in target ? { scope: 'folder', folder: target.folder, recursive: true, limit: 100 } : { limit: 100 });
    return { context, query };
  }
  register('createDownload', async (req, _reply, body) => {
    const identity = requireUser(req); const ticket = secret(); const expires = now() + 600;
    db.transaction(() => {
      const user = currentSessionUser(identity);
      validateDownload(body, user);
      db.prepare('INSERT INTO download_tickets(token_hash,user_id,target,expires_at) VALUES (?,?,?,?)')
        .run(digest(ticket), user.id, JSON.stringify(body), expires);
    }).immediate();
    return { url: `/api/v2/downloads/${ticket}`, expiresAt: iso(expires)!, fileName: 'Luvia Gallery.zip' };
  });
  app.get('/api/v2/downloads/:ticket', async (req, reply) => {
    const identity = requireUser(req); const { ticket } = req.params as { ticket: string };
    if (ticket.length > 256) return fail(404, 'NOT_FOUND', '下载票据不存在或已过期');
    const target = db.transaction(() => {
      const user = currentSessionUser(identity);
      const record = db.prepare('SELECT target FROM download_tickets WHERE token_hash=? AND user_id=? AND expires_at>?')
        .get(digest(ticket), user.id, now()) as { target: string } | undefined;
      if (!record) return fail(404, 'NOT_FOUND', '下载票据不存在或已过期');
      const value = endpoints.createDownload.body.parse(JSON.parse(record.target));
      validateDownload(value, user);
      if (!db.prepare('DELETE FROM download_tickets WHERE token_hash=? AND user_id=?').run(digest(ticket), user.id).changes) return fail(404, 'NOT_FOUND', '下载票据不存在或已过期');
      return value;
    }).immediate();
    const archive = new ZipArchive({ store: true, forceZip64: true });
    let stopped = false; let active: { destroy: () => void } | undefined;
    reply.raw.on('close', () => { if (!reply.raw.writableFinished) { stopped = true; active?.destroy(); archive.abort(); } });
    archive.on('warning', (error) => archive.destroy(error));
    archive.on('error', () => { stopped = true; active?.destroy(); reply.raw.destroy(); });
    reply.type('application/zip').header('Content-Disposition', "attachment; filename*=UTF-8''Luvia%20Gallery.zip");
    reply.send(archive);
    const produce = async () => {
      let cursor: string | undefined;
      do {
        if (stopped) return;
        const owner = currentSessionUser(identity); const scope = downloadScope(target, owner);
        const page = media.page({ ...scope.query, cursor }, scope.context);
        for (const item of page.items) {
          if (stopped) return;
          let current = downloadScope(target, currentSessionUser(identity));
          if (!media.contains(current.query, current.context, item.id)) throw new Error('下载权限已经变化');
          const row = db.prepare(`SELECT f.library_id,f.relative_path,l.root FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1 WHERE f.id=?`)
            .get(item.id) as { library_id: string; relative_path: string; root: string } | undefined;
          if (!row) throw new Error('下载媒体不可用');
          const archiveName = virtualPath(row.library_id, row.relative_path);
          const filename = await secureMediaPath(row.root, row.relative_path);
          current = downloadScope(target, currentSessionUser(identity));
          if (!media.contains(current.query, current.context, item.id)) throw new Error('下载权限已经变化');
          const handle = await openFile(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const info = await handle.stat();
            current = downloadScope(target, currentSessionUser(identity));
            if (!info.isFile() || !media.contains(current.query, current.context, item.id)) throw new Error('下载媒体不可用');
          } catch (error) { await handle.close(); throw error; }
          const stream = handle.createReadStream({ autoClose: true }); active = stream;
          const completed = once(archive, 'entry');
          try { archive.append(stream, { name: archiveName, store: true }); }
          catch (error) { void completed.catch(() => {}); throw error; }
          await completed; active = undefined;
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      if (!stopped) await archive.finalize();
    };
    void produce().catch(() => { stopped = true; active?.destroy(); archive.destroy(new Error('下载流已中断')); });
    return reply;
  });
  function legacyVirtual(absolute: string): string | null {
    if (!path.isAbsolute(absolute)) return null;
    const normalized = path.resolve(absolute);
    const libraries = db.prepare('SELECT id,root FROM libraries WHERE enabled=1').all() as { id: string; root: string }[];
    const match = libraries.filter((library) => within(library.root, normalized)).sort((a, b) => b.root.length - a.root.length)[0];
    if (!match) return null;
    const relative = path.relative(match.root, normalized).split(path.sep).join('/');
    return virtualPath(match.id, relative);
  }
  function legacyAbsolute(virtual: string): string | null {
    const [id, ...parts] = virtual.split('/');
    const library = db.prepare('SELECT root FROM libraries WHERE id=? AND enabled=1').get(id) as { root: string } | undefined;
    return library ? path.join(library.root, ...parts) : null;
  }
  function legacyMediaId(value: string): string | null {
    const direct = db.prepare('SELECT id FROM files WHERE legacy_id=?').get(value) as { id: string } | undefined;
    if (direct) return direct.id;
    if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
    const bytes = Buffer.from(value, 'base64');
    if (bytes.toString('base64url') !== value.replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_')) return null;
    const absolute = bytes.toString('utf8');
    if (!Buffer.from(absolute).equals(bytes) || !path.isAbsolute(absolute) || absolute.includes('\0')) return null;
    const folder = legacyVirtual(path.dirname(absolute));
    if (!folder) return null;
    const slash = folder.indexOf('/');
    const libraryId = slash < 0 ? folder : folder.slice(0, slash);
    const relativeDir = slash < 0 ? '' : folder.slice(slash + 1);
    return mediaId(libraryId, relativeDir ? `${relativeDir}/${path.basename(absolute)}` : path.basename(absolute));
  }
  app.post('/api/auth/login', async (req) => {
    const body = endpoints.login.body.parse(req.body);
    limitLogin(req.ip);
    const user = (findUser.get(body.username) as UserRow | undefined) ?? fail(401, 'UNAUTHORIZED', '用户名或密码错误');
    const verified = await verifyPassword(body.password, user.password_hash);
    if (!verified.valid) return fail(401, 'UNAUTHORIZED', '用户名或密码错误');
    if (!options.legacyJwtSecret) return fail(503, 'INTERNAL', '旧客户端登录暂不可用');
    const replacement = verified.needsUpgrade ? await hashPassword(body.password) : user.password_hash;
    const token = jwt.sign({ username: user.username, role: user.role }, options.legacyJwtSecret, { algorithm: 'HS256', expiresIn: '7d', subject: user.id, jwtid: randomUUID() });
    db.transaction(() => {
      const changed = db.prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?').run(replacement, user.id, user.password_hash);
      if (!changed.changes) fail(409, 'CONFLICT', '账户状态已经变化');
      db.prepare('INSERT INTO legacy_jwt_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)').run(digest(token), user.id, now() + 7 * 86400);
    }).immediate();
    const allowedPaths = user.allowed_paths ? (JSON.parse(user.allowed_paths) as string[]).flatMap((value) => legacyAbsolute(value) ?? []) : [];
    return { token, user: { username: user.username, isAdmin: user.role === 'admin', allowedPaths } };
  });
  app.get('/api/scan/results', async (req) => {
    const identity = requireUser(req);
    const query = req.query as Record<string, string | undefined>;
    const number = (value: string | undefined, fallback: number, min: number, max: number) => {
      if (value === undefined) return fallback;
      if (!/^\d+$/.test(value)) return fail(400, 'VALIDATION', '分页参数无效');
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fail(400, 'VALIDATION', '分页参数无效');
    };
    const limit = number(query.limit, 100, 1, 500); const offset = number(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const context = mediaContext(req);
    const wallpaper = identity.scope === 'wallpaper' ? WallpaperConfig.parse(identity.wallpaper ? JSON.parse(identity.wallpaper) : {}) : null;
    if (wallpaper?.source === 'folder' && !wallpaper.folder) return { files: [], total: 0, totalExact: true, hasMore: false, sources: [{ id: 'local', name: 'Local Storage', count: 0, countExact: true }] };
    const firstLibrary = query.folder !== undefined && ['', '/', 'root'].includes(query.folder)
      ? db.prepare('SELECT id FROM libraries WHERE enabled=1 ORDER BY rowid LIMIT 1').get() as { id: string } | undefined : undefined;
    const requestedFolder = query.folder === undefined ? null : firstLibrary?.id ?? legacyVirtual(query.folder);
    if (query.folder !== undefined && !requestedFolder) return { files: [], total: 0, totalExact: true, hasMore: false, sources: [{ id: 'local', name: 'Local Storage', count: 0, countExact: true }] };
    let from: number | undefined; let to: number | undefined;
    if (query.from !== undefined || query.to !== undefined) {
      from = Number(query.from); to = Number(query.to);
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from >= to) return fail(400, 'VALIDATION', '时间范围无效');
    }
    let rows: LegacyRow[];
    let hasMore: boolean;
    if (query.random === 'true' && wallpaper) {
      const randomQuery = RandomQuery.parse({ types: wallpaper.includeVideos ? ['image', 'video'] : ['image'], ...(query.search ? { q: query.search } : {}), count: Math.min(100, limit + 1),
        ...(wallpaper?.source === 'favorites' || query.favorites === 'true' ? { favorite: true, favoriteFolders: !!wallpaper } : {}),
        ...(wallpaper?.source === 'folder' && wallpaper.folder ? { under: wallpaper.folder } : requestedFolder ? { under: requestedFolder } : {}),
        ...(wallpaper?.landscapeOnly ? { orientation: 'landscape' } : {}) });
      const sampled = media.random({ ...randomQuery, count: limit + 1 }, context).items;
      hasMore = sampled.length > limit;
      rows = sampled.slice(0, limit).map((item) => {
        const source = db.prepare('SELECT f.relative_path,l.root FROM files f JOIN libraries l ON l.id=f.library_id WHERE f.id=?').get(item.id) as { relative_path: string; root: string };
        return { ...source, id: item.id, name: item.name, mime: item.mime, media_type: item.mediaType, size: item.size,
          modified_at: item.modifiedAt, width: item.width, height: item.height, favorite: item.favorite ? 1 : 0 };
      });
    } else {
      const rawSeed = Number(query.seed);
      const page = await legacyPage(db, queries, { userId: context.id, allowedPaths: context.allowedPaths, folder: requestedFolder,
        recursive: query.recursive === 'true', favorite: query.favorites === 'true', search: query.search,
        mediaType: query.mediaType, excludeMediaType: query.excludeMediaType, from, to, sort: query.sort,
        random: query.random === 'true', seed: Number.isSafeInteger(rawSeed) && rawSeed >= 0 ? rawSeed : null, limit, offset });
      rows = page.rows; hasMore = page.hasMore;
    }
    const files = rows.map((row) => {
      const absolute = path.join(row.root, row.relative_path);
      const legacyId = Buffer.from(absolute).toString('base64');
      return { id: legacyId, url: `/api/file/${encodeURIComponent(legacyId)}`, thumbnailUrl: `/api/thumb/${encodeURIComponent(legacyId)}`,
        name: row.name, path: absolute, folderPath: path.dirname(absolute), size: row.size, type: row.mime, lastModified: row.modified_at,
        mediaType: row.media_type, sourceId: 'local', isFavorite: !!row.favorite, width: row.width, height: row.height,
        aspectRatio: row.width && row.height ? row.width / row.height : null };
    });
    const unfiltered = identity.user.role === 'admin' && !wallpaper && !db.prepare('SELECT 1 FROM libraries WHERE enabled=0 LIMIT 1').get() && query.favorites !== 'true' && query.folder === undefined && !query.search && !query.mediaType && !query.excludeMediaType;
    const total = unfiltered ? (db.prepare('SELECT COALESCE(sum(count),0) AS n FROM timeline_counts').get() as { n: number }).n : offset + files.length + (hasMore ? 1 : 0);
    const totalExact = unfiltered || !hasMore;
    return { files, total, totalExact, hasMore, sources: [{ id: 'local', name: 'Local Storage', count: total, countExact: totalExact }] };
  });
  app.get('/api/library/folders', async (req) => {
    requireUser(req);
    const query = req.query as { parentPath?: string; parent?: string; favorites?: string; search?: string; limit?: string };
    const parent = query.parentPath ?? query.parent;
    const virtual = parent && !['/', 'root'].includes(parent) ? legacyVirtual(parent) : '';
    if (virtual === null) return { folders: [] };
    const context = folderContext(req);
    if (virtual && !pathAllowed(virtual, context.allowedPaths)) return fail(403, 'FORBIDDEN', '文件夹不可访问');
    const listing = folders.list(virtual, context);
    if (!listing) return fail(403, 'FORBIDDEN', '文件夹不可访问');
    const search = query.search?.trim() ?? '';
    let selected = listing.folders;
    if (search) {
      const limit = query.limit === undefined || query.limit === '' ? 100 : Number(query.limit);
      if (query.limit !== undefined && query.limit !== '' && (!/^\d+$/.test(query.limit) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)) return fail(400, 'VALIDATION', '搜索数量无效');
      const conditions = ['l.enabled=1', 'f.media_count>0']; const params: (string | number)[] = [];
      if (virtual) { conditions.push('f.path>=? AND f.path<?'); params.push(`${virtual}/`, `${virtual}0`); }
      if (context.allowedPaths !== null) {
        conditions.push(context.allowedPaths.length ? `(${context.allowedPaths.map(() => '(f.path=? OR (f.path>=? AND f.path<?))').join(' OR ')})` : '0');
        for (const allowed of context.allowedPaths) params.push(allowed, `${allowed}/`, `${allowed}0`);
      }
      for (const term of search.split(/\s+/).filter(Boolean)) {
        conditions.push("f.name LIKE ? ESCAPE '\\'"); params.push(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
      }
      if (query.favorites === 'true') { conditions.push("EXISTS(SELECT 1 FROM favorites fv WHERE fv.user_id=? AND fv.item_type='folder' AND fv.item_id=f.path)"); params.push(context.id); }
      const matches = (await queries.run([{ sql: `SELECT f.path FROM folders f JOIN libraries l ON l.id=f.library_id WHERE ${conditions.join(' AND ')} ORDER BY f.path COLLATE NOCASE LIMIT ?`, params: [...params, limit] }]))[0] as { path: string }[];
      selected = matches.flatMap(({ path: folder }) => folders.get(folder, context) ?? []);
    } else if (query.favorites === 'true') selected = folders.favorites(context).folders;
    const aggregates = (await queries.run([{ sql: `SELECT folder,count(*) AS count,max(modified_at) AS latest FROM files
      WHERE folder IN (SELECT value FROM json_each(?)) AND media_type IN ('image','video') GROUP BY folder`,
      params: [JSON.stringify(selected.map((folder) => folder.path))] }]))[0] as { folder: string; count: number; latest: number }[];
    const byPath = new Map(aggregates.map((entry) => [entry.folder, entry]));
    const result = [];
    for (const folder of selected) {
      const absolute = legacyAbsolute(folder.path)!;
      let coverMedia = null;
      if (folder.cover) {
        const source = db.prepare(`SELECT f.relative_path,l.root,c.relative_path AS cache_path FROM files f JOIN libraries l ON l.id=f.library_id
          JOIN cache_entries c ON c.media_id=f.id AND c.variant='thumb' AND c.source_size=f.size AND c.source_modified=f.modified_at
          WHERE f.id=? ORDER BY c.last_access_at DESC LIMIT 1`).get(folder.cover.id) as { relative_path: string; root: string; cache_path: string } | undefined;
        if (source) {
          const cacheFile = path.resolve(cacheDir, source.cache_path);
          if (within(cacheDir, cacheFile)) {
            const info = await stat(cacheFile).catch(() => null);
            if (info?.isFile() && info.size > 0) {
              const coverPath = path.join(source.root, source.relative_path); const id = Buffer.from(coverPath).toString('base64');
              coverMedia = { id, url: `/api/thumb/${encodeURIComponent(id)}?t=${info.mtimeMs}`, type: folder.cover.mime,
                path: coverPath, mediaType: folder.cover.mediaType, name: folder.cover.name };
            }
          }
        }
      }
      const aggregate = byPath.get(folder.path);
      result.push({ name: path.basename(absolute), path: absolute, mediaCount: aggregate?.count ?? 0, coverMedia, lastModified: aggregate?.latest ?? 0, isFavorite: folder.favorite });
    }
    return { folders: result };
  });
  app.get('/api/file/*', async (req, reply) => {
    const legacyId = (req.params as { '*': string })['*'];
    const id = legacyMediaId(legacyId) ?? fail(404, 'NOT_FOUND', '媒体不存在');
    const { row, filename } = await binaryMedia(req, id);
    return sendFile(req, reply, filename, { mime: row.mime, name: row.name, etagKey: row.id, authorize: mediaAuthorization(req, row) });
  });
  app.get('/api/thumb/:id', async (req, reply) => {
    const legacyId = (req.params as { id: string }).id;
    const id = legacyMediaId(legacyId) ?? fail(404, 'NOT_FOUND', '媒体不存在');
    const { row } = await binaryMedia(req, id);
    const hash = createHash('md5').update(legacyId).digest('hex');
    const previous = path.join(cacheDir, hash.slice(0, 2), hash.slice(2, 4), `${hash}.webp`);
    if (await exists(previous)) return sendFile(req, reply, previous, { mime: 'image/webp', name: row.name, etagKey: hash, authorize: mediaAuthorization(req, row) });
    return cachedMedia(req, reply, row, { kind: 'thumb', size: 'm' }, true, mediaAuthorization(req, row));
  });
  type LibraryRow = { id: string; name: string; root: string; enabled: number; status: string; scanning: number; last_scan_at: number | null; host_root: string | null; host_root_source: 'auto' | 'manual' | null; exclude: string; media_count: number };
  const librarySql = "SELECT l.*,COALESCE(f.media_count,0) AS media_count,EXISTS(SELECT 1 FROM scan_locks sl WHERE sl.library_id=l.id AND sl.lease_expires_at>unixepoch()) AS scanning FROM libraries l LEFT JOIN folders f ON f.path=l.id";
  const libraryOut = (row: LibraryRow) => ({ id: row.id, name: row.name, root: row.root, enabled: !!row.enabled,
    status: row.scanning ? 'scanning' : row.status, lastScanAt: iso(row.last_scan_at), hostRoot: row.host_root, hostRootSource: row.host_root_source,
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
      if (action === 'retry' && row.type === 'scan') {
        const removed = db.prepare('DELETE FROM scan_runs WHERE job_id=? AND complete=1 AND errors>0').run(id);
        if (removed.changes) db.prepare('UPDATE jobs SET checkpoint=NULL,progress_done=0,progress_total=NULL WHERE id=?').run(id);
      }
      db.prepare('UPDATE jobs SET status=?,owner=NULL,heartbeat_at=NULL,lease_expires_at=NULL,lease_token=NULL,finished_at=? WHERE id=?')
        .run(next, next === 'cancelled' ? now() : null, id);
      publishJob(db, id);
      return jobView(db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRecord);
    }).immediate();
  });
  register('adminOverview', async () => {
    const result = await queries.run([
      { sql: `SELECT count(*) AS total,COALESCE(sum(f.media_type='image'),0) AS images,COALESCE(sum(f.media_type='video'),0) AS videos,
        COALESCE(sum(f.media_type='audio'),0) AS audio,COALESCE(sum(f.thumb_ready=1),0) AS thumbs,
        COALESCE(sum(f.metadata_status='done'),0) AS indexed,COALESCE(sum(f.media_type='video' AND f.has_preview=1),0) AS previews
        FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1`, params: [] },
      { sql: 'SELECT COALESCE(sum(bytes),0) AS bytes FROM cache_entries', params: [] },
      { sql: "SELECT COALESCE(sum(status='running'),0) AS active,COALESCE(sum(status='queued'),0) AS queued FROM jobs", params: [] },
      { sql: 'SELECT max(last_scan_at) AS last FROM libraries WHERE enabled=1', params: [] },
    ]);
    const counts = result[0]![0] as { total: number; images: number; videos: number; audio: number; thumbs: number; indexed: number; previews: number };
    const cache = result[1]![0] as { bytes: number }; const jobs = result[2]![0] as { active: number; queued: number };
    const last = result[3]![0] as { last: number | null };
    let databaseBytes = 0;
    if (db.name !== ':memory:') {
      for (const filename of [db.name, `${db.name}-wal`]) { try { databaseBytes += (await stat(filename)).size; } catch { /* 可选 WAL 不存在时计零。 */ } }
    }
    return { version: '2.0.0-alpha.0', uptimeSec: Math.floor(process.uptime()),
      media: { total: counts.total, images: counts.images, videos: counts.videos, audio: counts.audio },
      thumbnails: { coverage: counts.total ? counts.thumbs / counts.total : 0, missing: counts.total - counts.thumbs },
      metadata: { indexed: counts.indexed, total: counts.total }, previews: { ready: counts.previews, total: counts.videos },
      cache: { bytes: cache.bytes, limitBytes: readSettings(db).cache.limitGB * 1024 ** 3 }, database: { bytes: databaseBytes },
      health: observability.health(jobs.queued), lastScanAt: iso(last.last), activeJobs: jobs.active };
  });
  register('logs', async (req) => {
    const query = endpoints.logs.query.parse(req.query);
    if (query.level && !['debug', 'info', 'warn', 'error'].includes(query.level)) fail(400, 'VALIDATION', '日志级别无效');
    return { logs: observability.logs(query.level, query.limit) };
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
  const staticDir = path.resolve(options.staticDir ?? fileURLToPath(new URL('../../../web/dist/', import.meta.url)));
  if (await exists(path.join(staticDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: staticDir, cacheControl: false, allowedPath: (pathname) => !/^\/?api(?:\/|$)/.test(pathname), setHeaders: (reply, filename) => {
      const immutable = /[/\\]assets[/\\][^/\\]+[-.][a-zA-Z0-9_-]{8,}\.[^/\\]+$/.test(filename);
      reply.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache, no-store, must-revalidate');
    } });
    app.setNotFoundHandler((req, reply) => {
      const pathname = new URL(req.raw.url ?? '/', 'http://localhost').pathname;
      if (req.method === 'GET' && pathname !== '/api' && !pathname.startsWith('/api/'))
        return reply.header('Cache-Control', 'no-cache, no-store, must-revalidate').sendFile('index.html', { cacheControl: false });
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
    });
  }
  return app;
}
