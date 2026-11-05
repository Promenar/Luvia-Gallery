import { Worker } from 'node:worker_threads';

export type MaintenanceResult = { busy: number; log: number; checkpointed: number };

export function runSqliteMaintenance(filename: string): Promise<MaintenanceResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sqlite-maintenance-thread.ts', import.meta.url), { workerData: { filename } });
    let finished = false;
    const timeout = setTimeout(() => { void worker.terminate(); }, 10_000);
    timeout.unref();
    const fail = () => {
      if (finished) return;
      finished = true; clearTimeout(timeout); reject(new Error('数据库维护失败'));
    };
    worker.once('message', (message: MaintenanceResult | { error: true } | undefined) => {
      if (finished) return;
      if (!message || 'error' in message) { fail(); return; }
      finished = true; clearTimeout(timeout); resolve(message);
    });
    worker.once('error', fail);
    worker.once('exit', fail);
  });
}
