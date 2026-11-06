import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import { readSettings } from '../core/settings.ts';
import { runProcess } from './process-runner.ts';

const now = () => Math.floor(Date.now() / 1000);
async function withSlot<T>(db: Database.Database, owner: string, kind: 'ffmpeg' | 'thumbnail', operation: (signal: AbortSignal) => Promise<T>, options: { signal?: AbortSignal; assertLease?: () => void } = {}): Promise<T> {
  const id = randomUUID();
  while (true) {
    options.signal?.throwIfAborted(); options.assertLease?.();
    const acquired = db.transaction(() => {
      options.assertLease?.();
      db.prepare('DELETE FROM ffmpeg_slots WHERE lease_expires_at<=?').run(now());
      const count = (db.prepare('SELECT count(*) AS n FROM ffmpeg_slots WHERE kind=?').get(kind) as { n: number }).n;
      const workers = readSettings(db).workers;
      if (count >= (kind === 'ffmpeg' ? workers.ffmpegConcurrency : workers.thumbnailConcurrency)) return false;
      db.prepare('INSERT INTO ffmpeg_slots(id,owner,lease_expires_at,kind) VALUES (?,?,?,?)').run(id, owner, now() + 30, kind);
      return true;
    }).immediate();
    if (acquired) break;
    await delay(50, undefined, { signal: options.signal });
  }
  const local = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, local.signal]) : local.signal;
  const heartbeat = setInterval(() => {
    try {
      options.assertLease?.();
      if (!db.prepare('UPDATE ffmpeg_slots SET lease_expires_at=? WHERE id=? AND owner=? AND lease_expires_at>?').run(now() + 30, id, owner, now()).changes) local.abort();
    } catch { local.abort(); }
  }, 5000);
  heartbeat.unref();
  try {
    const result = await operation(signal);
    signal.throwIfAborted(); options.assertLease?.();
    return result;
  } finally {
    clearInterval(heartbeat);
    db.prepare('DELETE FROM ffmpeg_slots WHERE id=? AND owner=?').run(id, owner);
  }
}

export function withFfmpegSlot<T>(db: Database.Database, owner: string, operation: (signal: AbortSignal) => Promise<T>, options: { signal?: AbortSignal; assertLease?: () => void } = {}): Promise<T> {
  return withSlot(db, owner, 'ffmpeg', operation, options);
}
export function withThumbnailSlot<T>(db: Database.Database, owner: string, operation: (signal: AbortSignal) => Promise<T>, options: { signal?: AbortSignal; assertLease?: () => void } = {}): Promise<T> {
  return withSlot(db, owner, 'thumbnail', operation, options);
}

export async function runFfmpeg(db: Database.Database, owner: string, args: string[], options: { signal?: AbortSignal; assertLease?: () => void; timeoutMs?: number } = {}): Promise<void> {
  await withFfmpegSlot(db, owner, async (signal) => {
    const result = await runProcess('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', ...args], { timeoutMs: options.timeoutMs ?? 120_000, signal });
    if (signal.aborted) throw new Error('FFmpeg 已取消');
    if (result.error === 'spawn' || result.error === 'runner') throw new Error('FFmpeg 无法启动');
    if (result.error === 'timeout') throw new Error('FFmpeg 执行超时');
    if (result.code !== 0) throw new Error('FFmpeg 执行失败');
  }, options);
}
