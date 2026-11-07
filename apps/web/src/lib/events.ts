import { useEffect } from 'react';
import type { Job, LibraryChangedEvent } from '@luvia/contracts';
import { queryClient, scheduleRefresh } from './query';
import { thumbMemory } from '@/components/media/thumb-memory';
import { reloadForAccessChange } from './access-reset';
import { authStateQuery } from '@/stores/session';
import { call } from './api';

type Listener = { job?: (j: Job) => void; library?: (e: LibraryChangedEvent) => void };
const listeners = new Set<Listener>();
let source: EventSource | null = null;

/** 媒体集合变化时需要失效的查询。 */
const LIBRARY_QUERIES = ['listMedia', 'buckets', 'facets', 'folders', 'folderTree', 'favoriteFolders', 'memories'] as const;
const resetAccess = () => {
  thumbMemory.clear(); reloadForAccessChange();
};
const scope = (user: { id: string; role: string; allowedPaths: string[] | null } | null | undefined) =>
  JSON.stringify(user ? [user.id, user.role, user.allowedPaths] : null);

function connect() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/v2/events', { withCredentials: true });
  const connection = source;
  let disconnected = false;
  let attempt = 0;
  source.addEventListener('job', (m) => {
    const job = JSON.parse((m as MessageEvent<string>).data) as Job;
    scheduleRefresh('listJobs');
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      scheduleRefresh('adminOverview', 'listLibraries', 'mounts');
    }
    listeners.forEach((l) => l.job?.(job));
  });
  source.addEventListener('library', (m) => {
    const ev = JSON.parse((m as MessageEvent<string>).data) as LibraryChangedEvent;
    scheduleRefresh(...LIBRARY_QUERIES, 'adminOverview', 'listLibraries');
    listeners.forEach((l) => l.library?.(ev));
  });
  source.addEventListener('session', () => {
    resetAccess();
    queryClient.invalidateQueries({ queryKey: ['authState'] });
  });
  source.addEventListener('error', () => { disconnected = true; attempt++; thumbMemory.clear(); });
  source.addEventListener('open', () => {
    if (!disconnected) return;
    disconnected = false;
    const currentAttempt = ++attempt;
    const before = queryClient.getQueryData(authStateQuery.queryKey)?.user;
    void (async () => {
      await queryClient.cancelQueries({ queryKey: authStateQuery.queryKey });
      const current = await call('authState');
      if (source !== connection || attempt !== currentAttempt) return;
      if (!before || scope(before) !== scope(current.user)) resetAccess();
      else queryClient.setQueryData(authStateQuery.queryKey, current);
    })().catch(() => { if (source === connection && attempt === currentAttempt) resetAccess(); });
  });
}

/** 应用登录后调用一次，建立 SSE 连接（浏览器会自动重连）。 */
export function startEvents() { connect(); }
export function stopEvents() { source?.close(); source = null; thumbMemory.clear(); }

export function useServerEvents(l: Listener) {
  useEffect(() => {
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [l]);
}
