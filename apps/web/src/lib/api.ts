import type { z } from 'zod';
import { ApiError as ApiErrorSchema, CSRF_HEADER, endpoints } from '@luvia/contracts';

type Endpoints = typeof endpoints;
export type EndpointName = keyof Endpoints;

type Infer<T> = T extends z.ZodType ? z.output<T> : undefined;
type InferIn<T> = T extends z.ZodType ? z.input<T> : never;
type PathParams<P extends string> = P extends `${string}:${infer K}/${infer Rest}`
  ? { [k in K | keyof PathParams<`/${Rest}`>]: string }
  : P extends `${string}:${infer K}` ? { [k in K]: string } : Record<never, never>;

export type Response<N extends EndpointName> = Endpoints[N]['response'] extends null ? void : Infer<Endpoints[N]['response']>;

export type CallOptions<N extends EndpointName> = {
  signal?: AbortSignal;
} & (keyof PathParams<Endpoints[N]['path']> extends never ? { params?: undefined } : { params: PathParams<Endpoints[N]['path']> })
  & (Endpoints[N] extends { query: z.ZodType } ? { query?: Partial<InferIn<Endpoints[N]['query']>> } : { query?: undefined })
  & (Endpoints[N] extends { body: z.ZodType } ? { body: InferIn<Endpoints[N]['body']> } : { body?: undefined });

/** 服务端返回的非 2xx 错误，message 为可直接展示的中文说明。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function buildUrl(path: string, params?: Record<string, string>, query?: Record<string, unknown>) {
  let p = path.replace(/:([A-Za-z_]+)/g, (_, k: string) => {
    const v = params?.[k];
    if (v == null) throw new Error(`缺少路径参数 ${k}`);
    return encodeURIComponent(v);
  });
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v == null || v === '') continue;
      qs.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    const s = qs.toString();
    if (s) p += `?${s}`;
  }
  return p;
}

/** 按契约路由表调用 v2 接口。非 GET 请求自动携带 CSRF 头，Cookie 会话鉴权。 */
export async function call<N extends EndpointName>(name: N, opts: CallOptions<N> = {} as CallOptions<N>): Promise<Response<N>> {
  const def = endpoints[name];
  const o = opts as { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown; signal?: AbortSignal };
  const url = buildUrl(def.path, o.params, o.query);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (def.method !== 'GET') headers[CSRF_HEADER] = '1';
  if (o.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {
    method: def.method,
    headers,
    credentials: 'same-origin',
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
    signal: o.signal,
  });
  if (res.status === 204) return undefined as Response<N>;
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    if (parsed.success) throw new ApiError(res.status, parsed.data.error.code, parsed.data.error.message, parsed.data.error.details);
    throw new ApiError(res.status, 'HTTP_' + res.status, `请求失败（${res.status}）`);
  }
  return json as Response<N>;
}

export const isUnauthorized = (e: unknown) => e instanceof ApiError && e.status === 401;
