import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';

/** WAL 达到该帧数（4 KiB 页约 256 MiB）时后台作业让路，回落到 RESUME_FRAMES 以下恢复。 */
export const PRESSURE_FRAMES = 65536;
const RESUME_FRAMES = 16384;
let pressured = false;
const waiters = new Set<() => void>();
function setPressure(next: boolean) {
  if (pressured === next) return;
  pressured = next;
  if (!next) { for (const wake of waiters) wake(); waiters.clear(); }
}

/**
 * 后台作业写入前调用：WAL 积压过大时异步等待检查点线程追平并截断，最长 maxMs 后继续，不阻塞事件循环。
 * 写连接关闭了自动检查点，没有这一步时持续写入会让写回始终追不平，WAL 无法从头复用而一直增长。
 */
export async function waitForWalCapacity(signal?: AbortSignal, maxMs = 10_000): Promise<void> {
  if (!pressured) return;
  signal?.throwIfAborted();
  let wake!: () => void;
  const released = new Promise<void>((resolve) => { wake = resolve; waiters.add(resolve); });
  const timeout = new AbortController();
  try { await Promise.race([released, delay(maxMs, undefined, { signal: timeout.signal }).catch(() => {})]); }
  finally { waiters.delete(wake); timeout.abort(); }
  signal?.throwIfAborted();
}

/**
 * 启动后台 WAL 检查点线程。写连接关闭了自动检查点（见 openDatabase），否则提交时由当前线程同步写回并 fsync，
 * 磁盘繁忙时一次要 1 秒以上，会卡住 worker 与 api 的主线程。线程意外退出时稍后重启。返回停止函数。
 */
export function startWalCheckpointer(filename: string, options: { intervalMs?: number; truncateFrames?: number; pressureFrames?: number; onError?: () => void } = {}): () => Promise<void> {
  const intervalMs = options.intervalMs ?? 1000;
  const truncateFrames = options.truncateFrames ?? RESUME_FRAMES;
  const pressureFrames = options.pressureFrames ?? Math.max(PRESSURE_FRAMES, truncateFrames * 2);
  let stopped = false; let worker: Worker; let restart: NodeJS.Timeout | undefined;
  const start = () => {
    worker = new Worker(new URL('./wal-checkpoint-thread.ts', import.meta.url), { workerData: { filename, intervalMs, truncateFrames } });
    worker.on('message', (message: { log: number }) => {
      if (message.log >= pressureFrames) setPressure(true);
      else if (message.log >= 0 && message.log < truncateFrames) setPressure(false);
    });
    worker.on('error', () => options.onError?.());
    worker.on('exit', () => {
      // 线程不在时不再让后台作业等待
      setPressure(false);
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
