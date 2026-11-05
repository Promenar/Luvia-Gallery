import { monitorEventLoopDelay } from 'node:perf_hooks';
import type Database from 'better-sqlite3';
import pino from 'pino';
import { LogEntry } from '@luvia/contracts';
import type { z } from 'zod';

type Entry = z.output<typeof LogEntry>;
type Minute = { latencies: number[]; eventLoop: number; queue: number };
const levels = new Set(['debug', 'info', 'warn', 'error', 'silent']);
const configuredLevel = () => levels.has(process.env.LOG_LEVEL ?? '') ? process.env.LOG_LEVEL! : 'info';
const percentile = (values: number[], p: number) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
};
function parseLine(line: string, source: 'api' | 'worker'): Entry | null {
  try {
    const raw = JSON.parse(line) as { time?: number; level?: number; msg?: unknown; ctx?: Record<string, unknown> };
    const level = (raw.level ?? 30) >= 50 ? 'error' : (raw.level ?? 30) >= 40 ? 'warn' : (raw.level ?? 30) >= 30 ? 'info' : 'debug';
    const ctx: Record<string, unknown> = {};
    for (const key of ['type', 'status', 'method', 'route', 'code']) {
      const value = raw.ctx?.[key];
      if (typeof value === 'number' || typeof value === 'string' && value.length <= 200) ctx[key] = value;
    }
    return LogEntry.parse({ ts: new Date(raw.time ?? Date.now()).toISOString(), level, source,
      msg: typeof raw.msg === 'string' ? raw.msg.slice(0, 240) : '', ctx: Object.keys(ctx).length ? ctx : null });
  } catch { return null; }
}
function writeSafe(entry: Entry): void { process.stdout.write(`${JSON.stringify(entry)}\n`); }
export function createWorkerLogger(db: Database.Database) {
  let writes = 0;
  return pino({ level: configuredLevel(), base: null }, { write(line: string) {
    const entry = parseLine(line, 'worker');
    if (!entry) return;
    writeSafe(entry);
    try {
      db.prepare("INSERT INTO job_events(event_type,payload) VALUES ('log',?)").run(JSON.stringify(entry));
      if (++writes % 50 === 0) db.prepare(`DELETE FROM job_events WHERE event_type='log' AND id<=(
        SELECT id FROM job_events WHERE event_type='log' ORDER BY id DESC LIMIT 1 OFFSET 999)`).run();
    } catch { /* 标准输出仍保留脱敏日志。 */ }
  } });
}

export class Observability {
  private entries: Entry[] = [];
  private minutes = new Map<number, Minute>();
  private histogram = monitorEventLoopDelay({ resolution: 20 });
  private timer: NodeJS.Timeout;
  private db: Database.Database;
  readonly logger: pino.Logger;
  constructor(db: Database.Database) {
    this.db = db;
    this.logger = pino({ level: configuredLevel(), base: null }, { write: (line: string) => {
      const entry = parseLine(line, 'api');
      if (entry) { this.push(entry); writeSafe(entry); }
    } });
    this.histogram.enable();
    this.timer = setInterval(() => this.sample(), 5000); this.timer.unref();
    this.logger.info('API 服务已初始化');
  }
  private minute(): Minute {
    const key = Math.floor(Date.now() / 60_000);
    let value = this.minutes.get(key);
    if (!value) { value = { latencies: [], eventLoop: 0, queue: 0 }; this.minutes.set(key, value); }
    for (const existing of this.minutes.keys()) if (existing < key - 59) this.minutes.delete(existing);
    return value;
  }
  private sample(): void {
    const minute = this.minute();
    minute.eventLoop = Math.max(minute.eventLoop, this.histogram.percentile(99) / 1e6);
    this.histogram.reset();
    try { minute.queue = (this.db.prepare("SELECT count(*) AS n FROM jobs WHERE status='queued'").get() as { n: number }).n; } catch { /* 保留最近一次采样。 */ }
  }
  record(duration: number): void {
    if (!Number.isFinite(duration) || duration < 0) return;
    const values = this.minute().latencies;
    values.push(duration); if (values.length > 1000) values.shift();
  }
  health(queueDepth: number) {
    const current = this.minute(); current.queue = queueDepth;
    const end = Math.floor(Date.now() / 60_000);
    const recent = Array.from({ length: 60 }, (_, index) => this.minutes.get(end - 59 + index));
    return { eventLoopP99Ms: current.eventLoop, apiP95Ms: percentile(current.latencies, 0.95), queueDepth,
      series: { eventLoopP99Ms: recent.map((item) => item?.eventLoop ?? 0), apiP95Ms: recent.map((item) => percentile(item?.latencies ?? [], 0.95)),
        queueDepth: recent.map((item) => item?.queue ?? 0) } };
  }
  private push(entry: Entry): void { this.entries.push(entry); if (this.entries.length > 1000) this.entries.shift(); }
  logs(level?: string, limit = 200): Entry[] {
    const pending = this.db.transaction(() => {
      const rows = this.db.prepare("SELECT id,payload FROM job_events WHERE event_type='log' ORDER BY id LIMIT 1000").all() as { id: number; payload: string }[];
      if (rows.length) this.db.prepare("DELETE FROM job_events WHERE event_type='log' AND id<=?").run(rows.at(-1)!.id);
      return rows;
    }).immediate();
    for (const row of pending) {
      try { const value = LogEntry.safeParse(JSON.parse(row.payload)); if (value.success) this.push(value.data); } catch { /* 忽略无效日志。 */ }
    }
    return this.entries.filter((entry) => !level || entry.level === level).slice(-limit).reverse();
  }
  close(): void { clearInterval(this.timer); this.histogram.disable(); }
}
