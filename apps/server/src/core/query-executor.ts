import { Worker } from 'node:worker_threads';
import type Database from 'better-sqlite3';

export type Statement = { sql: string; params: (string | number)[] };
type Task = { id: number; statements: Statement[]; resolve: (rows: unknown[][]) => void; reject: (error: Error) => void; timer?: NodeJS.Timeout };
type Slot = { worker: Worker; task?: Task; dead: boolean };

export class QueryExecutor {
  private slots: Slot[] = [];
  private queue: Task[] = [];
  private nextId = 0;
  private closed = false;
  private db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  run(statements: Statement[]): Promise<unknown[][]> {
    if (this.closed) return Promise.reject(new Error('查询服务已关闭'));
    if (this.db.name === ':memory:') {
      try { return Promise.resolve(this.db.transaction(() => statements.map(({ sql, params }) => this.db.prepare(sql).all(...params)))()); }
      catch (error) { return Promise.reject(error); }
    }
    if (this.queue.length >= 64) return Promise.reject(new Error('查询队列繁忙'));
    return new Promise((resolve, reject) => {
      this.queue.push({ id: ++this.nextId, statements, resolve, reject });
      this.pump();
    });
  }
  private createSlot(): Slot {
    const worker = new Worker(new URL('./query-thread.ts', import.meta.url), { workerData: { filename: this.db.name } });
    const slot: Slot = { worker, dead: false };
    this.slots.push(slot);
    worker.on('message', (message: { id: number; rows?: unknown[][]; error?: boolean }) => {
      const task = slot.task;
      if (!task || message.id !== task.id) return;
      clearTimeout(task.timer); slot.task = undefined;
      if (message.error || !message.rows) task.reject(new Error('后台查询失败')); else task.resolve(message.rows);
      this.pump();
    });
    const stop = () => {
      if (slot.dead) return;
      slot.dead = true;
      this.slots = this.slots.filter((entry) => entry !== slot);
      if (slot.task) { clearTimeout(slot.task.timer); slot.task.reject(new Error('后台查询中断')); slot.task = undefined; }
      if (!this.closed) this.pump();
    };
    worker.on('error', stop); worker.on('exit', stop);
    return slot;
  }
  private pump(): void {
    if (this.closed) return;
    while (this.queue.length) {
      let slot = this.slots.find((entry) => !entry.dead && !entry.task);
      if (!slot && this.slots.length < 2) slot = this.createSlot();
      if (!slot) return;
      const task = this.queue.shift()!;
      slot.task = task;
      task.timer = setTimeout(() => { void slot!.worker.terminate(); }, 60000);
      task.timer.unref();
      slot.worker.postMessage({ id: task.id, statements: task.statements });
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const task of this.queue.splice(0)) task.reject(new Error('查询服务已关闭'));
    await Promise.all(this.slots.map((slot) => slot.worker.terminate()));
    this.slots = [];
  }
}
