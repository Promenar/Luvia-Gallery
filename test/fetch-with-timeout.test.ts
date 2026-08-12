import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout, RequestTimeoutError } from '../utils/fetchWithTimeout';

describe('fetchWithTimeout', () => {
  afterEach(() => vi.useRealTimers());

  it('请求超过期限后主动中断并返回可识别的超时错误', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));

    const request = expect(
      fetchWithTimeout('/api/library/folders', {}, 15_000, fetchImpl as typeof fetch),
    ).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(15_000);

    await request;
    expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it('沿用导航取消信号且不会误报为超时', async () => {
    const parent = new AbortController();
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    }));
    const request = fetchWithTimeout('/api/scan/results', { signal: parent.signal }, 15_000, fetchImpl as typeof fetch);

    parent.abort(new DOMException('导航已取消', 'AbortError'));

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });
});
