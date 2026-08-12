import { describe, expect, it, vi } from 'vitest';
import { SingleFlightPoller } from '../utils/singleFlightPolling';

describe('SingleFlightPoller', () => {
  it('重复启动会中断旧请求，旧请求完成后不能恢复幽灵轮询', async () => {
    vi.useFakeTimers();
    const releases: Array<(keepPolling: boolean) => void> = [];
    const signals: AbortSignal[] = [];
    const task = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<boolean>((resolve) => releases.push(resolve));
    });
    const poller = new SingleFlightPoller({ delayMs: 1_000 });

    poller.start(task);
    poller.start(task);

    expect(task).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    releases[0](true);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(2);

    releases[1](true);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(3);

    poller.stop();
    vi.useRealTimers();
  });

  it('停止会中断在飞请求并禁止完成后重新调度', async () => {
    vi.useFakeTimers();
    let release: ((keepPolling: boolean) => void) | undefined;
    let signal: AbortSignal | undefined;
    const task = vi.fn((nextSignal: AbortSignal) => {
      signal = nextSignal;
      return new Promise<boolean>((resolve) => { release = resolve; });
    });
    const poller = new SingleFlightPoller({ delayMs: 1_000 });

    poller.start(task);
    poller.stop();
    expect(signal?.aborted).toBe(true);

    release?.(true);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(task).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
