import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { editorUploadSourceUrl } from '@luvia/contracts';
import { EditorError } from './queue.ts';

export type UploadRow = { id: string; user_id: string; name: string; mime: string; width: number; height: number; size: number; expires_at: number };
const now = () => Math.floor(Date.now() / 1000);
const validId = /^[0-9a-f-]{36}$/;
const activeUploads = new Set<string>();

export class EditorUploads {
  private db: Database.Database;
  private editorDir: string;
  private maxPixels: number;
  private ttl: number;
  private operations = new Set<Promise<unknown>>();
  private closed = false;
  constructor(db: Database.Database, editorDir: string, maxPixels: number, ttl: number) {
    this.db = db; this.editorDir = editorDir; this.maxPixels = maxPixels; this.ttl = ttl;
  }
  private directory(id: string): string {
    if (!validId.test(id)) throw new EditorError(404, 'NOT_FOUND', '上传图片不存在或已过期');
    return path.join(this.editorDir, 'uploads', id);
  }
  sourcePath(id: string): string { return path.join(this.directory(id), 'source'); }
  get(id: string, userId: string, allowExpired = false): UploadRow {
    if (!validId.test(id)) throw new EditorError(404, 'NOT_FOUND', '上传图片不存在或已过期');
    const row = this.db.prepare("SELECT * FROM editor_uploads WHERE id=? AND user_id=? AND state='ready'").get(id, userId) as UploadRow | undefined;
    if (!row || (!allowExpired && row.expires_at <= now())) throw new EditorError(404, 'NOT_FOUND', '上传图片不存在或已过期');
    return row;
  }
  create(userId: string, name: string, stream: Readable) {
    if (this.closed) throw new EditorError(503, 'MODEL_UNAVAILABLE', '图像修复服务正在关闭');
    const task = this.createInternal(userId, name, stream);
    this.operations.add(task);
    void task.then(() => this.operations.delete(task), () => this.operations.delete(task));
    return task;
  }
  async close(): Promise<void> { this.closed = true; await Promise.allSettled([...this.operations]); }
  private async createInternal(userId: string, name: string, stream: Readable) {
    if (activeUploads.has(userId) || activeUploads.size >= 4) throw new EditorError(409, 'CONFLICT', '上传正在进行，请稍后重试');
    activeUploads.add(userId);
    const clean = name.replaceAll('\\', '/').split('/').at(-1)?.trim().slice(0, 255) || '图片';
    const id = randomUUID(), dir = this.directory(id), source = this.sourcePath(id);
    try {
      const created = now();
      this.db.prepare("INSERT INTO editor_uploads(id,user_id,name,mime,width,height,size,created_at,expires_at,state) VALUES (?,?,?,'application/octet-stream',0,0,0,?,?,'uploading')")
        .run(id, userId, clean, created, created + Math.max(this.ttl, 86400));
      await mkdir(dir, { recursive: true, mode: 0o700 });
      let size = 0;
      const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > 128 * 1024 * 1024) callback(new EditorError(400, 'VALIDATION', '图片超过 128 MiB'));
        else callback(null, chunk);
      } });
      await pipeline(stream, limit, createWriteStream(source, { flags: 'wx', mode: 0o600 }));
      if (!size) throw new EditorError(400, 'VALIDATION', '图片为空');
      const meta = await sharp(source, { limitInputPixels: this.maxPixels }).metadata().catch(() => null);
      const mimes: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
      const mime = meta?.format ? mimes[meta.format] : undefined;
      if (!mime || !meta?.width || !meta.height) throw new EditorError(400, 'VALIDATION', '不支持的图片格式或图片已损坏');
      if (meta.depth !== 'uchar' || (meta.bitsPerSample ?? 8) > 8) throw new EditorError(400, 'VALIDATION', '暂不支持高位深图片修复');
      const width = meta.autoOrient?.width ?? meta.width, height = meta.autoOrient?.height ?? meta.height;
      if (width * height > this.maxPixels) throw new EditorError(400, 'VALIDATION', '图片超过像素限制');
      const expires = now() + this.ttl;
      this.db.prepare("UPDATE editor_uploads SET mime=?,width=?,height=?,size=?,expires_at=?,state='ready' WHERE id=? AND state='uploading'")
        .run(mime, width, height, size, expires, id);
      return { id, name: clean, width, height, mime, sourceUrl: editorUploadSourceUrl(id), expiresAt: new Date(expires * 1000).toISOString() };
    } catch (error) {
      try {
        await rm(dir, { recursive: true, force: true });
        this.db.prepare('DELETE FROM editor_uploads WHERE id=?').run(id);
      } catch {
        this.db.prepare("UPDATE editor_uploads SET state='deleting' WHERE id=?").run(id);
      }
      throw error;
    }
    finally { activeUploads.delete(userId); }
  }
  async source(id: string, userId: string): Promise<{ path: string; mime: string; size: number }> {
    const row = this.get(id, userId);
    const info = await stat(this.sourcePath(id)).catch(() => null);
    if (!info?.isFile() || info.size !== row.size) throw new EditorError(404, 'NOT_FOUND', '上传图片不可访问');
    return { path: this.sourcePath(id), mime: row.mime, size: row.size };
  }
  async bytes(id: string, userId: string): Promise<Buffer> {
    const source = await this.source(id, userId);
    return readFile(source.path);
  }
  async sweep(): Promise<void> {
    const rows = this.db.prepare(`SELECT id FROM editor_uploads WHERE (expires_at<? OR state='deleting')`).all(now()) as { id: string }[];
    for (const row of rows) {
      const claimed = this.db.prepare(`UPDATE editor_uploads SET state='deleting' WHERE id=? AND (expires_at<? OR state='deleting') AND NOT EXISTS
        (SELECT 1 FROM editor_jobs j WHERE j.media_id='upload:' || editor_uploads.id AND j.status IN ('queued','running'))`).run(row.id, now());
      if (!claimed.changes) continue;
      try { await rm(this.directory(row.id), { recursive: true, force: true }); }
      catch { continue; }
      this.db.prepare("DELETE FROM editor_uploads WHERE id=? AND state='deleting'").run(row.id);
    }
  }
}
