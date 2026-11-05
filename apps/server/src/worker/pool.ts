import { setTimeout as delay } from 'node:timers/promises';
import type Database from 'better-sqlite3';
import { readSettings } from '../core/settings.ts';
import { runNextJob } from './runner.ts';
import type { WorkerOptions } from './runner.ts';

export async function runWorkerPool(db: Database.Database, options: WorkerOptions & { signal: AbortSignal }): Promise<void> {
  const slot = async (index: number) => {
    while (!options.signal.aborted) {
      let worked = false;
      try {
        const workers = readSettings(db).workers;
        const limit = Math.min(16, Math.max(2, workers.thumbnailConcurrency + workers.ffmpegConcurrency));
        if (index < limit) worked = await runNextJob(db, options);
      } catch { options.log?.('warn', '作业领取失败', { type: 'worker' }); }
      if (!worked && !options.signal.aborted) {
        try { await delay(500, undefined, { signal: options.signal }); } catch { if (!options.signal.aborted) throw new Error('worker 等待失败'); }
      }
    }
  };
  await Promise.all(Array.from({ length: 16 }, (_, index) => slot(index)));
}
