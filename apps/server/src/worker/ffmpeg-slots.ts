import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import { readSettings } from '../core/settings.ts';
import { runProcess } from './process-runner.ts';
import { renewLease } from '../core/sqlite-errors.ts';

const now = () => Math.floor(Date.now() / 1000);
export class FfmpegExitError extends Error {
  constructor() { super('FFmpeg 执行失败'); }
}
async function withSlot<T>(db: Database.Database, owner: string, kind: 'ffmpeg' | 'thumbnail', operation: (signal: AbortSignal, assertSlot: () => void) => Promise<T>, options: { signal?: AbortSignal; assertLease?: () => void } = {}): Promise<T> {
  const id = randomUUID();
  while (true) {
    options.signal?.throwIfAborted(); options.assertLease?.();
    const active = (db.prepare('SELECT count(*) AS n FROM ffmpeg_slots WHERE kind=? AND lease_expires_at>?').get(kind, now()) as { n: number }).n;
    const current = readSettings(db).workers;
    if (active >= (kind === 'ffmpeg' ? current.ffmpegConcurrency : current.thumbnailConcurrency)) {
      await delay(50, undefined, { signal: options.signal });
      continue;
    }
    const acquired = db.transaction(() => {
      options.assertLease?.();
      const count = (db.prepare('SELECT count(*) AS n FROM ffmpeg_slots WHERE kind=?').get(kind) as { n: number }).n;
      const workers = readSettings(db).workers;
      const limit = kind === 'ffmpeg' ? workers.ffmpegConcurrency : workers.thumbnailConcurrency;
      const toReclaim = Math.max(0, count - limit + 1);
      if (toReclaim) {
        const expired = (db.prepare('SELECT count(*) AS n FROM ffmpeg_slots WHERE kind=? AND lease_expires_at<=?').get(kind, now()) as { n: number }).n;
        if (expired < toReclaim) return false;
        db.prepare('DELETE FROM ffmpeg_slots WHERE id IN (SELECT id FROM ffmpeg_slots WHERE kind=? AND lease_expires_at<=? ORDER BY lease_expires_at,id LIMIT ?)').run(kind, now(), toReclaim);
      }
      db.prepare('INSERT INTO ffmpeg_slots(id,owner,lease_expires_at,kind) VALUES (?,?,?,?)').run(id, owner, now() + 30, kind);
      return true;
    }).immediate();
    if (acquired) break;
    await delay(50, undefined, { signal: options.signal });
  }
  const local = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, local.signal]) : local.signal;
  const assertSlot = () => {
    options.assertLease?.();
    if (!db.prepare('SELECT 1 FROM ffmpeg_slots WHERE id=? AND owner=?').get(id, owner)) {
      local.abort(); throw new Error('转码槽位租约已失效');
    }
  };
  const heartbeat = setInterval(() => renewLease(() => {
    options.assertLease?.();
    // 到期后只要槽位行尚未被删除或接管，原持有者仍可续租。
    return db.prepare('UPDATE ffmpeg_slots SET lease_expires_at=? WHERE id=? AND owner=?').run(now() + 30, id, owner).changes > 0;
  }, () => local.abort()), 5000);
  heartbeat.unref();
  try {
    const result = await operation(signal, assertSlot);
    signal.throwIfAborted(); assertSlot();
    return result;
  } finally {
    clearInterval(heartbeat);
    db.prepare('DELETE FROM ffmpeg_slots WHERE id=? AND owner=?').run(id, owner);
  }
}

export function withFfmpegSlot<T>(db: Database.Database, owner: string, operation: (signal: AbortSignal, assertSlot: () => void) => Promise<T>, options: { signal?: AbortSignal; assertLease?: () => void } = {}): Promise<T> {
  return withSlot(db, owner, 'ffmpeg', operation, options);
}
export function withThumbnailSlot<T>(db: Database.Database, owner: string, operation: (signal: AbortSignal, assertSlot: () => void) => Promise<T>, options: { signal?: AbortSignal; assertLease?: () => void } = {}): Promise<T> {
  return withSlot(db, owner, 'thumbnail', operation, options);
}

export async function runFfmpeg(db: Database.Database, owner: string, args: string[], options: { signal?: AbortSignal; assertLease?: () => void; timeoutMs?: number } = {}): Promise<void> {
  await withFfmpegSlot(db, owner, async (signal) => {
    const result = await runProcess('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', ...args], { timeoutMs: options.timeoutMs ?? 120_000, signal });
    if (signal.aborted) throw new Error('FFmpeg 已取消');
    if (result.error === 'spawn' || result.error === 'runner') throw new Error('FFmpeg 无法启动');
    if (result.error === 'timeout') throw new Error('FFmpeg 执行超时');
    if (result.signal) throw new Error('FFmpeg 被系统中止');
    if (result.code !== 0) throw new FfmpegExitError();
  }, options);
}
