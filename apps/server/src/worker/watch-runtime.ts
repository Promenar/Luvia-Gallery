import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import type { LibraryWatch } from '@luvia/contracts';
import { openDatabase } from '../core/database.ts';
import { readSettings } from '../core/settings.ts';
import { WatchCoordinator } from '../watch/coordinator.ts';
import { SqliteLibraryIndex } from '../watch/sqlite-index.ts';
import { RootGuard, confirmLibraryMount } from '../watch/root-guard.ts';
import { readInotifyQuota } from '../watch/mode.ts';
import type { Watcher } from '../watch/watcher.ts';
import { readProcessWatchCount } from '../watch/watcher.ts';
import { requestWatchReconcile, flushWatchReconciles } from './watch-reconcile-queue.ts';
import { publishLibraryEvent } from './watch-events.ts';
import { runProcess } from './process-runner.ts';
import { isTransientSqliteError } from '../core/sqlite-errors.ts';

/**
 * 根目录检查的默认时限。检查本身约 0.1 秒，但磁盘繁忙时 worker 主线程会停顿数秒；
 * 超时按根目录不可用处理，恢复后会排一次全量对账，时限太短会把停顿误判成不可用、反复全量对账。
 */
export const ROOT_CHECK_TIMEOUT_MS = 20_000;
const rootChildPath = fileURLToPath(new URL('./watch-root-child.ts', import.meta.url));

type LibraryRow = { id: string; root: string; exclude: string; watch_mode: LibraryWatch['mode']; watch_poll_interval_sec: number };
type Running = { coordinator: WatchCoordinator; port: SqliteLibraryIndex; db: Database.Database; token: string; config: string };
type State = { mount_root: string | null; mount_identity: string | null };
type RuntimeOptions = { owner: string; allowedRoots?: string[]; watcher?: (root: string) => Watcher; mount?: (root: string) => Promise<string | null>; rootTimeoutMs?: number; heartbeatMs?: number };
function filesystemType(identity: string | null): string | null {
  try { const parts: unknown = identity && JSON.parse(identity); return Array.isArray(parts) && typeof parts[0] === 'string' ? parts[0] : null; }
  catch { return null; }
}
export function serviceWatchUsage(db: Database.Database, at = Math.floor(Date.now() / 1000)): number {
  return (db.prepare('SELECT COALESCE(sum(watched_count),0) n FROM watch_worker_usage WHERE lease_expires_at>?').get(at) as { n: number }).n;
}

/** 持久化租约控制每个媒体库的监控所有权。 */
export class WatchRuntime {
  private running = new Map<string, Running>();
  private stopped = false;
  private readonly db: Database.Database;
  private readonly options: RuntimeOptions;
  private readonly heartbeat: NodeJS.Timeout;
  private readonly rootChildren = new Map<string, AbortController>();
  private readonly rootChecks = new Map<string, Promise<unknown>>();
  constructor(db: Database.Database, options: RuntimeOptions) {
    this.db = db; this.options = options;
    this.heartbeat = setInterval(() => {
      // 按 owner 续期，不要求尚未过期：主线程停顿或数据库繁忙使续期晚于到期时，只要没被其它 worker 接管就继续持有，
      // 不必停止监控再重启（重启会排一次全量对账）。被接管时 owner 已改变，这里不会续上。
      try { this.db.prepare('UPDATE watch_leases SET lease_expires_at=unixepoch()+30 WHERE owner=?').run(this.options.owner); } catch { /* 下次检查处理失效租约。 */ }
    }, options.heartbeatMs ?? 5000);
    this.heartbeat.unref();
  }
  private async bounded<T>(work: (signal: AbortSignal) => Promise<T>, fallback: T): Promise<T> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([work(controller.signal), new Promise<T>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve(fallback); }, this.options.rootTimeoutMs ?? ROOT_CHECK_TIMEOUT_MS);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  private async rootChild<T>(key: string, request: Record<string, unknown>, fallback: T): Promise<T> {
    const existing = this.rootChecks.get(key);
    if (existing) return existing as Promise<T>;
    // 经常驻代理启动检查进程：worker 内存数 GB 时直接 fork 要在主线程复制页表，一次卡住 1～2 秒
    const pending = this.bounded(async (signal) => {
      const controller = new AbortController(); this.rootChildren.set(key, controller);
      const abort = () => controller.abort(); signal.addEventListener('abort', abort, { once: true });
      try {
        const run = await runProcess(process.execPath, [rootChildPath, JSON.stringify(request)],
          { timeoutMs: this.options.rootTimeoutMs ?? ROOT_CHECK_TIMEOUT_MS, maxBuffer: 64 * 1024, capture: true, signal: controller.signal });
        if (run.error || run.code !== 0) return fallback;
        const value = JSON.parse(run.stdout) as { result?: T };
        return value.result === undefined ? fallback : value.result;
      } catch { return fallback; }
      finally { signal.removeEventListener('abort', abort); if (this.rootChildren.get(key) === controller) this.rootChildren.delete(key); }
    }, fallback);
    this.rootChecks.set(key, pending);
    try { return await pending; }
    finally { if (this.rootChecks.get(key) === pending) this.rootChecks.delete(key); }
  }
  private config(row: LibraryRow, grace: number): string { return JSON.stringify([row.root, row.exclude, row.watch_mode, row.watch_poll_interval_sec, grace]); }
  async tick(): Promise<void> {
    if (this.stopped) return;
    await this.reportUsage().catch(() => {});
    if (this.stopped) return;
    const rows = this.db.prepare("SELECT id,root,exclude,watch_mode,watch_poll_interval_sec FROM libraries WHERE enabled=1 AND watch_mode<>'off'").all() as LibraryRow[];
    const desired = new Map(rows.map((row) => [row.id, row])); const grace = readSettings(this.db).libraries.missingGraceDays;
    const obsolete = [...this.running.keys()].filter((id) => !desired.has(id)).map((id) => this.stopLibrary(id));
    await Promise.allSettled([...obsolete, ...rows.map(async (row) => {
      if (this.stopped) return;
      const current = this.running.get(row.id);
      if (current) {
        try {
          const at = Math.floor(Date.now() / 1000);
          const renewed = this.db.prepare('UPDATE watch_leases SET lease_expires_at=? WHERE library_id=? AND owner=? AND token=?')
            .run(at + 30, row.id, this.options.owner, current.token);
          if (!renewed.changes || this.config(row, grace) !== current.config) await this.stopLibrary(row.id);
          else { await current.coordinator.checkRoot(); await this.writeStatus(row.id, current); }
        } catch (error) {
          // 数据库暂时繁忙时下一轮再检查；停止并重启监控会排一次全量对账
          if (isTransientSqliteError(error)) return;
          if (!this.stopped) {
            await this.stopLibrary(row.id);
            this.db.prepare("UPDATE library_watch_state SET state='degraded',degraded_reason='实时监控检查失败，等待重试' WHERE library_id=?").run(row.id);
          }
        }
      }
      if (this.stopped || this.running.has(row.id)) return;
      if (this.options.allowedRoots) {
        const allowed = this.options.mount ? await (async () => {
          const actual = await this.bounded(() => realpath(row.root).catch(() => path.resolve(row.root)), path.resolve(row.root));
          const roots = await Promise.all(this.options.allowedRoots!.map((root) => this.bounded(() => realpath(root).catch(() => path.resolve(root)), path.resolve(root))));
          return roots.some((root) => { const rel = path.relative(root, actual); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); });
        })() : await this.rootChild<boolean | null>(`${row.id}:allowed`, { kind: 'allowed', root: row.root, allowedRoots: this.options.allowedRoots }, null);
        if (this.stopped) return;
        if (!allowed) {
          this.db.prepare('INSERT OR IGNORE INTO library_watch_state(library_id) VALUES (?)').run(row.id);
          this.db.prepare("UPDATE library_watch_state SET state='degraded',degraded_reason=? WHERE library_id=?")
            .run(allowed === null ? '媒体库根目录检查超时' : '媒体库根目录不在允许的媒体根目录内', row.id);
          return;
        }
      }
      const at = Math.floor(Date.now() / 1000); const token = randomUUID();
      const claimed = this.db.prepare(`INSERT INTO watch_leases(library_id,owner,token,lease_expires_at) VALUES (?,?,?,?)
        ON CONFLICT(library_id) DO UPDATE SET owner=excluded.owner,token=excluded.token,lease_expires_at=excluded.lease_expires_at
        WHERE watch_leases.lease_expires_at<=?`).run(row.id, this.options.owner, token, at + 30, at);
      if (!claimed.changes) return;
      let connection: Database.Database | undefined; let port: SqliteLibraryIndex | undefined; let coordinator: WatchCoordinator | undefined;
      try {
        this.db.prepare('INSERT OR IGNORE INTO library_watch_state(library_id) VALUES (?)').run(row.id);
        this.db.prepare(`UPDATE library_watch_state SET mount_attempted=1 WHERE library_id=? AND EXISTS
          (SELECT 1 FROM watch_leases WHERE library_id=? AND owner=? AND token=? AND lease_expires_at>unixepoch())`).run(row.id, row.id, this.options.owner, token);
        const unavailable = { available: false, identity: null, reason: '媒体库根目录检查超时', changed: false };
        const confirm = () => this.options.mount
          ? this.bounded((signal) => confirmLibraryMount(this.db, row, { allowedRoots: this.options.allowedRoots ?? [row.root], mount: this.options.mount, signal,
            assertLease: () => { if (this.stopped || !this.owns(row.id, token)) throw new Error('监控租约已失效'); } }), unavailable)
          : this.rootChild(`${row.id}:confirm`, { kind: 'confirm', root: row.root, allowedRoots: this.options.allowedRoots ?? [row.root], database: this.db.name,
            libraryId: row.id, owner: this.options.owner, token }, unavailable);
        await confirm();
        if (this.stopped) throw new Error('实时监控已停止');
        const saved = this.db.prepare('SELECT mount_root,mount_identity FROM library_watch_state WHERE library_id=?').get(row.id) as State;
        const guard = new RootGuard({ root: row.root, confirm });
        connection = openDatabase(this.db.name); const owned = connection;
        port = new SqliteLibraryIndex(connection, { libraryId: row.id,
          assertLease: () => { if (!owned.prepare('SELECT 1 FROM watch_leases WHERE library_id=? AND owner=? AND token=? AND lease_expires_at>unixepoch()').get(row.id, this.options.owner, token)) throw new Error('监控租约已失效'); },
          requestFullReconcile: async (reason) => { requestWatchReconcile(this.db, row.id, reason); },
          publishEvent: async (event) => { this.db.transaction(() => {
            if (!this.owns(row.id, token)) return;
            publishLibraryEvent(this.db, event);
          }).immediate(); },
        });
        const fsType = filesystemType(saved.mount_identity);
        const quota = await readInotifyQuota();
        const used = serviceWatchUsage(this.db);
        const dirCount = (this.db.prepare('SELECT count(*) n FROM folders WHERE library_id=? AND missing_at_ms IS NULL').get(row.id) as {n:number}).n || 1;
        if (this.stopped || !this.owns(row.id, token)) throw new Error('监控租约已失效');
        coordinator = new WatchCoordinator({ libraryId: row.id, root: row.root, exclude: JSON.parse(row.exclude), port, missingGraceDays: grace, guard,
          requested: row.watch_mode, pollIntervalSec: row.watch_poll_interval_sec, fsType, dirCount, quota: quota === null ? null : Math.max(0, quota - used), watcher: this.options.watcher?.(row.root),
          currentFsType: () => filesystemType((this.db.prepare('SELECT mount_identity FROM library_watch_state WHERE library_id=?').get(row.id) as State | undefined)?.mount_identity ?? null) });
        await coordinator.start();
        if (this.stopped || !this.owns(row.id, token)) throw new Error('监控租约已失效');
        const current = { coordinator, port, db: connection, token, config: this.config(row, grace) };
        this.running.set(row.id, current); await this.writeStatus(row.id, current); await this.reportUsage();
      } catch (error) {
        if (coordinator) await this.bounded(() => coordinator!.stop().then(() => true), false); port?.close(); connection?.close();
        if (!this.stopped) {
          this.db.prepare('DELETE FROM watch_leases WHERE library_id=? AND owner=? AND token=?').run(row.id, this.options.owner, token);
          this.db.prepare("UPDATE library_watch_state SET state='degraded',degraded_reason='实时监控启动失败，等待重试' WHERE library_id=?").run(row.id);
        }
      }
    })]);
    if (this.stopped) return;
    await this.reportUsage().catch(() => {});
    await Promise.allSettled([...this.running].map(([id, current]) => this.writeStatus(id, current)));
    flushWatchReconciles(this.db);
  }
  private async reportUsage(): Promise<void> {
    const count = await readProcessWatchCount();
    if (this.stopped) return;
    if (count !== null) this.db.prepare(`INSERT INTO watch_worker_usage(owner,watched_count,lease_expires_at) VALUES (?,?,unixepoch()+30)
      ON CONFLICT(owner) DO UPDATE SET watched_count=excluded.watched_count,lease_expires_at=excluded.lease_expires_at`).run(this.options.owner, count);
  }
  private owns(id: string, token: string): boolean { return !!this.db.prepare('SELECT 1 FROM watch_leases WHERE library_id=? AND owner=? AND token=? AND lease_expires_at>unixepoch()').get(id, this.options.owner, token); }
  private async writeStatus(id: string, current: Running): Promise<void> {
    const status = await current.coordinator.status();
    if (this.stopped) return;
    this.db.prepare(`UPDATE library_watch_state SET state=?,watched_dirs=?,degraded_reason=? WHERE library_id=? AND EXISTS
      (SELECT 1 FROM watch_leases WHERE library_id=? AND owner=? AND token=? AND lease_expires_at>unixepoch())`)
      .run(status.state, this.running.size > 1 ? null : status.watchedDirs, status.degradedReason, id, id, this.options.owner, current.token);
  }
  private async stopLibrary(id: string): Promise<void> {
    const current = this.running.get(id); if (!current) return;
    this.running.delete(id);
    this.db.prepare('DELETE FROM watch_leases WHERE library_id=? AND owner=? AND token=?').run(id, this.options.owner, current.token);
    try { await this.bounded(() => current.coordinator.stop().then(() => true), false); } finally {
      try { current.port.close(); } finally { current.db.close(); }
    }
  }
  async stop(): Promise<void> { this.stopped = true; clearInterval(this.heartbeat); for (const controller of this.rootChildren.values()) controller.abort(); await Promise.allSettled([...this.running.keys()].map((id) => this.stopLibrary(id))); this.db.prepare('DELETE FROM watch_leases WHERE owner=?').run(this.options.owner); this.db.prepare('DELETE FROM watch_worker_usage WHERE owner=?').run(this.options.owner); }
}
