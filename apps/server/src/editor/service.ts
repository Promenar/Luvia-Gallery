import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { z } from 'zod';
import type { EditorModel } from '@luvia/contracts';

/**
 * 推理服务适配层。
 *
 * Node 进程只做协议、队列、存储与权限；模型加载/GPU 调度在独立的推理服务里完成，
 * 避免把 Python/ONNX 运行时塞进 API 或 worker 主线程。服务未配置或不可达时，
 * 能力接口必须返回 available=false，前端据此隐藏修复入口，不能把接口桩当作模型可用。
 *
 * 推理服务契约（见 docs/MEDIA_FAILURE_AND_EDITOR_DESIGN.md）：
 *   GET  {EDITOR_SERVICE_URL}/v1/models
 *   POST {EDITOR_SERVICE_URL}/v1/inpaint   multipart: model, jobId, image, mask
 *   POST {EDITOR_SERVICE_URL}/v1/detect    multipart: jobId, image
 *   POST {EDITOR_SERVICE_URL}/v1/cancel/:jobId
 */

const KNOWN_MODELS = ['migan', 'lama', 'slbr'] as const;

const ServiceModel = z.object({
  id: z.enum(KNOWN_MODELS),
  available: z.boolean(),
  reason: z.string().nullable().optional(),
  device: z.enum(['cpu', 'cuda', 'mps', 'unknown']).nullable().optional(),
  maxPixels: z.number().int().positive().nullable().optional(),
  features: z.array(z.enum(['mask', 'detect'])).optional(),
});
const ServiceModels = z.object({ models: z.array(ServiceModel) });

export const EDITOR_MODELS: readonly { id: EditorModel['id']; label: string }[] = [
  { id: 'migan', label: 'MI-GAN' },
  { id: 'lama', label: 'LaMa' },
  { id: 'slbr', label: 'SLBR' },
];

export type EditorServiceConfig = {
  url: string | null;
  token: string | null;
  maskMaxBytes: number;
  maskMaxEdge: number;
  maxResultBytes: number;
  maxImagePixels: number;
  jobTtlSeconds: number;
  maxConcurrency: number;
  probeTimeoutMs: number;
  inferenceTimeoutMs: number;
  batchPendingBytes: number;
};

const positive = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export function editorConfig(): EditorServiceConfig {
  const url = (process.env.EDITOR_SERVICE_URL ?? '').trim().replace(/\/+$/, '');
  return {
    url: url || null,
    token: (process.env.EDITOR_SERVICE_TOKEN ?? '').trim() || null,
    maskMaxBytes: positive(process.env.EDITOR_MASK_MAX_BYTES, 8 * 1024 * 1024),
    maskMaxEdge: positive(process.env.EDITOR_MASK_MAX_EDGE, 2048),
    maxResultBytes: positive(process.env.EDITOR_MAX_RESULT_BYTES, 512 * 1024 * 1024),
    maxImagePixels: positive(process.env.EDITOR_MAX_IMAGE_PIXELS, 100_000_000),
    jobTtlSeconds: positive(process.env.EDITOR_JOB_TTL_SECONDS, 3600),
    maxConcurrency: positive(process.env.EDITOR_MAX_CONCURRENCY, 1),
    probeTimeoutMs: positive(process.env.EDITOR_PROBE_TIMEOUT_MS, 2500),
    inferenceTimeoutMs: positive(process.env.EDITOR_INFERENCE_TIMEOUT_MS, 600_000),
    batchPendingBytes: positive(process.env.EDITOR_BATCH_PENDING_BYTES, 2 * 1024 * 1024 * 1024),
  };
}

const unavailable = (reason: string): EditorModel[] =>
  EDITOR_MODELS.map(({ id }) => ({ id, available: false, reason, device: null, maxPixels: null, features: ['mask'] }));

type ProbeCache = { key: string; at: number; models: EditorModel[]; ok: boolean };
let probeCache: ProbeCache | null = null;

async function fetchModels(config: EditorServiceConfig): Promise<EditorModel[]> {
  if (!config.url) return unavailable('未配置图像修复推理服务');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const response = await fetch(`${config.url}/v1/models`, { headers, signal: AbortSignal.timeout(config.probeTimeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = ServiceModels.parse(await response.json());
  const byId = new Map(payload.models.map((model) => [model.id, model]));
  return EDITOR_MODELS.map(({ id }) => {
    const model = byId.get(id);
    if (!model) return { id, available: false, reason: '推理服务未返回该模型', device: null, maxPixels: null, features: ['mask'] };
    return {
      id,
      available: model.available,
      reason: model.reason ?? null,
      device: model.device ?? null,
      maxPixels: model.maxPixels ?? null,
      features: model.features ?? ['mask'],
    };
  });
}

/** 探测模型能力；成功缓存 10 秒，失败缓存 3 秒，避免每次打开查看器都打满推理服务。 */
export async function probeModels(config: EditorServiceConfig): Promise<EditorModel[]> {
  const key = config.url ?? '';
  if (probeCache && probeCache.key === key && Date.now() - probeCache.at < (probeCache.ok ? 10_000 : 3_000)) return probeCache.models;
  try {
    const models = await fetchModels(config);
    probeCache = { key, at: Date.now(), models, ok: true };
    return models;
  } catch {
    const models = unavailable('无法连接图像修复推理服务');
    probeCache = { key, at: Date.now(), models, ok: false };
    return models;
  }
}

/** 媒体库写能力：任意一个启用的媒体库根目录可写即可保存副本；具体媒体库在保存时再校验。 */
export async function probeWrite(db: Database.Database): Promise<{ available: boolean; reason: string | null }> {
  const roots = db.prepare('SELECT root FROM libraries WHERE enabled=1').all() as { root: string }[];
  if (!roots.length) return { available: false, reason: '没有启用的媒体库' };
  const results = await Promise.all(roots.map(async ({ root }) => {
    try {
      await Promise.race([
        access(root, constants.W_OK),
        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
      ]);
      return true;
    } catch { return false; }
  }));
  return results.some(Boolean)
    ? { available: true, reason: null }
    : { available: false, reason: '媒体库目录为只读挂载，无法保存副本' };
}

export type InferenceResult = { data: Buffer; mime: string };

async function readResponseLimited(response: Response, limit: number): Promise<Buffer> {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error('修复结果超过大小限制');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

/** 调用 SLBR 检测接口，返回与输入等尺寸的灰度概率蒙版。 */
export async function runDetection(config: EditorServiceConfig, input: {
  jobId: string; image: Buffer; signal: AbortSignal;
}): Promise<Buffer> {
  if (!config.url) throw new Error('未配置图像修复推理服务');
  const boundary = `----luvia-${randomUUID()}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="jobId"\r\n\r\n${input.jobId}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="source"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    input.image,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const headers: Record<string, string> = { 'Content-Type': `multipart/form-data; boundary=${boundary}` };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const response = await fetch(`${config.url}/v1/detect`, {
    method: 'POST', body: new Uint8Array(body), headers, signal: AbortSignal.any([input.signal, AbortSignal.timeout(config.inferenceTimeoutMs)]),
  });
  if (!response.ok) throw new Error(`水印检测服务返回 ${response.status}`);
  if (!(response.headers.get('content-type') ?? '').toLowerCase().startsWith('image/png')) throw new Error('检测蒙版格式不正确');
  const data = await readResponseLimited(response, config.maxResultBytes);
  if (!data.length) throw new Error('检测蒙版为空');
  return data;
}

/** 把原图与蒙版交给推理服务。signal 用于取消；响应不是图片或超限时拒绝。 */
export async function runInference(config: EditorServiceConfig, input: {
  jobId: string; model: string; image: Buffer; mask: Buffer; signal: AbortSignal;
}): Promise<InferenceResult> {
  if (!config.url) throw new Error('未配置图像修复推理服务');
  // 手写 multipart + 固定 Buffer：取消时 undici 不会在 FormData 流上触发
  // “ReadableStream is already closed”，也便于推理服务严格限制请求体。
  const boundary = `----luvia-${randomUUID()}`;
  const chunks: Buffer[] = [];
  const text = (value: string) => chunks.push(Buffer.from(value));
  text(`--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${input.model}\r\n`);
  text(`--${boundary}\r\nContent-Disposition: form-data; name="jobId"\r\n\r\n${input.jobId}\r\n`);
  text(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="source"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  chunks.push(input.image);
  text('\r\n');
  text(`--${boundary}\r\nContent-Disposition: form-data; name="mask"; filename="mask.png"\r\nContent-Type: image/png\r\n\r\n`);
  chunks.push(input.mask);
  text('\r\n');
  text(`--${boundary}--\r\n`);
  const headers: Record<string, string> = { 'Content-Type': `multipart/form-data; boundary=${boundary}` };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  const response = await fetch(`${config.url}/v1/inpaint`, {
    method: 'POST', body: new Uint8Array(Buffer.concat(chunks)), headers,
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(config.inferenceTimeoutMs)]),
  });
  if (!response.ok) {
    const text = (await readResponseLimited(response, 8192).catch(() => Buffer.alloc(0))).toString('utf8').slice(0, 400);
    let message = '';
    try { message = (JSON.parse(text) as { error?: { message?: unknown } }).error?.message as string ?? ''; } catch { /* 非 JSON 错误体使用通用文案 */ }
    throw new Error(message && message.length <= 300 ? message : `推理服务返回 ${response.status}`);
  }
  const mime = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!mime.startsWith('image/')) throw new Error('推理服务返回的内容不是图片');
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > config.maxResultBytes) throw new Error('修复结果超过大小限制');
  const data = await readResponseLimited(response, config.maxResultBytes);
  if (!data.length) throw new Error('推理服务返回了空结果');
  return { data, mime: ['image/png', 'image/jpeg', 'image/webp'].includes(mime) ? mime : 'image/png' };
}

/** 尽力通知推理服务取消；失败不影响本地取消状态。 */
export async function cancelInference(config: EditorServiceConfig, jobId: string): Promise<void> {
  if (!config.url) return;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.token) headers.Authorization = `Bearer ${config.token}`;
  try {
    await fetch(`${config.url}/v1/cancel/${encodeURIComponent(jobId)}`, { method: 'POST', headers, signal: AbortSignal.timeout(1000) });
  } catch { /* 本地已取消，服务端清理是尽力而为。 */ }
}
