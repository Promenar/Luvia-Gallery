import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type Database from 'better-sqlite3';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { endpoints, Preferences, defaultPreferences } from '@luvia/contracts';
import type { User } from '@luvia/contracts';
import { hashPassword, verifyPassword } from '../core/password.ts';
import { MediaReader } from '../core/media-query.ts';
import { pathAllowed } from '../core/paths.ts';

type UserRow = {
  id: string; username: string; password_hash: string; role: 'admin' | 'user';
  allowed_paths: string | null; preferences: string; created_at: number; last_login_at: number | null;
};
type TokenRow = {
  id: string; name: string; scope: 'read' | 'wallpaper'; prefix: string;
  created_at: number; last_used_at: number | null; expires_at: number | null;
};
type Identity = { user: UserRow; kind: 'session' | 'token'; scope?: string; sessionHash?: string };
type Options = { db: Database.Database; legacyPending: boolean | (() => boolean); secureCookies?: boolean };
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
  createdAt: iso(t.created_at)!, lastUsedAt: iso(t.last_used_at), expiresAt: iso(t.expires_at),
});

export async function createApp(options: Options): Promise<FastifyInstance> {
  const { db } = options;
  const app = Fastify({ logger: false });
  await app.register(cookie);
  const identities = new WeakMap<FastifyRequest, Identity>();
  const media = new MediaReader(db);
  const attempts = new Map<string, number[]>();
  const secure = options.secureCookies ?? process.env.NODE_ENV === 'production';
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
    if (url.pathname.startsWith('/api/v2/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['x-luvia-request'] !== '1') {
      fail(403, 'FORBIDDEN', '请求缺少安全标头');
    }
    const identity = authenticate(req);
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
    const merged = Preferences.parse({ ...old, ...body, theme: { ...old.theme, ...body.theme } });
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
    const token = secret();
    const t: TokenRow = { id: randomUUID(), name: body.name, scope: body.scope, prefix: token.slice(0, 8), created_at: now(), last_used_at: null, expires_at: body.expiresAt ? Math.floor(new Date(body.expiresAt).getTime() / 1000) : null };
    if (t.expires_at !== null && (!Number.isFinite(t.expires_at) || t.expires_at <= now())) fail(400, 'VALIDATION', '令牌过期时间无效');
    db.prepare('INSERT INTO api_tokens (id,user_id,token_hash,name,scope,prefix,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(t.id, identity.user.id, digest(token), t.name, t.scope, t.prefix, t.created_at, t.expires_at);
    return { token, meta: tokenOut(t) };
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
  register('randomMedia', async (req) => media.random(endpoints.randomMedia.query.parse(req.query), mediaContext(req)));
  return app;
}
