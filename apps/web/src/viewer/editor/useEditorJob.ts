import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CreateEditorJobBody, MediaSourceVersion } from '@luvia/contracts';
import { ApiError, call } from '@/lib/api';

const message = (error: unknown) => error instanceof ApiError ? error.message : '网络连接中断，请稍后重试';

/**
 * 修复作业的生命周期：创建后轮询状态，成功/失败/取消即停止。
 * 结果地址由后端返回，图片请求仍走会话 Cookie。
 */
export function useEditorJob() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ['editorJob', jobId],
    queryFn: () => call('getEditorJob', { params: { id: jobId! } }),
    enabled: !!jobId,
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      return status && (status === 'succeeded' || status === 'failed' || status === 'cancelled') ? false : 700;
    },
  });

  const create = useCallback(async (body: CreateEditorJobBody) => {
    setCreatePending(true);
    setCreateError(null);
    try {
      const created = await call('createEditorJob', { body });
      setJobId(created.id);
      return created;
    } catch (error) {
      setCreateError(message(error));
      return null;
    } finally {
      setCreatePending(false);
    }
  }, []);

  const cancel = useCallback(async () => {
    if (!jobId) return;
    try {
      await call('cancelEditorJob', { params: { id: jobId } });
      setCreateError(null);
    } catch (error) {
      setCreateError(message(error));
    }
  }, [jobId]);

  const reset = useCallback(() => {
    setJobId(null);
    setCreateError(null);
  }, []);

  const saveCopy = useCallback(async (name: string, source: MediaSourceVersion) => {
    if (!jobId) throw new Error('没有可保存的修复结果');
    return call('saveEditorCopy', { params: { id: jobId }, body: { name, source } });
  }, [jobId]);

  const replaceOriginal = useCallback(async (source: MediaSourceVersion, operationId: string) => {
    if (!jobId) throw new Error('没有可保存的修复结果');
    return call('replaceEditorOriginal', { params: { id: jobId }, body: { confirm: true, source, operationId } });
  }, [jobId]);

  const job = jobId ? query.data ?? null : null;
  return {
    job,
    jobId,
    restore: (id: string) => { setJobId(id); setCreateError(null); },
    create,
    cancel,
    reset,
    saveCopy,
    replaceOriginal,
    createPending,
    createError,
    queryError: query.error ? message(query.error) : null,
    busy: createPending || job?.status === 'queued' || job?.status === 'running',
  };
}
