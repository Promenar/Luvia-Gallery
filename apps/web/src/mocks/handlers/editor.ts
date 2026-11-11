/**
 * 修复编辑器的模拟接口：能力、上传、作业轮询、结果、保存副本与外部图片导入。
 * 真实后端在没有推理服务时会返回模型不可用；这里用参考结果让界面可联调/出可视稿。
 */
import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import type { CreateEditorBatchBody, EditorBatch, EditorJob, EditorModelId } from '@luvia/contracts';
import { db, svgFor } from '../db';

const err = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status });

type MockUpload = {
  id: string; name: string; mime: string; width: number; height: number;
  bytes: ArrayBuffer; expiresAt: number;
};
type MockJob = { id: string; mediaId?: string; uploadId?: string; model: EditorModelId; createdAt: number; cancelled: boolean; automatic?: boolean };

const uploads = new Map<string, MockUpload>();
const jobs = new Map<string, MockJob>();
const batches = new Map<string, EditorBatch>();
let seq = 0;

function progressBatch(batch: EditorBatch): EditorBatch {
  if (batch.status !== 'running' || batch.items.some((item) => item.status === 'review')) return batch;
  const next = batch.items.find((item) => item.status === 'pending');
  if (next) {
    const id = `mock-editor-${++seq}`;
    jobs.set(id, { id, mediaId: next.mediaId, model: 'slbr', createdAt: Date.now() - 1600, cancelled: false, automatic: true });
    next.jobId = id;
    next.attempts = 1;
    if (batch.mode === 'review') next.status = 'review';
    else { next.status = 'saved'; next.resultMediaId = `mock-copy-${++seq}`; next.resultName = `${next.name} - 已修复.png`; }
  }
  if (batch.items.every((item) => ['saved', 'skipped', 'no_detection', 'failed', 'cancelled'].includes(item.status))) batch.status = 'completed';
  return batch;
}

function mimeOf(name: string): string {
  const ext = (/\.[^.]+$/.exec(name)?.[0] ?? '').toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.heic' || ext === '.heif') return 'image/heic';
  return 'image/jpeg';
}

function jobView(job: MockJob): EditorJob {
  const elapsed = Date.now() - job.createdAt;
  const base = {
    id: job.id,
    model: job.model,
    createdAt: new Date(job.createdAt).toISOString(),
    startedAt: elapsed >= 300 ? new Date(job.createdAt + 300).toISOString() : null,
  };
  if (job.cancelled) {
    return { ...base, status: 'cancelled', progress: 0, stage: null, error: null, resultUrl: null, finishedAt: new Date().toISOString() };
  }
  if (elapsed < 350) {
    return { ...base, status: 'queued', progress: 0.05, stage: '排队中', error: null, resultUrl: null, finishedAt: null };
  }
  if (elapsed < 1500) {
    return { ...base, status: 'running', progress: 0.55, stage: '正在推理', error: null, resultUrl: null, finishedAt: null };
  }
  return { ...base, status: 'succeeded', progress: 1, stage: null, error: null, resultUrl: `/api/v2/editor/jobs/${job.id}/result`,
    ...(job.automatic ? { maskUrl: `/api/v2/editor/jobs/${job.id}/mask`, outcome: 'detected' as const } : {}),
    finishedAt: new Date(job.createdAt + 1500).toISOString() };
}

export const editorHandlers = [
  http.get('/api/v2/editor/capabilities', async () => {
    await delay(120);
    return HttpResponse.json({
      models: [
        { id: 'migan', available: true, reason: null, device: 'cpu', maxPixels: 40_000_000, features: ['mask'] },
        { id: 'lama', available: true, reason: null, device: 'cpu', maxPixels: 40_000_000, features: ['mask'] },
        { id: 'slbr', available: true, reason: null, device: 'cpu', maxPixels: 40_000_000, features: ['mask', 'detect'] },
      ],
      write: { available: true, reason: null },
      replace: { available: true, reason: null },
      mask: { maxBytes: 8 * 1024 * 1024, maxEdge: 2048 },
    });
  }),

  // 外部图片上传：仅保存在内存，刷新页面即清空。
  http.post('/api/v2/editor/uploads', async ({ request }) => {
    const name = new URL(request.url).searchParams.get('name') ?? 'image';
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return err(400, 'VALIDATION', '图片内容为空');
    const mime = mimeOf(name);
    let width = 1600;
    let height = 1200;
    if (typeof createImageBitmap === 'function') {
      try {
        const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      } catch { /* 无法解码时使用默认尺寸，界面仍可联调。 */ }
    }
    const id = `mock-upload-${++seq}`;
    const expiresAt = Date.now() + 60 * 60_000;
    uploads.set(id, { id, name, mime, width, height, bytes, expiresAt });
    await delay(180);
    return HttpResponse.json({ id, name, width, height, mime, sourceUrl: `/api/v2/editor/uploads/${id}/source`, expiresAt: new Date(expiresAt).toISOString() });
  }),
  http.get('/api/v2/editor/uploads/:id/source', ({ params }) => {
    const upload = uploads.get(String(params.id ?? ''));
    if (!upload) return err(404, 'NOT_FOUND', '上传已过期');
    return new HttpResponse(upload.bytes, { headers: { 'content-type': upload.mime, 'cache-control': 'private, no-store' } });
  }),

  http.post('/api/v2/editor/jobs', async ({ request }) => {
    let body: { mediaId?: string; uploadId?: string; model?: EditorModelId; mask?: unknown } = {};
    try { body = await request.json() as typeof body; } catch { return err(400, 'VALIDATION', '提交的内容不符合要求'); }
    if ((!body.mediaId && !body.uploadId) || !body.model || !body.mask) return err(400, 'VALIDATION', '提交的内容不符合要求');
    if (!['migan', 'lama', 'slbr'].includes(body.model)) return err(409, 'MODEL_UNAVAILABLE', '该修复模型不可用');
    let mediaId: string | undefined;
    let uploadId: string | undefined;
    if (body.uploadId) {
      const upload = uploads.get(body.uploadId);
      if (!upload || upload.expiresAt < Date.now()) return err(404, 'NOT_FOUND', '上传已过期，请重新上传');
      uploadId = upload.id;
    } else {
      const media = db.media.find((item) => item.id === body.mediaId);
      if (!media) return err(404, 'NOT_FOUND', '媒体不存在或不可访问');
      mediaId = media.id;
    }
    const id = `mock-editor-${++seq}`;
    const mode = typeof body.mask === 'object' && 'mode' in body.mask ? body.mask.mode : null;
    const automatic = mode === 'auto' || mode === 'adjust';
    const job: MockJob = { id, mediaId, uploadId, model: body.model, createdAt: Date.now(), cancelled: false, automatic };
    jobs.set(id, job);
    await delay(160);
    return HttpResponse.json(jobView(job));
  }),
  http.get('/api/v2/editor/jobs/:id', async ({ params }) => {
    const job = jobs.get(String(params.id ?? ''));
    if (!job) return err(404, 'NOT_FOUND', '修复作业不存在');
    return HttpResponse.json(jobView(job));
  }),
  http.post('/api/v2/editor/jobs/:id/cancel', async ({ params }) => {
    const job = jobs.get(String(params.id ?? ''));
    if (!job) return err(404, 'NOT_FOUND', '修复作业不存在');
    job.cancelled = true;
    await delay(120);
    return HttpResponse.json(jobView(job));
  }),
  http.get('/api/v2/editor/jobs/:id/result', ({ params }) => {
    const job = jobs.get(String(params.id ?? ''));
    if (!job || job.cancelled || Date.now() - job.createdAt < 1500) return err(404, 'NOT_FOUND', '修复结果不存在或已过期');
    if (job.uploadId) {
      const upload = uploads.get(job.uploadId);
      if (!upload) return err(404, 'NOT_FOUND', '上传已过期');
      // 外部图片的参考结果直接返回原图；界面负责展示“未导入”的结果状态。
      return new HttpResponse(upload.bytes, { headers: { 'content-type': upload.mime } });
    }
    const media = db.media.find((item) => item.id === job.mediaId);
    if (!media) return err(404, 'NOT_FOUND', '原图已不存在');
    const svg = svgFor(media, 4200).replace('</svg>',
      '<rect x="26%" y="32%" width="38%" height="28%" rx="18" fill="#62c08f" opacity=".28"/>'
      + '<text x="45%" y="48%" font-family="sans-serif" font-size="48" fill="#ffffff" opacity=".62" text-anchor="middle">修复预览</text></svg>');
    return new HttpResponse(svg, { headers: { 'content-type': 'image/svg+xml' } });
  }),
  http.get('/api/v2/editor/jobs/:id/mask', ({ params }) => {
    const job = jobs.get(String(params.id ?? ''));
    if (!job?.automatic) return err(404, 'NOT_FOUND', '检测蒙版不存在');
    return new HttpResponse('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="black"/><rect x="1050" y="900" width="340" height="100" fill="white"/></svg>',
      { headers: { 'content-type': 'image/svg+xml' } });
  }),
  http.post('/api/v2/editor/batches', async ({ request }) => {
    const body = await request.json() as CreateEditorBatchBody;
    const id = `mock-batch-${++seq}`;
    const batch: EditorBatch = { id, mode: body.mode, status: 'running', threshold: body.threshold,
      destination: body.destination, createdAt: new Date().toISOString(), items: body.items.map((item) => ({ id: `mock-item-${++seq}`,
        mediaId: item.mediaId, name: db.media.find((media) => media.id === item.mediaId)?.name ?? '图片', status: 'pending',
        attempts: 0, jobId: null, error: null, resultMediaId: null, resultName: null })) };
    batches.set(id, batch);
    return HttpResponse.json(batch);
  }),
  http.get('/api/v2/editor/batches', ({ request }) => {
    const all = [...batches.values()].reverse();
    const cursor = Number(new URL(request.url).searchParams.get('cursor') ?? 0);
    const page = all.slice(cursor, cursor + 20).map(progressBatch);
    return HttpResponse.json({ batches: page, nextCursor: cursor + 20 < all.length ? cursor + 20 : null });
  }),
  http.get('/api/v2/editor/batches/:id', ({ params }) => {
    const batch = batches.get(String(params.id ?? ''));
    return batch ? HttpResponse.json(progressBatch(batch)) : err(404, 'NOT_FOUND', '批量任务不存在');
  }),
  http.post('/api/v2/editor/batches/:id/action', async ({ params, request }) => {
    const batch = batches.get(String(params.id ?? ''));
    if (!batch) return err(404, 'NOT_FOUND', '批量任务不存在');
    const body = await request.json() as { action: 'pause' | 'resume' | 'cancel' };
    batch.status = body.action === 'pause' ? 'paused' : body.action === 'resume' ? 'running' : 'cancelled';
    if (body.action === 'cancel') for (const item of batch.items) if (['pending', 'generating', 'review', 'saving'].includes(item.status)) item.status = 'cancelled';
    return HttpResponse.json(batch);
  }),
  http.post('/api/v2/editor/batches/:id/items/:itemId/:action', ({ params }) => {
    const batch = batches.get(String(params.id ?? ''));
    const item = batch?.items.find((value) => value.id === params.itemId);
    if (!batch || !item) return err(404, 'NOT_FOUND', '批量项目不存在');
    if (params.action === 'approve') { item.status = 'saved'; item.resultMediaId = `mock-copy-${++seq}`; item.resultName = `${item.name} - 已修复.png`; }
    else if (params.action === 'skip') item.status = 'skipped';
    else if (params.action === 'retry') { item.status = 'pending'; batch.status = 'running'; }
    return HttpResponse.json(progressBatch(batch));
  }),
  http.put('/api/v2/editor/batches/:id/items/:itemId/job', async ({ params, request }) => {
    const batch = batches.get(String(params.id ?? ''));
    const item = batch?.items.find((value) => value.id === params.itemId);
    if (!batch || !item) return err(404, 'NOT_FOUND', '批量项目不存在');
    item.jobId = (await request.json() as { jobId: string }).jobId;
    return HttpResponse.json(batch);
  }),
  http.post('/api/v2/editor/jobs/:id/save-copy', async ({ params, request }) => {
    const job = jobs.get(String(params.id ?? ''));
    if (!job) return err(404, 'NOT_FOUND', '修复作业不存在');
    if (job.cancelled || Date.now() - job.createdAt < 1500) return err(409, 'OPERATION_FAILED', '修复结果尚未就绪');
    const media = job.mediaId ? db.media.find((item) => item.id === job.mediaId) : undefined;
    if (!media) return err(404, 'NOT_FOUND', '原图已不存在');
    let body: { name?: string } = {};
    try { body = await request.json() as typeof body; } catch { return err(400, 'VALIDATION', '提交的内容不符合要求'); }
    const name = body.name?.trim();
    if (!name) return err(400, 'VALIDATION', '文件名不合法');
    const copy = { ...media, id: `mock-copy-${++seq}`, name, thumbVersion: 1 };
    db.media.push(copy);
    await delay(240);
    return HttpResponse.json({ status: 'saved', mediaId: copy.id, name, folder: copy.folder });
  }),
  http.post('/api/v2/editor/jobs/:id/replace-original', async ({ params, request }) => {
    const job = jobs.get(String(params.id ?? ''));
    const media = job?.mediaId ? db.media.find((item) => item.id === job.mediaId) : undefined;
    if (!job || !media) return err(404, 'NOT_FOUND', '原图已不存在');
    const body = await request.json() as { confirm?: boolean; source?: typeof media.source };
    const source = media.source ?? { size: media.size, modifiedAt: media.modifiedAt, generation: 0 };
    if (!body.confirm || !body.source || JSON.stringify(body.source) !== JSON.stringify(source)) return err(409, 'MEDIA_CHANGED', '原图已变化');
    media.source = { ...source, generation: source.generation + 1 };
    media.thumbVersion += 1;
    media.thumbhash = null;
    await delay(240);
    return HttpResponse.json({ status: 'saved', mediaId: media.id, source: media.source, thumbVersion: media.thumbVersion });
  }),
  http.post('/api/v2/editor/jobs/:id/import', async ({ params, request }) => {
    const job = jobs.get(String(params.id ?? ''));
    if (!job) return err(404, 'NOT_FOUND', '修复作业不存在');
    if (job.cancelled || Date.now() - job.createdAt < 1500) return err(409, 'OPERATION_FAILED', '修复结果尚未就绪');
    let body: { libraryId?: string; folder?: string; name?: string; operationId?: string } = {};
    try { body = await request.json() as typeof body; } catch { return err(400, 'VALIDATION', '提交的内容不符合要求'); }
    if (!body.libraryId || !body.name || !body.operationId) return err(400, 'VALIDATION', '提交的内容不符合要求');
    await delay(320);
    return HttpResponse.json({ status: 'saved', mediaId: `mock-import-${++seq}`, name: body.name, folder: body.folder ?? '' });
  }),
];
