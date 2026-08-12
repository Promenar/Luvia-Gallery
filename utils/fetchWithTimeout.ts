export class RequestTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`请求超过 ${timeoutMs}ms 未完成`);
    this.name = 'RequestTimeoutError';
  }
}

/**
 * 为浏览器请求增加明确的截止时间，同时保留上层导航取消语义。
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
  fetchImpl: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });

  const timeoutError = new RequestTimeoutError(timeoutMs);
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.reason === timeoutError) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}
