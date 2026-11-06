import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { startEvents, stopEvents } from './events';
import { queryClient } from './query';

it('媒体库事件不会取消进行中的概览读取，并会在完成后刷新', async () => {
  let source!: FakeSource;
  class FakeSource {
    private listeners = new Map<string, (event: MessageEvent<string>) => void>();
    constructor() { source = this; }
    addEventListener(name: string, callback: (event: MessageEvent<string>) => void) { this.listeners.set(name, callback); }
    emit(name: string) { this.listeners.get(name)?.({ data: '{}' } as MessageEvent<string>); }
    close() {}
  }
  vi.stubGlobal('EventSource', FakeSource); startEvents();
  let aborted = 0; let finish!: (value: number) => void;
  const fetchOverview = vi.fn(({ signal }: { signal: AbortSignal }) => {
    if (fetchOverview.mock.calls.length > 1) return Promise.resolve(2);
    return new Promise<number>((resolve, reject) => {
      finish = resolve; signal.addEventListener('abort', () => { aborted++; reject(new DOMException('已取消', 'AbortError')); }, { once: true });
    });
  });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
  const { result } = renderHook(() => useQuery({ queryKey: ['adminOverview'], queryFn: fetchOverview, initialData: 0, staleTime: Infinity }), { wrapper });
  let pending: Promise<unknown> | undefined;
  act(() => { pending = result.current.refetch(); }); await waitFor(() => expect(fetchOverview).toHaveBeenCalledTimes(1));
  act(() => { source.emit('library'); });
  expect(aborted).toBe(0);
  await act(async () => { finish(1); await pending; });
  await waitFor(() => expect(result.current.data).toBe(2), { timeout: 4500 });
}, 7000);

it('作业列表尚未加载时收到终态事件仍刷新概览', async () => {
  let source!: FakeSource;
  class FakeSource {
    private listeners = new Map<string, (event: MessageEvent<string>) => void>();
    constructor() { source = this; }
    addEventListener(name: string, callback: (event: MessageEvent<string>) => void) { this.listeners.set(name, callback); }
    emit() { this.listeners.get('job')?.({ data: JSON.stringify({ status: 'succeeded' }) } as MessageEvent<string>); }
    close() {}
  }
  vi.stubGlobal('EventSource', FakeSource); startEvents();
  const fetchOverview = vi.fn().mockResolvedValue(1);
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);
  const { result } = renderHook(() => useQuery({ queryKey: ['adminOverview'], queryFn: fetchOverview, initialData: 0, staleTime: Infinity }), { wrapper });
  act(() => { source.emit(); });
  await waitFor(() => expect(result.current.data).toBe(1), { timeout: 4500 });
}, 7000);

afterEach(() => { stopEvents(); cleanup(); queryClient.clear(); vi.unstubAllGlobals(); });
