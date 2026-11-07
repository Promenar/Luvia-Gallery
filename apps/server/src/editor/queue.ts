import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { EditorCapabilities, EditorJob, EditorMaskInput, EditorModel, SaveEditorCopyResult } from '@luvia/contracts';
import { editorMaskUrl, editorResultUrl } from '@luvia/contracts';
import { mediaId, secureMediaPath, virtualPath } from '../core/paths.ts';
import { appendLibraryChange } from '../core/library-changes.ts';
import { materializeFolders } from '../worker/scan.ts';
import { publishLibraryEvent } from '../worker/watch-events.ts';
import { statFields } from '../watch/file-info.ts';
import { planEditorTiles, type EditorTile } from './tiles.ts';
import { detectWatermark } from './detection.ts';
import { EditorUploads } from './uploads.ts';
import { cleanupRetiredImport, cleanupSavedImport, importExternalResult } from './external-import.ts';
import {
  cancelInference, probeModels, probeWrite, runInference, type EditorServiceConfig,
} from './service.ts';

type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type JobRow = {
  id: string; user_id: string; media_id: string; library_id: string;
  source_size: number; source_modified: number; source_generation: number; model: string;
  status: JobStatus; progress: number; stage: string | null; error: string | null;
  mask_path: string; result_path: string | null; result_mime: string | null; result_bytes: number | null; result_state: string;
  mask_mode: 'manual' | 'auto' | 'adjust'; mask_threshold: number | null; outcome: 'detected' | 'no_detection' | null;
  created_at: number; started_at: number | null; finished_at: number | null; expires_at: number | null;
};
type FileRow = {
  id: string; library_id: string; relative_path: string; folder: string; name: string; mime: string;
  media_type: string; size: number; modified_at: number; cache_generation: number; mtime_ms: number | null;
  width: number | null; height: number | null; taken_at: number; taken_at_source: string;
  root: string; enabled: number; missing_at_ms: number | null;
};

export class EditorError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const now = () => Math.floor(Date.now() / 1000);
const iso = (n: number | null) => n === null ? null : new Date(n * 1000).toISOString();
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JOB_ID = /^[A-Za-z0-9_-]{8,80}$/;
const MAX_IMAGE_BYTES = 128 * 1024 * 1024;
const RESULT_BUDGET_BYTES = 2 * 1024 * 1024 * 1024;
const TILE_CORE = 1024;
const TILE_CONTEXT = 128;
const TILE_MAX_PIXELS = (TILE_CORE + TILE_CONTEXT * 2) ** 2;

function safeUnder(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function sourceMatches(row: { size: number; modified_at: number; cache_generation: number }, source: { size: number; modifiedAt: number; generation: number }) {
  return row.size === source.size && row.modified_at === source.modifiedAt && row.cache_generation === source.generation;
}

function jobView(row: JobRow): EditorJob {
  const expired = row.status === 'succeeded' && row.expires_at !== null && row.expires_at < now();
  const status = expired ? 'failed' : row.status;
  return {
    id: row.id,
    status,
    model: row.model as EditorJob['model'],
    progress: expired ? 0 : row.progress,
    stage: expired ? null : row.stage,
    error: expired ? '预览已过期，请重新生成' : row.error,
    resultUrl: status === 'succeeded' && row.result_path ? editorResultUrl(row.id) : null,
    ...(row.mask_mode !== 'manual' ? { maskUrl: status === 'succeeded' ? editorMaskUrl(row.id) : null, outcome: row.outcome } : {}),
    createdAt: iso(row.created_at)!,
    startedAt: iso(row.started_at),
    finishedAt: iso(row.finished_at),
  };
}

export class EditorQueue {
  private db: Database.Database;
  private cacheDir: string;
  private editorDir: string;
  uploads: EditorUploads;
  private config: EditorServiceConfig;
  private pending: string[] = [];
  private active = new Map<string, AbortController>();
  private activeCount = 0;
  private running = new Set<Promise<void>>();
  private imports = new Set<Promise<unknown>>();
  private closed = false;
  private timer: NodeJS.Timeout;
  private sweepTask: Promise<void> | null = null;
  private recoverCursor = '';
  private cleanupCursor = '';
  private stageCursor = '';

  constructor(db: Database.Database, cacheDir: string, config: EditorServiceConfig) {
    this.db = db;
    this.cacheDir = path.resolve(cacheDir);
    this.editorDir = path.join(this.cacheDir, 'editor');
    this.config = config;
    this.uploads = new EditorUploads(db, this.editorDir, config.maxImagePixels, config.jobTtlSeconds);
    this.timer = setInterval(() => this.scheduleSweep(), 10 * 60_000);
    this.timer.unref();
  }

  async start(): Promise<void> {
    await mkdir(this.editorDir, { recursive: true });
    // 进程重启后内存队列已丢失；把未完成作业明确标成失败，避免前端无限轮询。
    this.db.prepare("UPDATE editor_jobs SET status='failed',error='服务重启，请重新生成',finished_at=?,progress=0,stage=NULL WHERE status IN ('queued','running')")
      .run(now());
    this.scheduleSweep();
  }

  private scheduleSweep(): void {
    if (!this.closed && !this.sweepTask) this.sweepTask = this.sweep().catch(() => {}).finally(() => { this.sweepTask = null; });
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    for (const controller of this.active.values()) controller.abort();
    // 等运行中的作业收尾，避免 API 关闭后异步任务再访问已经关闭的数据库。
    await Promise.allSettled([...this.running, ...this.imports, this.uploads.close(), ...(this.sweepTask ? [this.sweepTask] : [])]);
    this.active.clear();
  }

  private jobDir(id: string): string {
    if (!JOB_ID.test(id)) throw new EditorError(404, 'NOT_FOUND', '修复作业不存在');
    const dir = path.join(this.editorDir, id);
    if (!safeUnder(this.editorDir, dir)) throw new EditorError(404, 'NOT_FOUND', '修复作业不存在');
    return dir;
  }

  private load(id: string): JobRow | undefined {
    return this.db.prepare('SELECT * FROM editor_jobs WHERE id=?').get(id) as JobRow | undefined;
  }

  private owned(id: string, userId: string): JobRow {
    const row = this.load(id);
    if (!row || row.user_id !== userId) throw new EditorError(404, 'NOT_FOUND', '修复作业不存在');
    return row;
  }

  private fileRow(id: string): FileRow | undefined {
    return this.db.prepare(`SELECT f.id,f.library_id,f.relative_path,f.folder,f.name,f.mime,f.media_type,f.size,f.modified_at,f.cache_generation,
      f.width,f.height,f.taken_at,f.taken_at_source,f.mtime_ms,f.missing_at_ms,l.root,l.enabled
      FROM files f JOIN libraries l ON l.id=f.library_id WHERE f.id=?`).get(id) as FileRow | undefined;
  }

  async capabilities(): Promise<EditorCapabilities> {
    const [models, write] = await Promise.all([probeModels(this.config), probeWrite(this.db)]);
    const advertised = models.map((model) => ({ ...model,
      maxPixels: model.maxPixels && model.maxPixels >= TILE_MAX_PIXELS ? this.config.maxImagePixels
        : model.maxPixels === null ? Math.min(40_000_000, this.config.maxImagePixels) : Math.min(model.maxPixels, this.config.maxImagePixels) }));
    return { models: advertised, write, mask: { maxBytes: this.config.maskMaxBytes, maxEdge: this.config.maskMaxEdge } };
  }

  async create(input: {
    userId: string; mediaId?: string; source?: { size: number; modifiedAt: number; generation: number }; uploadId?: string;
    model: EditorModel['id']; mask: EditorMaskInput;
  }): Promise<EditorJob> {
    const models = await probeModels(this.config);
    const model = models.find((item) => item.id === input.model);
    if (!model?.available) throw new EditorError(409, 'MODEL_UNAVAILABLE', model?.reason ?? '该修复模型不可用');
    const automatic = 'mode' in input.mask && input.mask.mode === 'auto';
    if (automatic && (input.model !== 'slbr' || !model.features.includes('detect'))) {
      throw new EditorError(409, 'MODEL_UNAVAILABLE', 'SLBR 自动检测当前不可用');
    }
    const upload = input.uploadId ? this.uploads.get(input.uploadId, input.userId) : null;
    const file = upload ? { id: `upload:${upload.id}`, library_id: '', media_type: 'image', width: upload.width, height: upload.height,
      size: upload.size, modified_at: 0, cache_generation: 0, enabled: 1, missing_at_ms: null } : this.fileRow(input.mediaId ?? '');
    if (!file || !file.enabled || file.missing_at_ms !== null) throw new EditorError(404, 'NOT_FOUND', '媒体不存在或不可访问');
    if (!upload && (!input.source || !sourceMatches(file, input.source))) throw new EditorError(409, 'MEDIA_CHANGED', '媒体已发生变化，请刷新后重试');
    if (file.media_type !== 'image') throw new EditorError(400, 'INVALID_MASK', '只有图片可以修复');
    if (!file.width || !file.height) throw new EditorError(409, 'INVALID_MASK', '原图尺寸未知，无法校验蒙版');
    const maxPixels = model.maxPixels && model.maxPixels >= TILE_MAX_PIXELS ? this.config.maxImagePixels
      : model.maxPixels === null ? Math.min(40_000_000, this.config.maxImagePixels) : Math.min(model.maxPixels, this.config.maxImagePixels);
    if (file.width * file.height > maxPixels) {
      throw new EditorError(409, 'MODEL_UNAVAILABLE', '图片超过所选模型的输入上限');
    }
    let maskPng: Buffer | null = null;
    const changes = 'mode' in input.mask ? input.mask.mode === 'adjust' ? input.mask.changes : null : input.mask;
    if (changes) {
      if (changes.width > this.config.maskMaxEdge || changes.height > this.config.maskMaxEdge) {
        throw new EditorError(400, 'INVALID_MASK', `蒙版尺寸超过 ${this.config.maskMaxEdge} 像素上限`);
      }
      const raw = Buffer.from(changes.data, 'base64');
      if (!raw.length || raw.length > this.config.maskMaxBytes) throw new EditorError(400, 'INVALID_MASK', '蒙版超过大小限制');
      if (!raw.subarray(0, 8).equals(PNG)) throw new EditorError(400, 'INVALID_MASK', '蒙版必须是 PNG');
      const meta = await sharp(raw).metadata().catch(() => null);
      if (!meta?.width || !meta?.height || meta.width !== changes.width || meta.height !== changes.height) {
        throw new EditorError(400, 'INVALID_MASK', '蒙版尺寸与声明不一致');
      }
      const originalRatio = file.width / file.height;
      if (Math.abs(changes.width / changes.height - originalRatio) / originalRatio > 0.015) {
        throw new EditorError(400, 'INVALID_MASK', '蒙版宽高比必须与原图一致');
      }
      if ('mode' in input.mask && input.mask.mode === 'adjust') {
        const base = this.owned(input.mask.baseJobId, input.userId);
        if (base.media_id !== file.id || base.source_size !== file.size || base.source_modified !== file.modified_at ||
            base.source_generation !== file.cache_generation || base.mask_mode === 'manual' || base.status !== 'succeeded' ||
            base.expires_at === null || base.expires_at < now() || !safeUnder(this.editorDir, base.mask_path)) {
          throw new EditorError(409, 'MEDIA_CHANGED', '原蒙版已过期或图片已发生变化');
        }
        const originalMask = await readFile(base.mask_path).catch(() => { throw new EditorError(404, 'NOT_FOUND', '原蒙版不存在'); });
        const overlay = async (channel: 0 | 2, color: string) => {
          const component = await sharp(raw).flatten({ background: '#000' }).extractChannel(channel).png().toBuffer();
          const alpha = await sharp(component).resize(file.width!, file.height!, { kernel: 'nearest' }).threshold(128).png().toBuffer();
          return sharp({ create: { width: file.width!, height: file.height!, channels: 3, background: color } })
            .joinChannel(alpha).png().toBuffer();
        };
        const [add, remove] = await Promise.all([overlay(0, '#fff'), overlay(2, '#000')]);
        maskPng = await sharp(originalMask).removeAlpha().composite([{ input: add }, { input: remove }]).greyscale().png().toBuffer();
      } else {
        // 手绘蒙版统一转为单通道二值 PNG。
        maskPng = await sharp(raw).flatten({ background: '#000000' }).greyscale().threshold(128).png({ compressionLevel: 9 }).toBuffer();
      }
    }
    const id = randomUUID();
    const dir = this.jobDir(id);
    await mkdir(dir, { recursive: true });
    const maskPath = path.join(dir, 'mask.png');
    if (maskPng) await writeFile(maskPath, maskPng);
    try {
      this.db.transaction(() => {
        if (upload) {
          const changed = this.db.prepare("UPDATE editor_uploads SET expires_at=MAX(expires_at,?) WHERE id=? AND user_id=? AND state='ready' AND expires_at>?")
            .run(now() + this.config.jobTtlSeconds, upload.id, input.userId, now());
          if (!changed.changes) throw new EditorError(404, 'NOT_FOUND', '上传图片不存在或已过期');
        }
        this.db.prepare(`INSERT INTO editor_jobs(id,user_id,media_id,library_id,source_size,source_modified,source_generation,model,status,progress,mask_path,created_at,mask_mode,mask_threshold,mask_bytes,outcome)
          VALUES (?,?,?,?,?,?,?,?,'queued',0,?,?,?,?,?,?)`).run(id, input.userId, file.id, file.library_id,
          file.size, file.modified_at, file.cache_generation, input.model, maskPath, now(),
          'mode' in input.mask ? input.mask.mode : 'manual', automatic && 'mode' in input.mask && input.mask.mode === 'auto' ? input.mask.threshold : null,
          maskPng?.length ?? 0, 'mode' in input.mask && input.mask.mode === 'adjust' ? 'detected' : null);
      }).immediate();
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
    this.enqueue(id);
    return jobView(this.load(id)!);
  }

  private enqueue(id: string): void {
    if (this.closed) return;
    this.pending.push(id);
    this.pump();
  }

  private pump(): void {
    while (!this.closed && this.activeCount < this.config.maxConcurrency) {
      const id = this.pending.shift();
      if (!id) return;
      const job = this.load(id);
      if (!job || job.status !== 'queued') continue;
      this.activeCount++;
      const running = this.run(job).finally(() => {
        this.activeCount--;
        this.pump();
      });
      this.running.add(running);
      void running.then(() => this.running.delete(running), () => this.running.delete(running));
    }
  }

  private async run(job: JobRow): Promise<void> {
    const controller = new AbortController();
    this.active.set(job.id, controller);
    const started = this.db.prepare("UPDATE editor_jobs SET status='running',started_at=?,progress=0.05,stage='正在准备原图',error=NULL WHERE id=? AND status='queued'")
      .run(now(), job.id);
    if (!started.changes) { this.active.delete(job.id); return; }
    const dir = this.jobDir(job.id);
    try {
      const upload = job.media_id.startsWith('upload:') ? this.uploads.get(job.media_id.slice(7), job.user_id, true) : null;
      const file = upload ? { width: upload.width, height: upload.height, size: upload.size, modified_at: 0,
        cache_generation: 0, mtime_ms: null, enabled: 1, missing_at_ms: null, root: '', relative_path: '' } : this.fileRow(job.media_id);
      if (!file || !file.enabled || file.missing_at_ms !== null) throw new EditorError(404, 'NOT_FOUND', '媒体不存在或不可访问');
      if (!sourceMatches(file, { size: job.source_size, modifiedAt: job.source_modified, generation: job.source_generation })) {
        throw new EditorError(409, 'MEDIA_CHANGED', '媒体已发生变化，请重新生成');
      }
      const original = upload ? this.uploads.sourcePath(upload.id)
        : await secureMediaPath(file.root, file.relative_path).catch(() => { throw new EditorError(404, 'NOT_FOUND', '原图不可访问'); });
      const info = await stat(original).catch(() => { throw new EditorError(404, 'NOT_FOUND', '原图不可访问'); });
      if (!info.isFile() || info.size > MAX_IMAGE_BYTES) throw new EditorError(409, 'OPERATION_FAILED', '原图过大或不可读');
      if (info.size !== job.source_size || (!upload && (Math.floor(info.mtimeMs / 1000) !== job.source_modified ||
          (file.mtime_ms !== null && info.mtimeMs !== file.mtime_ms)))) {
        throw new EditorError(409, 'MEDIA_CHANGED', '原图已发生变化，请重新生成');
      }
      const originalBytes = await readFile(original);
      const originalMeta = await sharp(originalBytes).metadata();
      if (originalMeta.depth !== 'uchar' || (originalMeta.bitsPerSample ?? 8) > 8) {
        throw new EditorError(409, 'OPERATION_FAILED', '暂不支持高位深图片修复');
      }
      this.db.prepare("UPDATE editor_jobs SET progress=0.25,stage='正在推理' WHERE id=? AND status='running'").run(job.id);
      const model = (await probeModels(this.config)).find((item) => item.id === job.model);
      if (!model?.available) throw new EditorError(409, 'MODEL_UNAVAILABLE', '模型当前不可用');
      let maskBytes: Buffer;
      let selectedTiles: EditorTile[] | null = null;
      if (job.mask_mode === 'auto') {
        if (!model.features.includes('detect')) throw new EditorError(409, 'MODEL_UNAVAILABLE', 'SLBR 自动检测当前不可用');
        this.db.prepare("UPDATE editor_jobs SET progress=0.1,stage='正在检测水印' WHERE id=? AND status='running'").run(job.id);
        const detection = await detectWatermark(this.config, {
          image: originalBytes, width: file.width!, height: file.height!, jobId: job.id,
          threshold: job.mask_threshold ?? 128, signal: controller.signal,
          progress: (value) => this.db.prepare("UPDATE editor_jobs SET progress=? WHERE id=? AND status='running'").run(0.1 + value * 0.15, job.id),
        });
        maskBytes = detection.mask;
        selectedTiles = detection.selectedTiles;
        if (maskBytes.length > this.config.maxResultBytes) throw new EditorError(502, 'OPERATION_FAILED', '检测蒙版超过大小限制');
        await writeFile(job.mask_path, maskBytes);
        this.db.prepare('UPDATE editor_jobs SET mask_bytes=? WHERE id=?').run(maskBytes.length, job.id);
        if (!detection.detected) {
          this.db.prepare(`UPDATE editor_jobs SET status='succeeded',outcome='no_detection',progress=1,stage=NULL,finished_at=?,
            expires_at=CASE WHEN EXISTS (SELECT 1 FROM editor_batch_items b WHERE b.job_id=editor_jobs.id AND b.status='generating') THEN 2147483647 ELSE ? END
            WHERE id=? AND status='running'`)
            .run(now(), now() + this.config.jobTtlSeconds, job.id);
          return;
        }
        this.db.prepare("UPDATE editor_jobs SET outcome='detected',stage='正在修复水印' WHERE id=? AND status='running'").run(job.id);
      } else {
        maskBytes = await readFile(job.mask_path);
      }
      let resultPath: string;
      let resultMime: string;
      if (job.mask_mode !== 'manual' || (model.maxPixels && file.width! * file.height! > model.maxPixels)) {
        if (model.maxPixels && model.maxPixels < Math.min(file.width!, TILE_CORE + TILE_CONTEXT * 2) * Math.min(file.height!, TILE_CORE + TILE_CONTEXT * 2)) {
          throw new EditorError(409, 'MODEL_UNAVAILABLE', '模型输入上限不足以分块处理');
        }
        let tiles: EditorTile[];
        if (selectedTiles !== null) tiles = selectedTiles;
        else {
          const rawMask = await sharp(maskBytes).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
          tiles = planEditorTiles(rawMask.data, rawMask.info.width, rawMask.info.height, file.width!, file.height!, TILE_CORE, TILE_CONTEXT);
        }
        if (!tiles.length) throw new EditorError(400, 'INVALID_MASK', '请先涂抹需要修复的区域');
        const patches: Array<{ input: string; left: number; top: number; blend: 'over' }> = [];
        // 非 RGB 原图先转成 sRGB；CMYK 配置不能附着到 RGB PNG 上。
        const rgbSource = originalMeta.space === 'srgb' || originalMeta.space === 'rgb';
        const profilePath = rgbSource && originalMeta.icc ? path.join(dir, 'source.icc') : null;
        if (profilePath) await writeFile(profilePath, originalMeta.icc!);
        for (let i = 0; i < tiles.length; i++) {
          controller.signal.throwIfAborted();
          const tile = tiles[i]!;
          const [image, mask] = await Promise.all([
            (rgbSource ? sharp(originalBytes).rotate().extract(tile.region).keepIccProfile()
              : sharp(originalBytes).rotate().extract(tile.region).withIccProfile('srgb')).png().toBuffer(),
            sharp(maskBytes).resize(file.width!, file.height!, { kernel: 'nearest' }).extract(tile.region).png().toBuffer(),
          ]);
          const result = await runInference(this.config, { jobId: job.id, model: job.model, image, mask, signal: controller.signal });
          const meta = await sharp(result.data).metadata();
          if (meta.width !== tile.region.width || meta.height !== tile.region.height) {
            throw new EditorError(502, 'OPERATION_FAILED', '分块推理结果尺寸不一致');
          }
          const patch = path.join(dir, `tile-${i}.png`);
          const coreMask = await sharp(maskBytes).resize(file.width!, file.height!, { kernel: 'nearest' })
            .extract(tile.core).greyscale().png().toBuffer();
          let core = sharp(result.data).extract({ left: tile.core.left - tile.region.left, top: tile.core.top - tile.region.top,
            width: tile.core.width, height: tile.core.height }).removeAlpha();
          if (!rgbSource) {
            core = core.withIccProfile('srgb');
          } else if (profilePath && !originalMeta.icc!.equals(meta.icc ?? Buffer.alloc(0))) {
            core = core.withIccProfile(profilePath);
          } else if (!profilePath && meta.icc) {
            core = core.withIccProfile('srgb');
          } else {
            core = core.keepIccProfile();
          }
          const coreImage = await core.png().toBuffer();
          await sharp(coreImage).joinChannel(coreMask).keepIccProfile().png().toFile(patch);
          patches.push({ input: patch, left: tile.core.left, top: tile.core.top, blend: 'over' });
          this.db.prepare("UPDATE editor_jobs SET progress=?,stage='正在推理' WHERE id=? AND status='running'")
            .run(0.25 + 0.55 * ((i + 1) / tiles.length), job.id);
        }
        controller.signal.throwIfAborted();
        resultPath = path.join(dir, 'result.png');
        resultMime = 'image/png';
        if (originalMeta.hasAlpha || !rgbSource) {
          // Sharp 的移除 alpha 阶段晚于 composite，先生成不透明底图以保持未选像素。
          const basePath = path.join(dir, 'base-rgb.png');
          const rgbPath = path.join(dir, 'composed-rgb.png');
          const alphaPath = path.join(dir, 'original-alpha.png');
          const base = sharp(originalBytes).rotate().removeAlpha();
          await Promise.all([
            (rgbSource ? base.keepIccProfile() : base.withIccProfile('srgb')).png().toFile(basePath),
            ...(originalMeta.hasAlpha ? [sharp(originalBytes).rotate().ensureAlpha().extractChannel('alpha').png().toFile(alphaPath)] : []),
          ]);
          if (originalMeta.hasAlpha) {
            await sharp(basePath).composite(patches).removeAlpha().keepIccProfile().png().toFile(rgbPath);
            await sharp(rgbPath).joinChannel(alphaPath).keepIccProfile().png().toFile(resultPath);
          } else {
            await sharp(basePath).composite(patches).removeAlpha().keepIccProfile().png().toFile(resultPath);
          }
          await Promise.all([rm(basePath, { force: true }), rm(rgbPath, { force: true }), rm(alphaPath, { force: true })]);
        } else {
          await sharp(originalBytes).rotate().composite(patches).removeAlpha().keepIccProfile().png().toFile(resultPath);
        }
        await Promise.all([...patches.map((patch) => rm(patch.input, { force: true })),
          ...(profilePath ? [rm(profilePath, { force: true })] : [])]);
      } else {
        const image = originalMeta.orientation && originalMeta.orientation !== 1
          ? await sharp(originalBytes).rotate().keepIccProfile().toBuffer() : originalBytes;
        const maskMeta = await sharp(maskBytes).metadata();
        const mask = maskMeta.width !== file.width || maskMeta.height !== file.height
          ? await sharp(maskBytes).resize(file.width!, file.height!, { kernel: 'nearest' }).png().toBuffer() : maskBytes;
        const result = await runInference(this.config, { jobId: job.id, model: job.model, image, mask, signal: controller.signal });
        const resultMeta = await sharp(result.data).metadata().catch(() => null);
        if (!resultMeta?.width || !resultMeta?.height) throw new EditorError(502, 'OPERATION_FAILED', '推理结果无法读取');
        if (resultMeta.width !== file.width || resultMeta.height !== file.height) {
          throw new EditorError(502, 'OPERATION_FAILED', '推理结果尺寸与原图不一致');
        }
        const ext = result.mime === 'image/jpeg' ? 'jpg' : result.mime === 'image/webp' ? 'webp' : 'png';
        resultPath = path.join(dir, `result.${ext}`);
        resultMime = result.mime;
        await writeFile(resultPath, result.data);
      }
      this.db.prepare("UPDATE editor_jobs SET progress=0.9,stage='正在保存结果' WHERE id=? AND status='running'").run(job.id);
      const resultSize = (await stat(resultPath)).size;
      if (resultSize > this.config.maxResultBytes) throw new EditorError(502, 'OPERATION_FAILED', '修复结果超过大小限制');
      const changed = this.db.prepare(`UPDATE editor_jobs SET status='succeeded',progress=1,stage=NULL,result_path=?,result_mime=?,result_bytes=?,
        finished_at=?,expires_at=CASE WHEN EXISTS (SELECT 1 FROM editor_batch_items b WHERE b.job_id=editor_jobs.id AND b.status='generating')
          THEN 2147483647 ELSE ? END WHERE id=? AND status='running'`)
        .run(resultPath, resultMime, resultSize, now(), now() + this.config.jobTtlSeconds, job.id);
      if (!changed.changes) await rm(resultPath, { force: true });
      if (job.mask_mode === 'manual') {
        await rm(job.mask_path, { force: true });
        this.db.prepare('UPDATE editor_jobs SET mask_bytes=0 WHERE id=?').run(job.id);
      }
    } catch (error) {
      const current = this.load(job.id);
      if (current?.status === 'cancelled' || controller.signal.aborted) {
        if (current?.status !== 'cancelled') {
          this.db.prepare("UPDATE editor_jobs SET status='cancelled',error=NULL,finished_at=?,progress=0,stage=NULL WHERE id=? AND status IN ('queued','running')").run(now(), job.id);
        }
        await rm(dir, { recursive: true, force: true });
        return;
      }
      const message = error instanceof EditorError ? error.message
        : error instanceof Error && error.name === 'AbortError' ? '已取消'
          : error instanceof Error && /超时|大小|图片|模型|显存|内存|不支持/.test(error.message) ? error.message.slice(0, 200)
            : '图像修复失败，请稍后重试';
      this.db.prepare("UPDATE editor_jobs SET status='failed',error=?,finished_at=?,progress=0,stage=NULL WHERE id=? AND status IN ('queued','running')")
        .run(message, now(), job.id);
      await rm(dir, { recursive: true, force: true });
    } finally {
      this.active.delete(job.id);
    }
  }

  job(id: string, userId: string): EditorJob {
    return jobView(this.owned(id, userId));
  }

  async cancel(id: string, userId: string): Promise<EditorJob> {
    const row = this.owned(id, userId);
    if (row.status === 'queued') {
      this.pending = this.pending.filter((item) => item !== id);
      this.db.prepare("UPDATE editor_jobs SET status='cancelled',finished_at=?,progress=0,stage=NULL,error=NULL WHERE id=? AND status='queued'").run(now(), id);
      await rm(this.jobDir(id), { recursive: true, force: true });
    } else if (row.status === 'running') {
      this.db.prepare("UPDATE editor_jobs SET status='cancelled',finished_at=?,progress=0,stage=NULL,error=NULL WHERE id=? AND status='running'").run(now(), id);
      this.active.get(id)?.abort();
      await cancelInference(this.config, id);
    }
    return jobView(this.load(id)!);
  }

  /** 结果文件；调用方已经完成归属校验。 */
  async result(id: string, userId: string): Promise<{ path: string; mime: string; bytes: number }> {
    const row = this.owned(id, userId);
    if (row.status !== 'succeeded' || row.result_state !== 'ready' || !row.result_path || !row.result_mime || row.expires_at === null || row.expires_at < now()) {
      throw new EditorError(404, 'NOT_FOUND', '修复结果不存在或已过期');
    }
    if (!safeUnder(this.editorDir, row.result_path)) throw new EditorError(404, 'NOT_FOUND', '修复结果不可访问');
    const info = await stat(row.result_path).catch(() => { throw new EditorError(404, 'NOT_FOUND', '修复结果已过期'); });
    if (!info.isFile()) throw new EditorError(404, 'NOT_FOUND', '修复结果不可访问');
    return { path: row.result_path, mime: row.result_mime, bytes: info.size };
  }

  async mask(id: string, userId: string): Promise<{ path: string; bytes: number }> {
    const row = this.owned(id, userId);
    if (row.mask_mode === 'manual' || row.status !== 'succeeded' || row.expires_at === null || row.expires_at < now() ||
        !safeUnder(this.editorDir, row.mask_path)) throw new EditorError(404, 'NOT_FOUND', '检测蒙版不存在或已过期');
    const info = await stat(row.mask_path).catch(() => { throw new EditorError(404, 'NOT_FOUND', '检测蒙版不存在或已过期'); });
    if (!info.isFile()) throw new EditorError(404, 'NOT_FOUND', '检测蒙版不可访问');
    return { path: row.mask_path, bytes: info.size };
  }

  async importExternal(id: string, userId: string, body: { libraryId: string; folder: string; name: string; operationId: string }) {
    const saved = this.db.prepare("SELECT user_id,job_id,library_id,folder,requested_name,final_name,media_id FROM editor_imports WHERE operation_id=? AND status='saved'")
      .get(body.operationId) as { user_id: string; job_id: string; library_id: string; folder: string; requested_name: string; final_name: string; media_id: string } | undefined;
    if (saved) {
      if (saved.user_id !== userId || saved.job_id !== id || saved.library_id !== body.libraryId || saved.folder !== body.folder || saved.requested_name !== body.name) {
        throw new EditorError(409, 'OPERATION_CONFLICT', '操作编号已用于其他导入');
      }
      return { status: 'saved' as const, mediaId: saved.media_id, name: saved.final_name, folder: saved.folder };
    }
    const job = this.owned(id, userId);
    if (!job.result_path || !safeUnder(this.editorDir, job.result_path)) throw new EditorError(404, 'NOT_FOUND', '修复结果不存在');
    if (this.closed) throw new EditorError(503, 'MODEL_UNAVAILABLE', '图像修复服务正在关闭');
    const recoverable = this.db.prepare("SELECT 1 FROM editor_imports WHERE operation_id=? AND user_id=? AND job_id=? AND status IN ('pending','attention')")
      .get(body.operationId, userId, id);
    if (!job.media_id.startsWith('upload:') && !recoverable) {
      const file = this.fileRow(job.media_id);
      if (!file || !file.enabled || file.missing_at_ms !== null ||
          !sourceMatches(file, { size: job.source_size, modifiedAt: job.source_modified, generation: job.source_generation })) {
        throw new EditorError(409, 'MEDIA_CHANGED', '原图已发生变化，请重新生成');
      }
      const original = await secureMediaPath(file.root, file.relative_path).catch(() => { throw new EditorError(404, 'NOT_FOUND', '原图不可访问'); });
      const info = await stat(original).catch(() => { throw new EditorError(404, 'NOT_FOUND', '原图不可访问'); });
      if (!info.isFile() || info.size !== job.source_size || Math.floor(info.mtimeMs / 1000) !== job.source_modified ||
          (file.mtime_ms !== null && info.mtimeMs !== file.mtime_ms)) throw new EditorError(409, 'MEDIA_CHANGED', '原图已在磁盘上变化，请重新生成');
    }
    const task = importExternalResult(this.db, userId, job, body).then(async (result) => {
      if (result.status === 'saved') await cleanupSavedImport(this.db, body.operationId).catch(() => {});
      return result;
    });
    this.imports.add(task);
    void task.then(() => this.imports.delete(task), () => this.imports.delete(task));
    return task;
  }

  async saveCopy(id: string, userId: string, body: { name: string; source: { size: number; modifiedAt: number; generation: number } }): Promise<SaveEditorCopyResult> {
    const job = this.owned(id, userId);
    if (job.status !== 'succeeded' || !job.result_path) throw new EditorError(409, 'OPERATION_FAILED', '修复结果尚未就绪');
    if (job.expires_at !== null && job.expires_at < now()) throw new EditorError(404, 'NOT_FOUND', '预览已过期，请重新生成');
    if (!safeUnder(this.editorDir, job.result_path)) throw new EditorError(404, 'NOT_FOUND', '修复结果不可访问');
    const file = this.fileRow(job.media_id);
    if (!file || !file.enabled || file.missing_at_ms !== null) throw new EditorError(404, 'NOT_FOUND', '原图不存在或不可访问');
    if (!sourceMatches(file, body.source) || !sourceMatches(file, { size: job.source_size, modifiedAt: job.source_modified, generation: job.source_generation })) {
      throw new EditorError(409, 'MEDIA_CHANGED', '原图已发生变化，请重新生成');
    }
    const base = body.name.trim();
    if (!base || base === '.' || base === '..' || base.includes('/') || base.includes('\\') || base.includes('\0')) {
      throw new EditorError(400, 'VALIDATION', '文件名不合法');
    }
    let ext = path.extname(base).toLowerCase();
    if (!ext) ext = '.png';
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) throw new EditorError(400, 'VALIDATION', '只支持 PNG、JPEG 或 WebP 副本');
    const stem = base.slice(0, base.length - path.extname(base).length).trim() || '修复副本';
    const original = await secureMediaPath(file.root, file.relative_path).catch(() => { throw new EditorError(404, 'NOT_FOUND', '原图不可访问'); });
    const originalPath = await stat(original).catch(() => { throw new EditorError(404, 'NOT_FOUND', '原图不可访问'); });
    if (!originalPath.isFile()) throw new EditorError(409, 'MEDIA_CHANGED', '原图不是普通文件');
    if (originalPath.size !== body.source.size || Math.floor(originalPath.mtimeMs / 1000) !== body.source.modifiedAt ||
        (file.mtime_ms !== null && originalPath.mtimeMs !== file.mtime_ms)) {
      throw new EditorError(409, 'MEDIA_CHANGED', '原图已在磁盘上变化，请重新生成');
    }
    const directory = path.dirname(original);
    const root = await realpath(file.root).catch(() => null);
    if (!root || !safeUnder(root, directory)) throw new EditorError(403, 'FORBIDDEN', '保存目录不在媒体库内');
    try { await access(directory, constants.W_OK); }
    catch { throw new EditorError(409, 'MEDIA_READ_ONLY', '媒体库目录当前为只读挂载，无法保存副本'); }

    // 将索引中的拍摄时刻写入副本，后续重新提取元数据时仍能恢复同一时间。
    const date = new Date(file.taken_at * 1000).toISOString();
    const captureTime = `${date.slice(0, 10).replaceAll('-', ':')} ${date.slice(11, 19)}`;
    const output = sharp(job.result_path).keepIccProfile().withExif({ IFD2: { DateTimeOriginal: captureTime, OffsetTimeOriginal: '+00:00' } });
    const encoded = ext === '.jpg' || ext === '.jpeg'
      ? await output.jpeg({ quality: 92 }).toBuffer()
      : ext === '.webp' ? await output.webp({ quality: 92 }).toBuffer()
        : await output.png({ compressionLevel: 9 }).toBuffer();
    const meta = await sharp(encoded).metadata().catch(() => null);
    if (!meta?.width || !meta?.height) throw new EditorError(502, 'OPERATION_FAILED', '修复结果无法保存');
    let target = '';
    let written: Awaited<ReturnType<typeof stat>> | null = null;
    for (let index = 0; index < 100; index++) {
      const candidate = path.join(directory, index === 0 ? `${stem}${ext}` : `${stem} (${index})${ext}`);
      try {
        await writeFile(candidate, encoded, { flag: 'wx' });
        target = candidate;
        written = await stat(candidate);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        if ((error as NodeJS.ErrnoException).code === 'EACCES' || (error as NodeJS.ErrnoException).code === 'EROFS') {
          throw new EditorError(409, 'MEDIA_READ_ONLY', '媒体库目录当前为只读挂载，无法保存副本');
        }
        throw new EditorError(500, 'OPERATION_FAILED', '保存副本失败，请稍后重试');
      }
    }
    if (!target || !written) throw new EditorError(409, 'OPERATION_CONFLICT', '同名副本过多，请换一个文件名');
    const relative = path.relative(root, target).split(path.sep).join('/');
    const folderRelative = path.posix.dirname(relative);
    const folder = virtualPath(file.library_id, folderRelative === '.' ? '' : folderRelative);
    const name = path.basename(target);
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const newId = mediaId(file.library_id, relative);
    const identity = statFields(await stat(target, { bigint: true }));
    try {
      this.db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,width,height,mtime_ms,dev,ino)
        VALUES (?,?,?,?,?,?,'image',?,?,?,?,?,?,?,?,?)`).run(newId, file.library_id, relative, folder, name, mime,
        written.size, Math.floor(written.mtimeMs / 1000), file.taken_at, file.taken_at_source, meta.width, meta.height, identity.mtimeMs, identity.dev, identity.ino);
    } catch {
      // 文件已经写入磁盘；索引交给下一次扫描/监控，不能谎称已完整入库。
      return { status: 'pending', mediaId: null, name, folder };
    }
    try { await materializeFolders(this.db, file.library_id, () => {}); } catch { /* 下次扫描对账目录统计。 */ }
    try {
      appendLibraryChange(this.db, file.library_id, { ts: new Date().toISOString(), kind: 'added', path: relative, fromPath: null, isDir: false, mediaId: newId, source: 'scan' });
      publishLibraryEvent(this.db, { libraryId: file.library_id, source: 'scan', folders: [folder], added: 1, removed: 0, updated: 0, moved: 0 });
    } catch { /* 事件失败不影响已经完成的保存。 */ }
    return { status: 'saved', mediaId: newId, name, folder };
  }

  private async removeExpiredResult(id: string): Promise<boolean> {
    const claimed = this.db.prepare(`UPDATE editor_jobs SET result_state='deleting' WHERE id=? AND result_state IN ('ready','deleting') AND NOT EXISTS
      (SELECT 1 FROM editor_imports i WHERE i.job_id=editor_jobs.id AND i.status IN ('pending','attention')) AND NOT EXISTS
      (SELECT 1 FROM editor_batch_items b WHERE b.job_id=editor_jobs.id AND b.status IN ('generating','review','saving'))`).run(id);
    if (!claimed.changes) return false;
    try { await rm(this.jobDir(id), { recursive: true, force: true }); } catch { return false; }
    this.db.prepare("DELETE FROM editor_jobs WHERE id=? AND result_state='deleting'").run(id);
    return true;
  }

  async sweep(): Promise<void> {
    await this.uploads.sweep();
    const recover = this.db.prepare(`SELECT operation_id,user_id,job_id,library_id,folder,requested_name FROM editor_imports i
      WHERE status='pending' AND operation_id>? AND NOT EXISTS (SELECT 1 FROM editor_batch_items b WHERE b.operation_id=i.operation_id)
      ORDER BY operation_id LIMIT 20`).all(this.recoverCursor) as
      { operation_id: string; user_id: string; job_id: string; library_id: string; folder: string; requested_name: string }[];
    this.recoverCursor = recover.at(-1)?.operation_id ?? '';
    for (const row of recover) await this.importExternal(row.job_id, row.user_id, { libraryId: row.library_id, folder: row.folder, name: row.requested_name, operationId: row.operation_id }).catch(() => {});
    const cleanup = this.db.prepare("SELECT operation_id FROM editor_imports WHERE status='saved' AND stage_name IS NOT NULL AND operation_id>? ORDER BY operation_id LIMIT 20").all(this.cleanupCursor) as { operation_id: string }[];
    this.cleanupCursor = cleanup.at(-1)?.operation_id ?? '';
    for (const row of cleanup) await cleanupSavedImport(this.db, row.operation_id).catch(() => {});
    const stages = this.db.prepare('SELECT stage_name FROM editor_import_stage_gc WHERE stage_name>? ORDER BY stage_name LIMIT 20').all(this.stageCursor) as { stage_name: string }[];
    this.stageCursor = stages.at(-1)?.stage_name ?? '';
    for (const row of stages) await cleanupRetiredImport(this.db, row.stage_name).catch(() => {});

    const expired = this.db.prepare("SELECT id,mask_path,result_path FROM editor_jobs j WHERE expires_at IS NOT NULL AND (expires_at<? OR result_state='deleting') AND NOT EXISTS (SELECT 1 FROM editor_imports i WHERE i.job_id=j.id AND i.status IN ('pending','attention'))").all(now()) as { id: string; mask_path: string; result_path: string | null }[];
    for (const row of expired) await this.removeExpiredResult(row.id);
    const stale = this.db.prepare("SELECT id FROM editor_jobs WHERE status IN ('failed','cancelled') AND finished_at IS NOT NULL AND finished_at<?").all(now() - 86_400) as { id: string }[];
    for (const row of stale) {
      await rm(this.jobDir(row.id), { recursive: true, force: true }).catch(() => {});
      this.db.prepare('DELETE FROM editor_jobs WHERE id=?').run(row.id);
    }
    // 结果缓存按总量回收，优先保留最近生成的。
    const total = (this.db.prepare("SELECT COALESCE(sum(COALESCE(result_bytes,0)+mask_bytes),0) AS n FROM editor_jobs WHERE status='succeeded'").get() as { n: number }).n;
    if (total <= RESULT_BUDGET_BYTES) return;
    let over = total - RESULT_BUDGET_BYTES;
    const rows = this.db.prepare(`SELECT id,result_bytes,mask_bytes FROM editor_jobs j WHERE status='succeeded'
      AND NOT EXISTS (SELECT 1 FROM editor_imports i WHERE i.job_id=j.id AND i.status IN ('pending','attention'))
      AND NOT EXISTS (SELECT 1 FROM editor_batch_items b WHERE b.job_id=j.id AND b.status IN ('generating','review','saving'))
      ORDER BY created_at ASC LIMIT 200`).all() as { id: string; result_bytes: number | null; mask_bytes: number }[];
    for (const row of rows) {
      if (over <= 0) break;
      if (await this.removeExpiredResult(row.id)) over -= (row.result_bytes ?? 0) + row.mask_bytes;
    }
  }
}

export async function createEditorQueue(db: Database.Database, cacheDir: string, config: EditorServiceConfig): Promise<EditorQueue> {
  const queue = new EditorQueue(db, cacheDir, config);
  await queue.start();
  return queue;
}
