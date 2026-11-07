import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const calls = vi.hoisted(() => ({ create: vi.fn(), api: vi.fn() }));
vi.mock('./external-api', () => ({ createExternalEditorJob: calls.create }));
vi.mock('@/lib/api', () => ({ ApiError: class extends Error {}, call: calls.api }));
import { useExternalJob } from './useExternalJob';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('切换图片后迟到的作业不能替换当前状态，并会被取消', async () => {
  let finish!: (value: unknown) => void;
  calls.create.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  calls.api.mockResolvedValue({});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useExternalJob(), { wrapper });
  let promise!: Promise<unknown>;
  act(() => { promise = result.current.create('old-upload', 'migan', { data: 'a', width: 1, height: 1 }); });
  act(() => { result.current.reset(); });
  await act(async () => { finish({ id: 'old-job', status: 'queued' }); await promise; });
  expect(result.current.jobId).toBeNull();
  await waitFor(() => expect(calls.api).toHaveBeenCalledWith('cancelEditorJob', { params: { id: 'old-job' } }));
});
