import { useCallback, useEffect, useState } from 'react';
import type { EditorJob } from '@luvia/contracts';

/** 在新作业完成前保留上一步预览，失败或取消后仍可返回。 */
export function useRepairContinuation(job: EditorJob | null, restore: (id: string) => void) {
  const [previous, setPrevious] = useState<EditorJob | null>(null);
  const completed = job?.status === 'succeeded' && job.id !== previous?.id;
  const base = completed ? null : previous;
  const reset = useCallback(() => setPrevious(null), []);
  useEffect(() => { if (completed) reset(); }, [completed, reset]);
  return {
    base,
    begin() { if (job?.status === 'succeeded' && job.resultUrl) setPrevious(job); },
    back() {
      if (base) restore(base.id);
      reset();
    },
    reset,
  };
}
