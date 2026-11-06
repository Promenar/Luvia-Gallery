import { useEffect } from 'react';
import type { Job, LibraryChangedEvent } from '@luvia/contracts';
import { invalidate, queryClient, scheduleRefresh } from './query';

type Listener = { job?: (j: Job) => void; library?: (e: LibraryChangedEvent) => void };
const listeners = new Set<Listener>();
let source: EventSource | null = null;

/** 媒体集合变化时需要失效的查询。 */
const LIBRARY_QUERIES = ['listMedia', 'buckets', 'facets', 'folders', 'folderTree', 'favoriteFolders', 'memories'] as const;

function connect() {
  if (source || typeof EventSource === 'undefined') return;
  source = new EventSource('/api/v2/events', { withCredentials: true });
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
    void invalidate(...LIBRARY_QUERIES);
    scheduleRefresh('adminOverview', 'listLibraries');
    listeners.forEach((l) => l.library?.(ev));
  });
  source.addEventListener('session', () => {
    queryClient.invalidateQueries({ queryKey: ['authState'] });
  });
}

/** 应用登录后调用一次，建立 SSE 连接（浏览器会自动重连）。 */
export function startEvents() { connect(); }
export function stopEvents() { source?.close(); source = null; }

export function useServerEvents(l: Listener) {
  useEffect(() => {
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, [l]);
}
