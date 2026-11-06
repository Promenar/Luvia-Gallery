import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { startEvents, stopEvents } from './events';
import { queryClient } from './query';
import { thumbMemory } from '@/components/media/thumb-memory';
import * as accessReset from './access-reset';
import { useViewer } from '@/stores/viewer';
import { authStateQuery } from '@/stores/session';
import * as api from './api';

it('权限变化或事件连接断开时清理缩略图内存', () => {
  let source!: FakeSource;
  class FakeSource {
    private listeners = new Map<string, () => void>();
    constructor() { source = this; }
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
    emit(name: string) { this.listeners.get(name)?.(); }
    close() {}
  }
  vi.stubGlobal('EventSource', FakeSource); startEvents();
  const image = { currentSrc: 'thumb', src: 'thumb', naturalWidth: 10, naturalHeight: 10 } as HTMLImageElement;
  const reload = vi.spyOn(accessReset, 'reloadForAccessChange').mockImplementation(() => {});
  useViewer.setState({ open: true, scope: { label: '照片', items: [] } });
  thumbMemory.remember(image); source.emit('session'); expect(thumbMemory.has('thumb')).toBe(false);
  expect(reload).toHaveBeenCalledOnce(); reload.mockRestore(); useViewer.setState({ open: false, scope: null });
  thumbMemory.remember(image); source.emit('error'); expect(thumbMemory.has('thumb')).toBe(false);
});

it('事件连接短暂中断且权限未变时保持查看器打开', async () => {
  let source!: FakeSource;
  class FakeSource {
    private listeners = new Map<string, () => void>();
    constructor() { source = this; }
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
    emit(name: string) { this.listeners.get(name)?.(); }
    close() {}
  }
  const state = { initialized: true, user: { id: 'u', role: 'user', allowedPaths: ['lib/a'] } } as never;
  queryClient.setQueryData(authStateQuery.queryKey, state);
  const fetch = vi.spyOn(api, 'call').mockResolvedValue(state);
  useViewer.setState({ open: true, scope: { label: '照片', items: [] } });
  vi.stubGlobal('EventSource', FakeSource); startEvents(); source.emit('error'); source.emit('open');
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(useViewer.getState().open).toBe(true); expect(useViewer.getState().scope).not.toBeNull();
  fetch.mockRestore(); useViewer.setState({ open: false, scope: null });
});

it('重连验证不复用断线前尚未完成的旧权限请求', async () => {
  let source!: FakeSource;
  class FakeSource {
    private listeners = new Map<string, () => void>();
    constructor() { source = this; }
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
    emit(name: string) { this.listeners.get(name)?.(); }
    close() {}
  }
  const before = { initialized: true, user: { id: 'u', role: 'user', allowedPaths: ['lib/a'] } } as never;
  const after = { initialized: true, user: { id: 'u', role: 'user', allowedPaths: ['lib/b'] } } as never;
  queryClient.setQueryData(authStateQuery.queryKey, before);
  const delayed = queryClient.fetchQuery({ queryKey: authStateQuery.queryKey, queryFn: () => new Promise(() => {}), staleTime: 0 }).catch(() => {});
  const fetch = vi.spyOn(api, 'call').mockResolvedValue(after);
  const reload = vi.spyOn(accessReset, 'reloadForAccessChange').mockImplementation(() => {});
  vi.stubGlobal('EventSource', FakeSource); startEvents(); source.emit('error'); source.emit('open');
  await waitFor(() => expect(reload).toHaveBeenCalledOnce()); await delayed;
  expect(fetch).toHaveBeenCalledWith('authState'); fetch.mockRestore(); reload.mockRestore();
});

it('连接已停止后，迟到的重连验证结果不触发页面重载', async () => {
  let source!: FakeSource;
  class FakeSource {
    private listeners = new Map<string, () => void>();
    constructor() { source = this; }
    addEventListener(name: string, callback: () => void) { this.listeners.set(name, callback); }
    emit(name: string) { this.listeners.get(name)?.(); }
    close() {}
  }
  let reject!: (error: Error) => void;
  const fetch = vi.spyOn(api, 'call').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const reload = vi.spyOn(accessReset, 'reloadForAccessChange').mockImplementation(() => {});
  vi.stubGlobal('EventSource', FakeSource); startEvents(); source.emit('error'); source.emit('open');
  await waitFor(() => expect(fetch).toHaveBeenCalled()); stopEvents(); reject(new Error('连接已关闭'));
  await new Promise((resolve) => setTimeout(resolve, 0)); expect(reload).not.toHaveBeenCalled();
  fetch.mockRestore(); reload.mockRestore();
});

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
