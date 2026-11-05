import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';

export interface PathEvent { eventType: 'rename' | 'change'; path: string | null }
export interface WatchHandlers { onEvent(event: PathEvent): void; onError(error: Error): void; onOverflow(): void }
export interface Watcher { start(handlers: WatchHandlers): void; stop(): void; watchedCount(): Promise<number | null> }

/** libuv 可能在同一进程内复用 inotify 描述符，按进程读取一次避免重复计数。 */
export async function readProcessWatchCount(): Promise<number | null> {
  if (process.platform !== 'linux') return null;
  try {
    const names = await readdir('/proc/self/fdinfo');
    const values = await Promise.all(names.map(async (name) => {
      try { const text = await readFile(`/proc/self/fdinfo/${name}`, 'utf8'); return text.split('\n').filter((line) => line.startsWith('inotify wd:')).length; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
    }));
    return values.reduce((sum, value) => sum + value, 0);
  } catch { return null; }
}

export class NodeFsWatcher implements Watcher {
  private watcher: FSWatcher | null = null;
  private readonly root: string;
  constructor(root: string) { this.root = root; }
  start(handlers: WatchHandlers): void {
    if (this.watcher) throw new Error('监视器已启动');
    try {
      const instance = watch(this.root, { recursive: true }, (eventType, filename) => {
        handlers.onEvent({ eventType, path: filename === null ? null : filename.toString() });
      });
      this.watcher = instance;
      instance.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOBUFS' || error.code === 'IN_Q_OVERFLOW') handlers.onOverflow();
        else handlers.onError(error);
      });
    } catch (error) { handlers.onError(error instanceof Error ? error : new Error(String(error))); }
  }
  stop(): void { this.watcher?.close(); this.watcher = null; }
  async watchedCount(): Promise<number | null> {
    return this.watcher ? readProcessWatchCount() : null;
  }
}

export class FakeWatcher implements Watcher {
  private handlers: WatchHandlers | null = null;
  start(handlers: WatchHandlers): void { if (this.handlers) throw new Error('监视器已启动'); this.handlers = handlers; }
  stop(): void { this.handlers = null; }
  async watchedCount(): Promise<number | null> { return null; }
  emit(event: PathEvent): void { this.handlers?.onEvent(event); }
  fail(error: Error): void { this.handlers?.onError(error); }
  overflow(): void { this.handlers?.onOverflow(); }
}
