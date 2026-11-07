import { z } from 'zod';
import { IsoDateTime } from './common.ts';
import { MediaSourceVersion } from './media.ts';

/**
 * 图像修复编辑器契约。
 *
 * 模型是否可用由后端能力探测决定；前端只渲染 available=true 的模型，不得把
 * 未实现的模型当作可用功能展示。蒙版坐标统一为原图经过 EXIF 方向校正、未叠加
 * 查看器旋转的像素空间；客户端可下采样蒙版，但宽高比必须与原图一致。
 */

export const EditorModelId = z.enum(['migan', 'lama', 'slbr']);
export type EditorModelId = z.infer<typeof EditorModelId>;

/** 单个模型的能力。device 与 maxPixels 由推理服务实测返回，未知为 null。 */
export const EditorModel = z.object({
  id: EditorModelId,
  available: z.boolean(),
  /** 不可用原因（中文）。available=true 时通常为 null。 */
  reason: z.string().nullable(),
  device: z.enum(['cpu', 'cuda', 'mps', 'unknown']).nullable(),
  maxPixels: z.number().int().positive().nullable(),
  /** mask：按用户蒙版修复；detect：支持自动识别候选区域（SLBR）。 */
  features: z.array(z.enum(['mask', 'detect'])),
});
export type EditorModel = z.infer<typeof EditorModel>;

export const EditorCapabilities = z.object({
  models: z.array(EditorModel),
  /** 是否允许保存副本；只读挂载时为 false 并给出原因。 */
  write: z.object({ available: z.boolean(), reason: z.string().nullable() }),
  /** 安全覆盖原图需要服务端支持目录句柄操作。旧服务端可不返回此字段。 */
  replace: z.object({ available: z.boolean(), reason: z.string().nullable() }).optional(),
  /** 蒙版输入限制；maxBytes 指 base64 解码后的 PNG 字节数。 */
  mask: z.object({ maxBytes: z.number().int().positive(), maxEdge: z.number().int().positive() }),
});
export type EditorCapabilities = z.infer<typeof EditorCapabilities>;

export const EditorJobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type EditorJobStatus = z.infer<typeof EditorJobStatus>;

export const EditorJob = z.object({
  id: z.string(),
  status: EditorJobStatus,
  model: EditorModelId,
  /** 0–1；未知进度时由前端显示不确定进度条。 */
  progress: z.number().min(0).max(1),
  /** 当前阶段（中文），例如“正在推理”。 */
  stage: z.string().nullable(),
  /** 可直接展示的失败原因，不包含绝对路径或堆栈。 */
  error: z.string().nullable(),
  /** 结果地址；未成功时为 null。 */
  resultUrl: z.string().nullable(),
  /** 自动检测作业可返回蒙版和未检出状态。 */
  maskUrl: z.string().nullable().optional(),
  outcome: z.enum(['detected', 'no_detection']).nullable().optional(),
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
});
export type EditorJob = z.infer<typeof EditorJob>;

/** 蒙版：base64 编码的 PNG，白色 255 表示需要修复，黑色 0 表示保留。 */
export const EditorMask = z.object({
  data: z.string().min(1).max(48 * 1024 * 1024),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type EditorMask = z.infer<typeof EditorMask>;

export const AutomaticEditorMask = z.object({
  mode: z.literal('auto'),
  threshold: z.number().int().min(1).max(254).default(128),
}).strict();
/** 修正图中红色表示增加区域、蓝色表示擦除区域；黑色区域保留原始检测结果。 */
export const AdjustedEditorMask = z.object({ mode: z.literal('adjust'), baseJobId: z.string().min(1), changes: EditorMask }).strict();
export const EditorMaskInput = z.union([EditorMask, AutomaticEditorMask, AdjustedEditorMask]);
export type EditorMaskInput = z.infer<typeof EditorMaskInput>;

export const CreateEditorJobBody = z.union([
  z.object({ mediaId: z.string().min(1), source: MediaSourceVersion, model: EditorModelId, mask: EditorMaskInput }).strict(),
  z.object({ uploadId: z.string().min(1), model: EditorModelId, mask: EditorMaskInput }).strict(),
]);
export type CreateEditorJobBody = z.infer<typeof CreateEditorJobBody>;

export const SaveEditorCopyBody = z.object({
  name: z.string().trim().min(1).max(255),
  source: MediaSourceVersion,
}).strict();
export type SaveEditorCopyBody = z.infer<typeof SaveEditorCopyBody>;

export const ReplaceEditorOriginalBody = z.object({
  confirm: z.literal(true),
  source: MediaSourceVersion,
  operationId: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
export type ReplaceEditorOriginalBody = z.infer<typeof ReplaceEditorOriginalBody>;
export const ReplaceEditorOriginalResult = z.object({ status: z.literal('saved'), mediaId: z.string(), source: MediaSourceVersion, thumbVersion: z.number().int().nonnegative() });
export type ReplaceEditorOriginalResult = z.infer<typeof ReplaceEditorOriginalResult>;

export const SaveEditorCopyResult = z.object({
  status: z.enum(['saved', 'pending']),
  /** saved 时为新媒体 ID；pending 表示文件已写入但索引尚未完成。 */
  mediaId: z.string().nullable(),
  name: z.string(),
  folder: z.string(),
});
export type SaveEditorCopyResult = z.infer<typeof SaveEditorCopyResult>;

export const editorResultUrl = (id: string) => `/api/v2/editor/jobs/${encodeURIComponent(id)}/result`;
export const editorMaskUrl = (id: string) => `/api/v2/editor/jobs/${encodeURIComponent(id)}/mask`;

export const CreateEditorBatchBody = z.object({
  mode: z.enum(['review', 'auto']),
  threshold: z.number().int().min(1).max(254).default(128),
  destination: z.object({ libraryId: z.string().min(1), folder: z.string().max(4096) }).strict(),
  items: z.array(z.object({ mediaId: z.string().min(1), source: MediaSourceVersion }).strict()).min(1).max(1000),
}).strict();
export type CreateEditorBatchBody = z.infer<typeof CreateEditorBatchBody>;

export const EditorBatchItem = z.object({
  id: z.string(), mediaId: z.string(), name: z.string(),
  status: z.enum(['pending', 'generating', 'review', 'saving', 'saved', 'skipped', 'no_detection', 'failed', 'cancelled']),
  attempts: z.number().int().nonnegative(), jobId: z.string().nullable(), error: z.string().nullable(),
  resultMediaId: z.string().nullable(), resultName: z.string().nullable(),
});
export const EditorBatch = z.object({
  id: z.string(), mode: z.enum(['review', 'auto']), status: z.enum(['running', 'paused', 'cancelled', 'completed']),
  threshold: z.number().int(), destination: z.object({ libraryId: z.string(), folder: z.string() }),
  createdAt: IsoDateTime, items: z.array(EditorBatchItem),
});
export type EditorBatch = z.infer<typeof EditorBatch>;
export const EditorBatchList = z.object({ batches: z.array(EditorBatch), nextCursor: z.number().int().positive().nullable() });
export const EditorBatchActionBody = z.object({ action: z.enum(['pause', 'resume', 'cancel']) }).strict();
export const EditorBatchItemActionBody = z.object({ action: z.enum(['approve', 'skip', 'retry', 'resolve']) }).strict();
export const ReplaceEditorBatchJobBody = z.object({ jobId: z.string().min(1) }).strict();

export const EditorUpload = z.object({
  id: z.string(), name: z.string(), width: z.number().int().positive(), height: z.number().int().positive(),
  mime: z.string(), sourceUrl: z.string(), expiresAt: IsoDateTime,
});
export type EditorUpload = z.infer<typeof EditorUpload>;
export const ImportEditorResultBody = z.object({
  libraryId: z.string().min(1), folder: z.string().max(4096), name: z.string().trim().min(1).max(255),
  operationId: z.string().min(8).max(128),
}).strict();
export type ImportEditorResultBody = z.infer<typeof ImportEditorResultBody>;

/** 原始字节上传保留 XHR 进度，返回 JSON；原图访问要求同一管理员会话。 */
export const editorUploadUrl = (name: string) => `/api/v2/editor/uploads?name=${encodeURIComponent(name)}`;
export const editorUploadSourceUrl = (id: string) => `/api/v2/editor/uploads/${encodeURIComponent(id)}/source`;
