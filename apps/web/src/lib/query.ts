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
