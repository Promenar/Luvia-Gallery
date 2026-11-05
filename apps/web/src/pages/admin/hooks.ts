import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { z } from 'zod';
import type { AdminSettings, AdminSettingsPatch, Job } from '@luvia/contracts';
import { call, type CallOptions, type EndpointName } from '@/lib/api';
import { useServerEvents } from '@/lib/events';
import { invalidate, q, queryClient } from '@/lib/query';
import { deepMerge } from '@/stores/session';
import { errMsg, isActiveJob } from './format';

/**
 * 带路径参数的调用。契约路由表的 path 目前被推断为 string（未保留字面量），
 * 导致 CallOptions 无法接受 params；在底座修正前于此处集中做一次类型转换。
 */
export function callWith<N extends EndpointName>(name: N, params: Record<string, string>, opts: Omit<CallOptions<N>, 'params'> = {} as Omit<CallOptions<N>, 'params'>) {
  return call(name, { ...opts, params } as unknown as CallOptions<N>);
}
export function qWith<N extends EndpointName>(name: N, params: Record<string, string>, opts: Omit<CallOptions<N>, 'params'> = {} as Omit<CallOptions<N>, 'params'>) {
  return q(name, { ...opts, params } as unknown as CallOptions<N>);
}

export const settingsQuery = q('getSettings');
export const overviewQuery = q('adminOverview');
export const jobsQuery = q('listJobs', { query: { limit: 30 } });

export type SettingsPatch = z.input<typeof AdminSettingsPatch>;

/** 管理设置的乐观更新：先改本地，失败回滚并提示。 */
export function useUpdateSettings() {
  return useMutation({
    mutationFn: (patch: SettingsPatch) => call('updateSettings', { body: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: settingsQuery.queryKey });
      const prev = queryClient.getQueryData<AdminSettings>(settingsQuery.queryKey);
      if (prev) queryClient.setQueryData(settingsQuery.queryKey, deepMerge(prev, patch));
      return { prev };
    },
    onError: (e, _p, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(settingsQuery.queryKey, ctx.prev);
      toast.error(`设置没有保存：${errMsg(e)}`);
    },
    onSuccess: (s) => {
      queryClient.setQueryData(settingsQuery.queryKey, s);
      toast.success('已保存');
      void invalidate('adminOverview');
    },
  });
}

/**
 * 作业列表：SSE `job` 事件到达时就地更新缓存中的对应作业；有进行中的作业时另以较低频率轮询兜底
 * （SSE 断开或代理缓冲时进度仍会前进）。作业结束时刷新概览与媒体库。
 */
export function useJobs() {
  const query = useQuery({
    ...jobsQuery,
    refetchInterval: (qq) => (qq.state.data?.jobs.some(isActiveJob) ? 3000 : false),
  });
  const prevStatus = useRef(new Map<string, Job['status']>());
  const listener = useMemo(() => ({
    job: (job: Job) => {
      queryClient.setQueriesData<{ jobs: Job[] }>({ queryKey: ['listJobs'] }, (old) => {
        if (!old) return old;
        const i = old.jobs.findIndex((j) => j.id === job.id);
        const jobs = i < 0 ? [job, ...old.jobs] : old.jobs.map((j) => (j.id === job.id ? job : j));
        return { jobs };
      });
    },
  }), []);
  useServerEvents(listener);

  // 任一作业从进行中变为结束：刷新依赖处理进度的数据
  useEffect(() => {
    const jobs = query.data?.jobs ?? [];
    let finished = false;
    for (const j of jobs) {
      const before = prevStatus.current.get(j.id);
      if (before && isActiveJob({ status: before }) && !isActiveJob(j)) finished = true;
      prevStatus.current.set(j.id, j.status);
    }
    if (finished) void invalidate('adminOverview', 'listLibraries', 'mounts');
  }, [query.data]);
  return query;
}

/**
 * 滑块与数字输入的延迟提交：拖动时只改本地值，停止 600ms 后提交一次。
 * 外部值变化（例如保存失败回滚）时同步回本地。
 */
export function useDeferredCommit(value: number, commit: (v: number) => void, wait = 600) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(commit);
  latest.current = commit;
  useEffect(() => { setLocal(value); }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const set = (v: number) => {
    setLocal(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (v !== value) latest.current(v); }, wait);
  };
  return [local, set] as const;
}

/** 媒体库 ID → 名称，用于把虚拟文件夹路径显示为可读名称。 */
export function useLibraryNames() {
  const { data } = useQuery(q('folders', { query: {} }));
  return useMemo(() => Object.fromEntries((data?.folders ?? []).map((f) => [f.path, f.name])), [data]);
}

/** 对外访问地址：设置为空时回退到当前页面地址。 */
export function useServerUrl() {
  const { data } = useQuery(settingsQuery);
  return (data?.publicUrl ?? (typeof location !== 'undefined' ? location.origin : '')).replace(/\/+$/, '');
}
