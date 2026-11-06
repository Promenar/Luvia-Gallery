import { setTimeout as delay } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import { readSettings } from '../core/settings.ts';
import { runNextJob } from './runner.ts';
import type { WorkerOptions } from './runner.ts';

const SLOTS = 100;
const IDLE_MS = 500;
/** 槽位上限来自设置，按此间隔重读，不必每个槽位每轮都查一次数据库。 */
const SETTINGS_TTL_MS = 2000;
/** 领取失败（多为数据库繁忙）按此间隔汇总写一条日志，繁忙时不刷屏。 */
const CLAIM_WARN_INTERVAL_MS = 30_000;

export async function runWorkerPool(db: Database.Database, options: WorkerOptions & { signal: AbortSignal }): Promise<void> {
  let limit = { at: 0, value: 0 };
  const slotLimit = () => {
    if (Date.now() - limit.at >= SETTINGS_TTL_MS) {
      const workers = readSettings(db).workers;
      // 扫描、元数据等长作业各占一个槽，额外留 4 个，避免它们挤掉逐个文件的缩略图与视频作业。
      limit = { at: Date.now(), value: Math.min(SLOTS, Math.max(2, workers.thumbnailConcurrency + workers.ffmpegConcurrency + 4)) };
    }
    return limit.value;
  };
  // 某个槽位刚发现队列为空时，其它空闲槽位在这段时间内不再各自开写事务领取
  let idleUntil = 0;
  let warnedAt = 0; let failures = 0;
  const slot = async (index: number) => {
    while (!options.signal.aborted) {
      let worked = false;
      try {
        if (index < slotLimit() && Date.now() >= idleUntil) {
          worked = await runNextJob(db, options);
          if (!worked) idleUntil = Date.now() + IDLE_MS;
        }
      } catch {
        failures++;
        if (Date.now() - warnedAt >= CLAIM_WARN_INTERVAL_MS) {
          options.log?.('warn', '作业领取失败', { type: 'worker', count: String(failures) });
          warnedAt = Date.now(); failures = 0;
        }
      }
      if (!worked && !options.signal.aborted) {
        try { await delay(IDLE_MS, undefined, { signal: options.signal }); } catch { if (!options.signal.aborted) throw new Error('worker 等待失败'); }
      }
    }
  };
  await Promise.all(Array.from({ length: SLOTS }, (_, index) => slot(index)));
}
