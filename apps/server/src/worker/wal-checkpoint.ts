import { once } from 'node:events';
import { Worker } from 'node:worker_threads';

/**
 * 启动后台 WAL 检查点线程。写连接关闭了自动检查点（见 openDatabase），否则提交时由当前线程同步写回并 fsync，
 * 磁盘繁忙时一次要 1 秒以上，会卡住 worker 与 api 的主线程。线程意外退出时稍后重启。返回停止函数。
 */
export function startWalCheckpointer(filename: string, options: { intervalMs?: number; onError?: () => void } = {}): () => Promise<void> {
  const intervalMs = options.intervalMs ?? 5000;
  let stopped = false; let worker: Worker; let restart: NodeJS.Timeout | undefined;
  const start = () => {
    worker = new Worker(new URL('./wal-checkpoint-thread.ts', import.meta.url), { workerData: { filename, intervalMs } });
    worker.on('error', () => options.onError?.());
    worker.on('exit', () => {
      if (stopped) return;
      restart = setTimeout(start, intervalMs); restart.unref();
    });
  };
  start();
  return async () => {
    stopped = true; if (restart) clearTimeout(restart);
    const exited = once(worker, 'exit');
    worker.postMessage('stop');
    const timeout = setTimeout(() => { void worker.terminate(); }, 10_000); timeout.unref();
    await exited.catch(() => {}); clearTimeout(timeout);
  };
}
