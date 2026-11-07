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

export const CreateEditorJobBody = z.object({
  mediaId: z.string().min(1),
  source: MediaSourceVersion,
  model: EditorModelId,
  mask: EditorMask,
}).strict();
export type CreateEditorJobBody = z.infer<typeof CreateEditorJobBody>;

export const SaveEditorCopyBody = z.object({
  name: z.string().trim().min(1).max(255),
  source: MediaSourceVersion,
}).strict();
export type SaveEditorCopyBody = z.infer<typeof SaveEditorCopyBody>;

export const SaveEditorCopyResult = z.object({
  status: z.enum(['saved', 'pending']),
  /** saved 时为新媒体 ID；pending 表示文件已写入但索引尚未完成。 */
  mediaId: z.string().nullable(),
  name: z.string(),
  folder: z.string(),
});
export type SaveEditorCopyResult = z.infer<typeof SaveEditorCopyResult>;

export const editorResultUrl = (id: string) => `/api/v2/editor/jobs/${encodeURIComponent(id)}/result`;
