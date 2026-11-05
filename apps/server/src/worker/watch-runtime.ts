import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { LibraryWatch } from '@luvia/contracts';
import { openDatabase } from '../core/database.ts';
import { readSettings } from '../core/settings.ts';
import { WatchCoordinator } from '../watch/coordinator.ts';
import { SqliteLibraryIndex } from '../watch/sqlite-index.ts';
import { RootGuard, readRootMountIdentity } from '../watch/root-guard.ts';
import { readInotifyQuota } from '../watch/mode.ts';
import type { Watcher } from '../watch/watcher.ts';
import { readProcessWatchCount } from '../watch/watcher.ts';
import { requestWatchReconcile, flushWatchReconciles } from './watch-reconcile-queue.ts';
import { publishLibraryEvent } from './watch-events.ts';

type LibraryRow = { id: string; root: string; exclude: string; watch_mode: LibraryWatch['mode']; watch_poll_interval_sec: number };
type Running = { coordinator: WatchCoordinator; port: SqliteLibraryIndex; db: Database.Database; token: string; config: string };
type State = { mount_root: string | null; mount_identity: string | null };
export function serviceWatchUsage(db: Database.Database, at = Math.floor(Date.now() / 1000)): number {
  return (db.prepare('SELECT COALESCE(sum(watched_count),0) n FROM watch_worker_usage WHERE lease_expires_at>?').get(at) as { n: number }).n;
}

/** 持久化租约控制每个媒体库的监控所有权。 */
export class WatchRuntime {
  private running = new Map<string, Running>();
  private stopped = false;
  private readonly db: Database.Database;
  private readonly options: { owner: string; watcher?: (root: string) => Watcher; mount?: (root: string) => Promise<string | null> };
  constructor(db: Database.Database, options: { owner: string; watcher?: (root: string) => Watcher; mount?: (root: string) => Promise<string | null> }) { this.db = db; this.options = options; }
  private config(row: LibraryRow, grace: number): string { return JSON.stringify([row.root, row.exclude, row.watch_mode, row.watch_poll_interval_sec, grace]); }
  async tick(): Promise<void> {
    if (this.stopped) return;
    await this.reportUsage();
    const rows = this.db.prepare("SELECT id,root,exclude,watch_mode,watch_poll_interval_sec FROM libraries WHERE enabled=1 AND watch_mode<>'off'").all() as LibraryRow[];
    const desired = new Map(rows.map((row) => [row.id, row])); const grace = readSettings(this.db).libraries.missingGraceDays;
    for (const [id, current] of this.running) {
      const row = desired.get(id); const at = Math.floor(Date.now() / 1000);
      const renewed = this.db.prepare('UPDATE watch_leases SET lease_expires_at=? WHERE library_id=? AND owner=? AND token=? AND lease_expires_at>?')
        .run(at + 30, id, this.options.owner, current.token, at);
      if (!renewed.changes || !row || this.config(row, grace) !== current.config) { await this.stopLibrary(id); continue; }
      const available = await current.coordinator.checkRoot();
      if (available) {
        const saved = this.db.prepare('SELECT mount_root FROM library_watch_state WHERE library_id=?').get(id) as { mount_root: string | null } | undefined;
        if (saved && !saved.mount_root) {
          const identity = await (this.options.mount ?? readRootMountIdentity)(row.root);
          if (await current.coordinator.checkRoot()) this.db.prepare(`UPDATE library_watch_state SET mount_root=?,mount_identity=? WHERE library_id=? AND mount_root IS NULL AND EXISTS
            (SELECT 1 FROM watch_leases WHERE library_id=? AND owner=? AND token=? AND lease_expires_at>unixepoch())`).run(row.root, identity, id, id, this.options.owner, current.token);
        }
      }
      await this.writeStatus(id, current);
    }
    for (const row of rows) {
      if (this.running.has(row.id)) continue;
      const at = Math.floor(Date.now() / 1000); const token = randomUUID();
      const claimed = this.db.prepare(`INSERT INTO watch_leases(library_id,owner,token,lease_expires_at) VALUES (?,?,?,?)
        ON CONFLICT(library_id) DO UPDATE SET owner=excluded.owner,token=excluded.token,lease_expires_at=excluded.lease_expires_at
        WHERE watch_leases.lease_expires_at<=?`).run(row.id, this.options.owner, token, at + 30, at);
      if (!claimed.changes) continue;
      let connection: Database.Database | undefined; let port: SqliteLibraryIndex | undefined; let coordinator: WatchCoordinator | undefined;
      try {
        this.db.prepare('INSERT OR IGNORE INTO library_watch_state(library_id) VALUES (?)').run(row.id);
        this.db.prepare(`UPDATE library_watch_state SET mount_attempted=1 WHERE library_id=? AND EXISTS
          (SELECT 1 FROM watch_leases WHERE library_id=? AND owner=? AND token=? AND lease_expires_at>unixepoch())`).run(row.id, row.id, this.options.owner, token);
        let saved = this.db.prepare('SELECT mount_root,mount_identity FROM library_watch_state WHERE library_id=?').get(row.id) as State;
        const mount = this.options.mount ?? readRootMountIdentity;
        if (!saved.mount_root) {
          const probe = new RootGuard({ root: row.root, mount });
          if ((await probe.check()).state === 'available') {
            const identity = await mount(row.root);
            this.db.prepare(`UPDATE library_watch_state SET mount_root=?,mount_identity=? WHERE library_id=? AND mount_root IS NULL AND EXISTS
              (SELECT 1 FROM watch_leases WHERE library_id=? AND owner=? AND token=? AND lease_expires_at>unixepoch())`).run(row.root, identity, row.id, row.id, this.options.owner, token);
            saved = this.db.prepare('SELECT mount_root,mount_identity FROM library_watch_state WHERE library_id=?').get(row.id) as State;
          }
        }
        const guard = new RootGuard({ root: row.root, mount, ...(saved.mount_root ? { expectedMountIdentity: saved.mount_identity } : {}) });
        connection = openDatabase(this.db.name); const owned = connection;
        port = new SqliteLibraryIndex(connection, { libraryId: row.id,
          assertLease: () => { if (!owned.prepare('SELECT 1 FROM watch_leases WHERE library_id=? AND owner=? AND token=? AND lease_expires_at>unixepoch()').get(row.id, this.options.owner, token)) throw new Error('监控租约已失效'); },
          requestFullReconcile: async (reason) => { requestWatchReconcile(this.db, row.id, reason); },
          publishEvent: async (event) => { this.db.transaction(() => {
            if (!this.owns(row.id, token)) return;
            publishLibraryEvent(this.db, event);
          }).immediate(); },
        });
        let fsType: string | null = null;
        try { const parts: unknown = saved.mount_identity && JSON.parse(saved.mount_identity); if (Array.isArray(parts) && typeof parts[3] === 'string') fsType = parts[3]; } catch { /* 无法解析时保持未知。 */ }
        const quota = await readInotifyQuota();
        const used = serviceWatchUsage(this.db);
        const dirCount = (this.db.prepare('SELECT count(*) n FROM folders WHERE library_id=? AND missing_at_ms IS NULL').get(row.id) as {n:number}).n || 1;
        if (!this.owns(row.id, token)) throw new Error('监控租约已失效');
        coordinator = new WatchCoordinator({ libraryId: row.id, root: row.root, exclude: JSON.parse(row.exclude), port, missingGraceDays: grace, guard,
          requested: row.watch_mode, pollIntervalSec: row.watch_poll_interval_sec, fsType, dirCount, quota: quota === null ? null : Math.max(0, quota - used), watcher: this.options.watcher?.(row.root) });
        await coordinator.start();
        const current = { coordinator, port, db: connection, token, config: this.config(row, grace) };
        this.running.set(row.id, current); await this.writeStatus(row.id, current); await this.reportUsage();
      } catch (error) {
        if (coordinator) await coordinator.stop(); port?.close(); connection?.close();
        this.db.prepare('DELETE FROM watch_leases WHERE library_id=? AND owner=? AND token=?').run(row.id, this.options.owner, token);
        throw error;
      }
    }
    await this.reportUsage();
    for (const [id, current] of this.running) await this.writeStatus(id, current);
    flushWatchReconciles(this.db);
  }
  private async reportUsage(): Promise<void> {
    const count = await readProcessWatchCount();
    if (count !== null) this.db.prepare(`INSERT INTO watch_worker_usage(owner,watched_count,lease_expires_at) VALUES (?,?,unixepoch()+30)
      ON CONFLICT(owner) DO UPDATE SET watched_count=excluded.watched_count,lease_expires_at=excluded.lease_expires_at`).run(this.options.owner, count);
  }
  private owns(id: string, token: string): boolean { return !!this.db.prepare('SELECT 1 FROM watch_leases WHERE library_id=? AND owner=? AND token=? AND lease_expires_at>unixepoch()').get(id, this.options.owner, token); }
  private async writeStatus(id: string, current: Running): Promise<void> {
    const status = await current.coordinator.status();
    this.db.prepare(`UPDATE library_watch_state SET state=?,watched_dirs=?,degraded_reason=? WHERE library_id=? AND EXISTS
      (SELECT 1 FROM watch_leases WHERE library_id=? AND owner=? AND token=? AND lease_expires_at>unixepoch())`)
      .run(status.state, this.running.size > 1 ? null : status.watchedDirs, status.degradedReason, id, id, this.options.owner, current.token);
  }
  private async stopLibrary(id: string): Promise<void> {
    const current = this.running.get(id); if (!current) return;
    this.running.delete(id);
    try { await current.coordinator.stop(); } finally {
      try { current.port.close(); } finally { current.db.close(); }
      this.db.prepare('DELETE FROM watch_leases WHERE library_id=? AND owner=? AND token=?').run(id, this.options.owner, current.token);
    }
  }
  async stop(): Promise<void> { this.stopped = true; for (const id of [...this.running.keys()]) await this.stopLibrary(id); this.db.prepare('DELETE FROM watch_worker_usage WHERE owner=?').run(this.options.owner); }
}
