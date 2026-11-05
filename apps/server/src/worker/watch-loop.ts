import type { WatchRuntime } from './watch-runtime.ts';

/** 串行执行配置检查，停机时等待检查结束再关闭监控连接。 */
export function startWatchLoop(runtime: WatchRuntime, options: { intervalMs?: number; onError?: (error: unknown) => void } = {}) {
  let stopping = false;
  let busy = true;
  let inFlight = runtime.tick().finally(() => { busy = false; });
  const ready = inFlight;
  const timer = setInterval(() => {
    if (stopping || busy) return;
    busy = true;
    inFlight = runtime.tick().catch((error: unknown) => { options.onError?.(error); }).finally(() => { busy = false; });
  }, options.intervalMs ?? 5000);
  timer.unref();
  let stopPromise: Promise<void> | undefined;
  return { ready, stop: () => {
    if (!stopPromise) {
      stopping = true; clearInterval(timer);
      stopPromise = inFlight.catch((error: unknown) => { options.onError?.(error); }).then(() => runtime.stop());
    }
    return stopPromise;
  } };
}
