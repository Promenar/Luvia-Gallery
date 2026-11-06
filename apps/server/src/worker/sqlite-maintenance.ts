import { Worker } from 'node:worker_threads';

export type MaintenanceResult = { busy: number; log: number; checkpointed: number };

export function runSqliteMaintenance(filename: string): Promise<MaintenanceResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sqlite-maintenance-thread.ts', import.meta.url), { workerData: { filename } });
    let finished = false; let failed = false; let result: MaintenanceResult | undefined;
    // PASSIVE 检查点不阻塞读写，积压较多时允许多写回一会儿
    const timeout = setTimeout(() => { void worker.terminate(); }, 300_000);
    timeout.unref();
    const fail = () => {
      if (finished) return;
      finished = true; clearTimeout(timeout); reject(new Error('数据库维护失败'));
    };
    worker.once('message', (message: MaintenanceResult | { error: true } | undefined) => {
      if (finished) return;
      if (!message || 'error' in message) { failed = true; return; }
      result = message;
    });
    worker.once('error', () => { failed = true; });
    worker.once('exit', (code) => {
      if (finished) return;
      if (code !== 0 || failed || !result) { fail(); return; }
      finished = true; clearTimeout(timeout); resolve(result);
    });
  });
}
