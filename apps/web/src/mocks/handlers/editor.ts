/**
 * 修复编辑器的模拟接口：能力、作业轮询、结果与保存副本。
 * 真实后端在没有推理服务时会返回模型不可用；这里用参考结果让界面可联调/出可视稿。
 */
import { delay } from 'msw';
import { http, HttpResponse } from 'msw/http';
import type { EditorJob, EditorModelId } from '@luvia/contracts';
import { db, svgFor } from '../db';

const err = (status: number, code: string, message: string) => HttpResponse.json({ error: { code, message } }, { status });

type MockJob = { id: string; mediaId: string; model: EditorModelId; createdAt: number; cancelled: boolean };
const jobs = new Map<string, MockJob>();
let seq = 0;

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
  return { ...base, status: 'succeeded', progress: 1, stage: null, error: null, resultUrl: `/api/v2/editor/jobs/${job.id}/result`, finishedAt: new Date(job.createdAt + 1500).toISOString() };
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
      mask: { maxBytes: 8 * 1024 * 1024, maxEdge: 2048 },
    });
  }),
  http.post('/api/v2/editor/jobs', async ({ request }) => {
    let body: { mediaId?: string; model?: EditorModelId; mask?: unknown } = {};
    try { body = await request.json() as typeof body; } catch { return err(400, 'VALIDATION', '提交的内容不符合要求'); }
    if (!body.mediaId || !body.model || !body.mask) return err(400, 'VALIDATION', '提交的内容不符合要求');
    const media = db.media.find((item) => item.id === body.mediaId);
    if (!media) return err(404, 'NOT_FOUND', '媒体不存在或不可访问');
    if (!['migan', 'lama', 'slbr'].includes(body.model)) return err(409, 'MODEL_UNAVAILABLE', '该修复模型不可用');
    const id = `mock-editor-${++seq}`;
    const job: MockJob = { id, mediaId: media.id, model: body.model, createdAt: Date.now(), cancelled: false };
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
    const media = db.media.find((item) => item.id === job.mediaId);
    if (!media) return err(404, 'NOT_FOUND', '原图已不存在');
    // 参考结果：原图叠一块半透明修复区域，便于区分原图与结果。
    const svg = svgFor(media, 4200).replace('</svg>',
      '<rect x="26%" y="32%" width="38%" height="28%" rx="18" fill="#62c08f" opacity=".28"/>'
      + '<text x="45%" y="48%" font-family="sans-serif" font-size="48" fill="#ffffff" opacity=".62" text-anchor="middle">修复预览</text></svg>');
    return new HttpResponse(svg, { headers: { 'content-type': 'image/svg+xml' } });
  }),
  http.post('/api/v2/editor/jobs/:id/save-copy', async ({ params, request }) => {
    const job = jobs.get(String(params.id ?? ''));
    if (!job) return err(404, 'NOT_FOUND', '修复作业不存在');
    if (job.cancelled || Date.now() - job.createdAt < 1500) return err(409, 'OPERATION_FAILED', '修复结果尚未就绪');
    const media = db.media.find((item) => item.id === job.mediaId);
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
];
