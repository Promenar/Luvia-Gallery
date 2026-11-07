import { CSRF_HEADER, EditorUpload as EditorUploadSchema, editorUploadUrl } from '@luvia/contracts';
import type { EditorJob, EditorMaskInput, EditorModelId, EditorUpload, SaveEditorCopyResult } from '@luvia/contracts';
import { ApiError, call } from '@/lib/api';

export type ExternalUpload = EditorUpload;
export type ExternalImportResult = SaveEditorCopyResult;

function apiError(status: number, body: unknown): ApiError {
  const error = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  if (error && typeof error.code === 'string' && typeof error.message === 'string') {
    return new ApiError(status, error.code, error.message, error.details);
  }
  return new ApiError(status, `HTTP_${status}`, `请求失败（${status}）`);
}

/** 上传原始图片字节；XHR 用于真实上传进度，并支持取消。 */
export function uploadExternalImage(file: File, options: { signal?: AbortSignal; onProgress?: (ratio: number) => void } = {}): Promise<ExternalUpload> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new DOMException('已取消上传', 'AbortError')); return; }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', editorUploadUrl(file.name));
    xhr.responseType = 'json';
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader(CSRF_HEADER, '1');
    let settled = false;
    const cleanup = () => { options.signal?.removeEventListener('abort', onAbort); };
    const finish = (fn: () => void) => { if (settled) return; settled = true; cleanup(); fn(); };
    const onAbort = () => xhr.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) options.onProgress?.(Math.min(1, event.loaded / event.total));
    };
    xhr.onload = () => finish(() => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const parsed = EditorUploadSchema.safeParse(xhr.response);
        if (parsed.success) resolve(parsed.data);
        else reject(new ApiError(xhr.status, 'INVALID_RESPONSE', '上传响应无效'));
      } else reject(apiError(xhr.status, xhr.response));
    });
    xhr.onerror = () => finish(() => reject(new ApiError(0, 'NETWORK', '网络连接中断，请稍后重试')));
    xhr.onabort = () => finish(() => reject(new DOMException('已取消上传', 'AbortError')));
    xhr.send(file);
  });
}

/** 用上传 ID 创建外部图片的修复作业（与媒体作业共用 /editor/jobs）。 */
export function createExternalEditorJob(body: {
  uploadId: string;
  model: EditorModelId;
  mask: EditorMaskInput;
}): Promise<EditorJob> {
  return call('createEditorJob', { body });
}

/** 将修复结果导入所选媒体库；operationId 由客户端生成，重试必须复用。 */
export function importExternalResult(jobId: string, body: {
  libraryId: string;
  folder: string;
  name: string;
  operationId: string;
}): Promise<ExternalImportResult> {
  return call('importEditorResult', { params: { id: jobId }, body });
}
