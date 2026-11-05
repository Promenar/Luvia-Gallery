import type { WatchRuntime } from './watch-runtime.ts';

/** 串行触发配置检查，停机时立即停止续租并限制等待时间。 */
export function startWatchLoop(runtime: WatchRuntime, options: { intervalMs?: number; stopTimeoutMs?: number; onError?: (error: unknown) => void } = {}) {
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
      const stopped = runtime.stop();
      stopPromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, options.stopTimeoutMs ?? 5000);
        void Promise.allSettled([inFlight, stopped]).then(() => { clearTimeout(timeout); resolve(); });
      });
    }
    return stopPromise;
  } };
}
