import { afterEach, expect, it, vi } from 'vitest';
import { QueryObserver } from '@tanstack/react-query';
import { queryClient } from './query';
import { startEvents, stopEvents } from './events';

class FakeEvents {
  static current: FakeEvents;
  handlers = new Map<string, (event: MessageEvent<string>) => void>();
  constructor() { FakeEvents.current = this; }
  addEventListener(name: string, callback: (event: MessageEvent<string>) => void) { this.handlers.set(name, callback); }
  close() {}
  library() { this.handlers.get('library')?.({ data: JSON.stringify({ libraryId: 'lib', source: 'watch', folders: ['lib/a'], added: 0, removed: 0, updated: 0, moved: 0 }) } as MessageEvent<string>); }
}

afterEach(() => { stopEvents(); queryClient.clear(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('持续目录变更不会取消正在进行的文件夹请求，结束后补一次刷新', async () => {
  vi.useFakeTimers(); vi.stubGlobal('EventSource', FakeEvents);
  let aborted = 0; let calls = 0; let finish: (() => void) | undefined;
  queryClient.setQueryData(['folders'], { version: 0 });
  const observer = new QueryObserver(queryClient, { queryKey: ['folders'], queryFn: ({ signal }) => {
    calls++; signal.addEventListener('abort', () => { aborted++; });
    if (calls === 1) return new Promise<{ version: number }>((resolve) => { finish = () => resolve({ version: 1 }); });
    return Promise.resolve({ version: 2 });
  }, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const initial = observer.refetch(); startEvents();
    FakeEvents.current.library(); await vi.advanceTimersByTimeAsync(2000); FakeEvents.current.library();
    await vi.advanceTimersByTimeAsync(2000); FakeEvents.current.library();
    expect(aborted).toBe(0); expect(calls).toBe(1);
    finish?.(); await initial; await vi.advanceTimersByTimeAsync(4000);
    expect(calls).toBeGreaterThanOrEqual(2);
  } finally { unsubscribe(); }
});
