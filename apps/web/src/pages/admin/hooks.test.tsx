import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { Job } from '@luvia/contracts';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { queryClient } from '@/lib/query';
import { jobsQuery, overviewQuery, useJobs } from './hooks';

const events = vi.hoisted(() => ({ listeners: new Set<{ job: (job: Job) => void }>() }));
vi.mock('@/lib/events', async () => {
  const { useEffect } = await import('react');
  return { useServerEvents: (listener: { job: (job: Job) => void }) => useEffect(() => {
    events.listeners.add(listener);
    return () => { events.listeners.delete(listener); };
  }, [listener]) };
});

const running = (id: string): Job => ({
  id, type: 'previews', label: '生成视频预览', status: 'running', progress: { done: 0, total: null },
  message: null, error: null, result: null, trigger: 'system', createdAt: '2026-11-06T00:00:00Z',
  startedAt: null, finishedAt: null, etaSec: null,
});
const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: queryClient }, children);

beforeEach(() => { queryClient.clear(); events.listeners.clear(); });
afterEach(() => { cleanup(); queryClient.clear(); events.listeners.clear(); });

it('连续作业完成不会取消正在读取的概览请求', async () => {
  const one = running('one'); const two = running('two');
  queryClient.setQueryData(jobsQuery.queryKey, { jobs: [one, two] });
  let aborted = 0; let finish: ((value: { revision: number }) => void) | undefined;
  const fetchOverview = vi.fn(({ signal }: { signal: AbortSignal }) => new Promise<{ revision: number }>((resolve, reject) => {
    finish = resolve;
    signal.addEventListener('abort', () => { aborted++; reject(new DOMException('已取消', 'AbortError')); }, { once: true });
  }));
  const { result } = renderHook(() => {
    const jobs = useJobs(); useJobs();
    const overview = useQuery({ queryKey: overviewQuery.queryKey, queryFn: fetchOverview, initialData: { revision: 0 }, staleTime: Infinity });
    return { jobs, overview, data: overview.data };
  }, { wrapper });
  let inFlight: Promise<unknown> | undefined;
  act(() => { inFlight = result.current.overview.refetch(); });
  await waitFor(() => expect(fetchOverview).toHaveBeenCalledTimes(1));
  act(() => {
    for (const listener of events.listeners) listener.job({ ...one, status: 'succeeded' });
  });
  act(() => {
    for (const listener of events.listeners) listener.job({ ...two, status: 'succeeded' });
  });
  await waitFor(() => expect(result.current.jobs.data?.jobs.map((job) => job.status)).toEqual(['succeeded', 'succeeded']));
  expect(aborted).toBe(0);
  expect(finish).toBeDefined();
  await act(async () => { finish?.({ revision: 1 }); await inFlight; });
  await waitFor(() => expect(result.current.data).toEqual({ revision: 1 }));
  // 两次完成事件合并为一次后续刷新，摘要最终取得新值。
  await waitFor(() => expect(fetchOverview).toHaveBeenCalledTimes(2), { timeout: 4500 });
  await act(async () => { finish?.({ revision: 2 }); });
  await waitFor(() => expect(result.current.data).toEqual({ revision: 2 }));
  expect(aborted).toBe(0);
});

it('概览请求超过合并窗口时，最后一次完成事件仍触发后续刷新', async () => {
  const one = running('slow'); queryClient.setQueryData(jobsQuery.queryKey, { jobs: [one] });
  let resolveFirst!: (value: { revision: number }) => void;
  const fetchOverview = vi.fn(({ signal }: { signal: AbortSignal }) => {
    if (fetchOverview.mock.calls.length > 1) return Promise.resolve({ revision: 2 });
    return new Promise<{ revision: number }>((resolve, reject) => {
      resolveFirst = resolve; signal.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError')), { once: true });
    });
  });
  const { result } = renderHook(() => {
    useJobs(); return useQuery({ queryKey: overviewQuery.queryKey, queryFn: fetchOverview, initialData: { revision: 0 }, staleTime: Infinity });
  }, { wrapper });
  let pending: Promise<unknown> | undefined;
  act(() => { pending = result.current.refetch(); });
  await waitFor(() => expect(fetchOverview).toHaveBeenCalledTimes(1));
  act(() => { for (const listener of events.listeners) listener.job({ ...one, status: 'succeeded' }); });
  await new Promise((resolve) => setTimeout(resolve, 3200));
  await act(async () => { resolveFirst({ revision: 1 }); await pending; });
  await waitFor(() => expect(result.current.data).toEqual({ revision: 2 }), { timeout: 4500 });
}, 10000);
