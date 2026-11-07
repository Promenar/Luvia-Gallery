import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { EditorMaskInput, EditorModelId } from '@luvia/contracts';
import { ApiError, call } from '@/lib/api';
import { createExternalEditorJob } from './external-api';

const message = (error: unknown) => error instanceof ApiError ? error.message : '网络连接中断，请稍后重试';

/** 外部图片（未入库）的作业生命周期；查询/取消沿用现有编辑器接口。 */
export function useExternalJob() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const query = useQuery({
    queryKey: ['editorJob', jobId],
    queryFn: () => call('getEditorJob', { params: { id: jobId! } }),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status && (status === 'succeeded' || status === 'failed' || status === 'cancelled') ? false : 700;
    },
  });

  const create = useCallback(async (uploadId: string, model: EditorModelId, mask: EditorMaskInput) => {
    const current = ++generation.current;
    setCreatePending(true);
    setCreateError(null);
    try {
      const created = await createExternalEditorJob({ uploadId, model, mask });
      if (generation.current !== current) {
        void call('cancelEditorJob', { params: { id: created.id } }).catch(() => {});
        return null;
      }
      setJobId(created.id);
      return created;
    } catch (error) {
      if (generation.current === current) setCreateError(message(error));
      return null;
    } finally {
      if (generation.current === current) setCreatePending(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    try { await call('cancelEditorJob', { params: { id: jobId } }); }
    catch (error) { setCreateError(message(error)); }
  }, [jobId]);

  const reset = useCallback(() => {
    generation.current++;
    setCreatePending(false);
    setJobId(null);
    setCreateError(null);
  }, []);

  const job = jobId ? query.data ?? null : null;
  return {
    job,
    jobId,
    create,
    cancel,
    reset,
    createPending,
    createError,
    queryError: query.error ? message(query.error) : null,
    busy: createPending || job?.status === 'queued' || job?.status === 'running',
  };
}
