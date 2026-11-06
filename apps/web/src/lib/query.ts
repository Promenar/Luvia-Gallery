import { QueryClient, queryOptions } from '@tanstack/react-query';
import { call, type CallOptions, type EndpointName, isUnauthorized } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => !isUnauthorized(e) && n < 2,
    },
  },
});

/** 以“接口名 + 参数”作为查询键，SSE 失效时可按接口名前缀批量失效。 */
export function q<N extends EndpointName>(name: N, opts?: CallOptions<N>) {
  return queryOptions({
    queryKey: [name, opts?.params ?? null, opts?.query ?? null] as const,
    queryFn: ({ signal }) => call(name, { ...(opts as object), signal } as CallOptions<N>),
  });
}

export const invalidate = (...names: EndpointName[]) =>
  Promise.all(names.map((n) => queryClient.invalidateQueries({ queryKey: [n] })));

type DeferredRefresh = { dirty: boolean; running: boolean; timer?: ReturnType<typeof setTimeout> };
const deferredRefreshes = new Map<EndpointName, DeferredRefresh>();

/** 合并频繁事件；请求进行中收到变化时，在其结束后补一次刷新。 */
export function scheduleRefresh(...names: EndpointName[]) {
  for (const name of names) {
    let state = deferredRefreshes.get(name);
    if (!state) { state = { dirty: false, running: false }; deferredRefreshes.set(name, state); }
    state.dirty = true;
    schedule(name, state);
  }
}

function schedule(name: EndpointName, state: DeferredRefresh) {
  if (state.timer !== undefined || state.running) return;
  state.timer = setTimeout(() => {
    state.timer = undefined; state.running = true; state.dirty = false;
    const wasFetching = queryClient.isFetching({ queryKey: [name], type: 'active' }) > 0;
    void queryClient.invalidateQueries({ queryKey: [name] }, { cancelRefetch: false }).finally(() => {
      state.running = false;
      if (wasFetching) state.dirty = true;
      if (state.dirty) schedule(name, state);
    });
  }, 3000);
}
