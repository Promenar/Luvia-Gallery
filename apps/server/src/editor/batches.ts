import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { CreateEditorBatchBody, EditorBatch } from '@luvia/contracts';
import { EditorError, type EditorQueue } from './queue.ts';
import { editorConfig, type EditorServiceConfig } from './service.ts';

type BatchRow = { id: string; user_id: string; mode: 'review' | 'auto'; status: EditorBatch['status'];
  threshold: number; library_id: string; folder: string; created_at: number };
type ItemRow = { id: string; batch_id: string; media_id: string; source_size: number; source_modified: number;
  source_generation: number; source_name: string; status: EditorBatch['items'][number]['status']; attempts: number;
  job_id: string | null; operation_id: string; result_media_id: string | null; result_name: string | null; error: string | null };

const now = () => Math.floor(Date.now() / 1000);
const MAX_ATTEMPTS = 3;

/** 给去重编号预留字节，兼容常见文件系统的单文件名 255 字节上限。 */
function outputName(name: string): string {
  const suffix = ' - 已修复.png';
  const limit = 255 - Buffer.byteLength(suffix) - Buffer.byteLength(' (99)');
  let stem = '';
  let bytes = 0;
  for (const character of path.parse(name).name) {
    const length = Buffer.byteLength(character);
    if (bytes + length > limit) break;
    stem += character;
    bytes += length;
  }
  return `${stem || '图片'}${suffix}`;
}

/** 持久化批次只调度一个当前项目；推理和导入分别复用既有队列与幂等发布流程。 */
export class EditorBatches {
  private timer: NodeJS.Timeout;
  private task: Promise<void> | null = null;
  private closed = false;
  private processingId: string | null = null;
  private lastBatchRowid = 0;
  private lastWasCancelled = false;
  private db: Database.Database;
  private editor: EditorQueue;
  private config: EditorServiceConfig;

  constructor(db: Database.Database, editor: EditorQueue, config: EditorServiceConfig = editorConfig()) {
    this.db = db;
    this.editor = editor;
    this.config = config;
    this.db.prepare(`UPDATE editor_batch_items SET status='cancelled' WHERE status='pending' AND job_id IS NULL
      AND batch_id IN (SELECT id FROM editor_batches WHERE status='cancelled')`).run();
    this.timer = setInterval(() => this.wake(), 400);
    this.timer.unref();
    this.wake();
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.timer);
    if (this.task) await this.task;
  }

  private wake(): void {
    if (this.closed || this.task) return;
    this.task = this.tick().catch(() => {}).finally(() => { this.task = null; });
  }

  private owned(id: string, userId: string): BatchRow {
    const row = this.db.prepare('SELECT * FROM editor_batches WHERE id=? AND user_id=?').get(id, userId) as BatchRow | undefined;
    if (!row) throw new EditorError(404, 'NOT_FOUND', '批量修复任务不存在');
    return row;
  }

  get(id: string, userId: string): EditorBatch {
    const batch = this.owned(id, userId);
    const items = this.db.prepare('SELECT * FROM editor_batch_items WHERE batch_id=? ORDER BY position').all(id) as ItemRow[];
    return { id: batch.id, mode: batch.mode, status: batch.status, threshold: batch.threshold,
      destination: { libraryId: batch.library_id, folder: batch.folder }, createdAt: new Date(batch.created_at * 1000).toISOString(),
      items: items.map((item) => ({ id: item.id, mediaId: item.media_id, name: item.source_name, status: item.status,
        attempts: item.attempts, jobId: item.job_id, error: item.error, resultMediaId: item.result_media_id, resultName: item.result_name })) };
  }

  list(userId: string, query: { cursor?: number; limit: number }): { batches: EditorBatch[]; nextCursor: number | null } {
    const rows = this.db.prepare('SELECT rowid AS cursor,id FROM editor_batches WHERE user_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?')
      .all(userId, query.cursor ?? Number.MAX_SAFE_INTEGER, query.limit + 1) as { id: string; cursor: number }[];
    const page = rows.slice(0, query.limit);
    return { batches: page.map((row) => this.get(row.id, userId)), nextCursor: rows.length > query.limit ? page.at(-1)!.cursor : null };
  }

  async create(userId: string, input: CreateEditorBatchBody): Promise<EditorBatch> {
    const models = await this.editor.capabilities();
    if (!models.models.some((model) => model.id === 'slbr' && model.available && model.features.includes('detect'))) {
      throw new EditorError(409, 'MODEL_UNAVAILABLE', 'SLBR 自动检测当前不可用');
    }
    const folder = input.destination.folder;
    if (folder.startsWith('/') || folder.includes('\\') || folder.includes('\0') ||
        (folder && folder.split('/').some((part) => !part || part === '.' || part === '..'))) throw new EditorError(400, 'VALIDATION', '目标文件夹路径无效');
    if (!this.db.prepare('SELECT 1 FROM libraries WHERE id=? AND enabled=1').get(input.destination.libraryId)) {
      throw new EditorError(404, 'NOT_FOUND', '目标媒体库不存在或未启用');
    }
    if (new Set(input.items.map((item) => item.mediaId)).size !== input.items.length) throw new EditorError(400, 'VALIDATION', '批次包含重复图片');
    const id = randomUUID();
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO editor_batches(id,user_id,mode,status,threshold,library_id,folder,created_at) VALUES (?,?,?,'running',?,?,?,?)")
        .run(id, userId, input.mode, input.threshold, input.destination.libraryId, folder, now());
      const find = this.db.prepare(`SELECT f.name,f.size,f.modified_at,f.cache_generation FROM files f JOIN libraries l ON l.id=f.library_id
        WHERE f.id=? AND f.media_type='image' AND f.missing_at_ms IS NULL AND l.enabled=1`);
      const insert = this.db.prepare(`INSERT INTO editor_batch_items(id,batch_id,position,media_id,source_size,source_modified,source_generation,source_name,status,operation_id)
        VALUES (?,?,?,?,?,?,?,?,'pending',?)`);
      input.items.forEach((item, index) => {
        const file = find.get(item.mediaId) as { name: string; size: number; modified_at: number; cache_generation: number } | undefined;
        if (!file || file.size !== item.source.size || file.modified_at !== item.source.modifiedAt || file.cache_generation !== item.source.generation) {
          throw new EditorError(409, 'MEDIA_CHANGED', '批次中的图片已发生变化，请刷新后重试');
        }
        insert.run(randomUUID(), id, index, item.mediaId, item.source.size, item.source.modifiedAt, item.source.generation, file.name, randomUUID());
      });
    }).immediate();
    this.wake();
    return this.get(id, userId);
  }

  async action(id: string, userId: string, action: 'pause' | 'resume' | 'cancel'): Promise<EditorBatch> {
    const batch = this.owned(id, userId);
    if (action === 'pause' && batch.status === 'running') this.db.prepare("UPDATE editor_batches SET status='paused' WHERE id=?").run(id);
    if (action === 'resume' && batch.status === 'paused') {
      this.db.prepare("UPDATE editor_batches SET status='running' WHERE id=?").run(id);
      this.finish(id);
    }
    if (action === 'cancel' && ['running', 'paused'].includes(batch.status)) {
      this.db.transaction(() => {
        this.db.prepare("UPDATE editor_batches SET status='cancelled' WHERE id=?").run(id);
        this.db.prepare("UPDATE editor_batch_items SET status='cancelled' WHERE batch_id=? AND status='pending' AND job_id IS NULL").run(id);
      }).immediate();
    }
    // 等当前事务收尾再返回，已进入发布的项目会明确记录最终状态。
    if ((action === 'pause' || action === 'cancel') && this.processingId && this.task &&
        this.db.prepare('SELECT 1 FROM editor_batch_items WHERE id=? AND batch_id=?').get(this.processingId, id)) await this.task;
    this.wake();
    return this.get(id, userId);
  }

  async itemAction(id: string, itemId: string, userId: string, action: string): Promise<EditorBatch> {
    const batch = this.owned(id, userId);
    if (batch.status === 'cancelled' && action !== 'resolve') throw new EditorError(409, 'CONFLICT', '批量任务已取消');
    const item = this.db.prepare('SELECT * FROM editor_batch_items WHERE id=? AND batch_id=?').get(itemId, id) as ItemRow | undefined;
    if (!item) throw new EditorError(404, 'NOT_FOUND', '批量项目不存在');
    if (action === 'resolve') {
      const recoverable = this.db.prepare("SELECT 1 FROM editor_imports WHERE operation_id=? AND status IN ('pending','attention')").get(item.operation_id);
      if (!recoverable || !item.job_id) throw new EditorError(409, 'CONFLICT', '没有需要对账的发布记录');
      const result = await this.editor.importExternal(item.job_id, userId, { libraryId: batch.library_id, folder: batch.folder,
        name: outputName(item.source_name), operationId: item.operation_id });
      if (result.status !== 'saved') throw new EditorError(409, 'OPERATION_PARTIAL', '副本已发布，索引尚未完成，请稍后重试对账');
      this.db.prepare("UPDATE editor_batch_items SET status='saved',result_media_id=?,result_name=?,error=NULL WHERE id=?").run(result.mediaId, result.name, itemId);
      this.release(item.job_id);
    } else if (action === 'approve') {
      if (item.status === 'review') this.db.prepare("UPDATE editor_batch_items SET status='saving',error=NULL,next_attempt_at=0 WHERE id=?").run(itemId);
      else if (!['saving', 'saved'].includes(item.status)) throw new EditorError(409, 'CONFLICT', '项目当前不能确认');
    } else if (action === 'skip') {
      if (item.status !== 'review' && item.status !== 'failed') throw new EditorError(409, 'CONFLICT', '项目当前不能跳过');
      this.db.prepare("UPDATE editor_batch_items SET status='skipped' WHERE id=?").run(itemId);
      if (item.job_id) this.release(item.job_id);
    } else if (action === 'retry') {
      if (item.status !== 'failed') throw new EditorError(409, 'CONFLICT', '项目当前不能重试');
      const job = item.job_id ? this.db.prepare('SELECT status,result_path,result_state,expires_at FROM editor_jobs WHERE id=?').get(item.job_id) as
        { status: string; result_path: string | null; result_state: string; expires_at: number | null } | undefined : undefined;
      const pending = !!this.db.prepare("SELECT 1 FROM editor_imports WHERE operation_id=? AND status IN ('pending','attention')").get(item.operation_id);
      const canSave = job?.status === 'succeeded' && job.result_state === 'ready' && !!job.result_path &&
        (pending || ((job.expires_at ?? 0) >= now() && existsSync(job.result_path)));
      if (pending && !canSave) throw new EditorError(409, 'OPERATION_PARTIAL', '上次发布尚未完成，请先检查目标文件夹');
      this.db.prepare('UPDATE editor_batch_items SET status=?,attempts=0,error=NULL,next_attempt_at=0,job_id=?,operation_id=? WHERE id=?')
        .run(canSave ? 'saving' : 'pending', canSave ? item.job_id : null, canSave ? item.operation_id : randomUUID(), itemId);
      if (batch.status === 'completed') this.db.prepare("UPDATE editor_batches SET status='running' WHERE id=?").run(id);
    } else throw new EditorError(400, 'VALIDATION', '未知操作');
    this.finish(id);
    this.wake();
    return this.get(id, userId);
  }

  replaceJob(id: string, itemId: string, userId: string, jobId: string): EditorBatch {
    const batch = this.owned(id, userId);
    if (!['running', 'paused'].includes(batch.status)) throw new EditorError(409, 'CONFLICT', '批量任务不能修改');
    this.db.transaction(() => {
      const item = this.db.prepare('SELECT * FROM editor_batch_items WHERE id=? AND batch_id=?').get(itemId, id) as ItemRow | undefined;
      if (!item || item.status !== 'review') throw new EditorError(409, 'CONFLICT', '项目当前不能修改');
      const job = this.db.prepare('SELECT * FROM editor_jobs WHERE id=? AND user_id=?').get(jobId, userId) as
        { media_id: string; source_size: number; source_modified: number; source_generation: number; status: string; mask_mode: string;
          result_state: string; result_path: string | null; expires_at: number | null } | undefined;
      if (!job || job.media_id !== item.media_id || job.source_size !== item.source_size || job.source_modified !== item.source_modified ||
          job.source_generation !== item.source_generation || job.status !== 'succeeded' || job.mask_mode !== 'adjust' ||
          job.result_state !== 'ready' || !job.result_path || (job.expires_at ?? 0) < now()) {
        throw new EditorError(409, 'CONFLICT', '修正后的预览不存在或已过期');
      }
      this.db.prepare('UPDATE editor_jobs SET expires_at=2147483647 WHERE id=?').run(jobId);
      this.db.prepare('UPDATE editor_batch_items SET job_id=?,error=NULL WHERE id=?').run(jobId, itemId);
      if (item.job_id && item.job_id !== jobId) this.release(item.job_id);
    }).immediate();
    return this.get(id, userId);
  }

  private release(jobId: string): void {
    this.db.prepare('UPDATE editor_jobs SET expires_at=MIN(expires_at,?) WHERE id=? AND expires_at IS NOT NULL').run(now() + this.config.jobTtlSeconds, jobId);
  }

  private finish(id: string): void {
    this.db.prepare(`UPDATE editor_batches SET status='completed' WHERE id=? AND status='running' AND NOT EXISTS
      (SELECT 1 FROM editor_batch_items WHERE batch_id=? AND status IN ('pending','generating','review','saving'))`).run(id, id);
  }

  private fail(item: ItemRow, error: unknown, stage: 'generating' | 'saving'): void {
    const message = error instanceof Error ? error.message.slice(0, 200) : '处理失败';
    const attempts = stage === 'saving' ? item.attempts + 1 : item.attempts;
    const permanent = error instanceof EditorError && ['MEDIA_CHANGED', 'NOT_FOUND', 'OPERATION_PARTIAL', 'MEDIA_READ_ONLY'].includes(error.code);
    if (attempts >= MAX_ATTEMPTS || permanent) {
      this.db.prepare("UPDATE editor_batch_items SET status='failed',attempts=?,error=? WHERE id=? AND status IN ('pending','generating','saving')").run(attempts, message, item.id);
      if (item.job_id) this.release(item.job_id);
    } else {
      this.db.prepare("UPDATE editor_batch_items SET status=?,attempts=?,error=?,next_attempt_at=?,job_id=? WHERE id=? AND status IN ('pending','generating','saving')")
        .run(stage === 'generating' ? 'pending' : 'saving', attempts, message, now() + Math.min(30, 2 ** attempts), stage === 'generating' ? null : item.job_id, item.id);
    }
  }

  /** 等待仍有效的导入租约，不把进程重启或共享槽位占用算成处理失败。 */
  private waitForImport(item: ItemRow, error: unknown): boolean {
    if (!(error instanceof EditorError) || error.code !== 'OPERATION_CONFLICT') return false;
    const op = this.db.prepare('SELECT owner,lease_until FROM editor_imports WHERE operation_id=?').get(item.operation_id) as
      { owner: string | null; lease_until: number | null } | undefined;
    const until = op?.owner && (op.lease_until ?? 0) > now() ? op.lease_until! + 1 : error.statusCode === 503 ? now() + 2 : 0;
    if (!until) return false;
    this.db.prepare("UPDATE editor_batch_items SET error='等待导入任务释放',next_attempt_at=? WHERE id=?").run(until, item.id);
    return true;
  }

  /** 取消意图持久化后允许重启继续收尾，已发布的副本仍按原操作编号完成对账。 */
  private async settleCancelled(item: ItemRow, batch: BatchRow): Promise<void> {
    let message: string | null = null;
    const pending = this.db.prepare("SELECT 1 FROM editor_imports WHERE operation_id=? AND status IN ('pending','attention')").get(item.operation_id);
    if (pending && item.job_id) {
      try {
        const result = await this.editor.importExternal(item.job_id, batch.user_id, { libraryId: batch.library_id, folder: batch.folder,
          name: outputName(item.source_name), operationId: item.operation_id });
        if (result.status === 'saved') {
          this.db.transaction(() => {
            this.db.prepare("UPDATE editor_batch_items SET status='saved',result_media_id=?,result_name=?,error=NULL WHERE id=?").run(result.mediaId, result.name, item.id);
            this.release(item.job_id!);
          }).immediate();
          return;
        }
        message = '发布尚未完成，请检查目标文件夹';
      } catch (error) {
        if (this.waitForImport(item, error)) return;
        if (!(error instanceof EditorError && error.code === 'BATCH_STOPPED')) message = '发布尚未完成，请检查目标文件夹';
      }
    }
    this.db.transaction(() => {
      this.db.prepare("UPDATE editor_batch_items SET status='cancelled',error=? WHERE id=? AND status IN ('pending','generating','review','saving')").run(message, item.id);
      if (item.job_id) this.release(item.job_id);
    }).immediate();
    if (item.job_id) await this.editor.cancel(item.job_id, batch.user_id).catch(() => {});
  }

  private async tick(): Promise<void> {
    const cancelled = this.db.prepare(`SELECT i.* FROM editor_batch_items i JOIN editor_batches b ON b.id=i.batch_id
      WHERE b.status='cancelled' AND i.status IN ('pending','generating','review','saving') AND i.next_attempt_at<=?
      ORDER BY b.rowid,i.position LIMIT 1`).get(now()) as ItemRow | undefined;
    const item = this.db.prepare(`SELECT i.*,b.rowid AS batch_rowid FROM editor_batch_items i JOIN editor_batches b ON b.id=i.batch_id
      WHERE b.status='running' AND i.status IN ('pending','generating','saving') AND i.next_attempt_at<=?
      AND (i.status!='pending' OR NOT EXISTS (SELECT 1 FROM editor_batch_items x WHERE x.batch_id=i.batch_id AND x.status IN ('generating','review','saving')))
      ORDER BY CASE WHEN b.rowid>? THEN 0 ELSE 1 END,b.rowid,i.position LIMIT 1`).get(now(), this.lastBatchRowid) as (ItemRow & { batch_rowid: number }) | undefined;
    if (cancelled && (!item || !this.lastWasCancelled)) {
      this.lastWasCancelled = true;
      const batch = this.db.prepare('SELECT * FROM editor_batches WHERE id=?').get(cancelled.batch_id) as BatchRow;
      this.processingId = cancelled.id;
      try { await this.settleCancelled(cancelled, batch); } finally { this.processingId = null; }
      return;
    }
    if (!item) return;
    this.lastWasCancelled = false;
    this.lastBatchRowid = item.batch_rowid;
    const batch = this.db.prepare('SELECT * FROM editor_batches WHERE id=?').get(item.batch_id) as BatchRow;
    this.processingId = item.id;
    try {
      if (item.status === 'pending') {
        const reservation = this.config.maxResultBytes * 2;
        const quota = Math.max(this.config.batchPendingBytes, reservation);
        const usage = (this.db.prepare(`SELECT COALESCE(sum(CASE WHEN j.status IN ('queued','running') THEN ?
          ELSE COALESCE(j.result_bytes,0)+j.mask_bytes END),0) AS bytes FROM editor_batch_items i
          JOIN editor_jobs j ON j.id=i.job_id WHERE i.status IN ('generating','review','saving')`).get(reservation) as { bytes: number }).bytes;
        if (usage + reservation > quota) {
          this.db.prepare("UPDATE editor_batch_items SET error='等待审核结果释放缓存空间',next_attempt_at=? WHERE id=? AND status='pending'").run(now() + 5, item.id);
          return;
        }
        this.db.prepare('UPDATE editor_batch_items SET attempts=attempts+1 WHERE id=? AND status=\'pending\'').run(item.id);
        item.attempts++;
        const job = await this.editor.create({ userId: batch.user_id, mediaId: item.media_id,
          source: { size: item.source_size, modifiedAt: item.source_modified, generation: item.source_generation },
          model: 'slbr', mask: { mode: 'auto', threshold: batch.threshold } });
        const updated = this.db.prepare("UPDATE editor_batch_items SET status='generating',job_id=?,error=NULL WHERE id=? AND status='pending'").run(job.id, item.id);
        if (!updated.changes) await this.editor.cancel(job.id, batch.user_id);
      } else if (item.status === 'generating' && item.job_id) {
        const job = this.editor.job(item.job_id, batch.user_id);
        if (job.status === 'succeeded' && job.outcome === 'no_detection') {
          this.db.prepare("UPDATE editor_batch_items SET status='no_detection',error=NULL WHERE id=?").run(item.id);
          this.release(item.job_id);
        } else if (job.status === 'succeeded') {
          this.db.prepare('UPDATE editor_batch_items SET status=?,error=NULL WHERE id=?').run(batch.mode === 'review' ? 'review' : 'saving', item.id);
        } else if (job.status === 'failed' || job.status === 'cancelled') {
          this.fail(item, new Error(job.error ?? '修复任务已中止'), 'generating');
        } else this.db.prepare('UPDATE editor_batch_items SET next_attempt_at=? WHERE id=?').run(now() + 1, item.id);
      } else if (item.status === 'saving' && item.job_id) {
        const result = await this.editor.importExternal(item.job_id, batch.user_id, { libraryId: batch.library_id, folder: batch.folder,
          name: outputName(item.source_name), operationId: item.operation_id });
        if (result.status === 'saved') {
          this.db.prepare("UPDATE editor_batch_items SET status='saved',result_media_id=?,result_name=?,error=NULL WHERE id=?").run(result.mediaId, result.name, item.id);
          this.release(item.job_id);
        } else this.fail(item, new Error('副本已发布但入库尚未完成，请检查目标文件夹'), 'saving');
      }
    } catch (error) {
      const state = (this.db.prepare('SELECT status FROM editor_batches WHERE id=?').get(item.batch_id) as { status: string }).status;
      if (state === 'running' && !(item.status === 'saving' && this.waitForImport(item, error))) {
        this.fail(item, error, item.status === 'saving' ? 'saving' : 'generating');
      }
    }
    finally { this.processingId = null; }
    this.finish(item.batch_id);
  }
}
