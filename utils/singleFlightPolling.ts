export type PollingTask = (signal: AbortSignal) => Promise<boolean>;

type SingleFlightPollingOptions = {
  delayMs: number;
  schedule?: typeof setTimeout;
  cancelSchedule?: typeof clearTimeout;
};

/**
 * 保证同一时刻只有一个轮询世代；重新启动或停止会中断旧请求。
 */
export class SingleFlightPoller {
  private readonly delayMs: number;
  private readonly schedule: typeof setTimeout;
  private readonly cancelSchedule: typeof clearTimeout;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;

  constructor({ delayMs, schedule = setTimeout, cancelSchedule = clearTimeout }: SingleFlightPollingOptions) {
    this.delayMs = delayMs;
    this.schedule = schedule;
    this.cancelSchedule = cancelSchedule;
  }

  start(task: PollingTask) {
    this.stop();
    const generation = ++this.generation;

    const run = async () => {
      if (generation !== this.generation) return;
      const controller = new AbortController();
      this.controller = controller;
      let keepPolling = false;
      try {
        keepPolling = await task(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        if (this.controller === controller) this.controller = null;
      }

      if (keepPolling && generation === this.generation) {
        this.timer = this.schedule(run, this.delayMs);
      }
    };

    void run();
  }

  stop() {
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
    if (this.timer !== null) {
      this.cancelSchedule(this.timer);
      this.timer = null;
    }
  }
}
