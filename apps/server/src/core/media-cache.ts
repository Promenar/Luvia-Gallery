import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { publishJob } from './job-view.ts';

export type MediaSource = { id: string; size: number; modified_at: number };
export type Variant = { kind: 'thumb'; size: 's' | 'm' | 'l' } | { kind: 'display' } | { kind: 'dimensions' } | { kind: 'preview' } | { kind: 'tile'; level: number; col: number; row: number };
export type MediaTask = { mediaId: string; sourceSize: number; sourceModified: number; variant: Variant };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function cacheKey(source: MediaSource, variant: Variant): string {
  return digest(JSON.stringify([source.id, source.size, source.modified_at, variant]));
}
export function cachePath(cacheDir: string, source: MediaSource, variant: Variant): string {
  const key = cacheKey(source, variant);
  return path.join(cacheDir, 'media', key.slice(0, 2), `${key}.${variant.kind === 'preview' ? 'mp4' : 'webp'}`);
}
export function enqueueMediaTask(db: Database.Database, source: MediaSource, variant: Variant): string {
  const key = `media:${cacheKey(source, variant)}`;
  return db.transaction(() => {
    const id = randomUUID();
    const payload: MediaTask = { mediaId: source.id, sourceSize: source.size, sourceModified: source.modified_at, variant };
    const result = db.prepare("INSERT OR IGNORE INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES (?,?,?,'queued','system',?,unixepoch(),?)")
      .run(id, variant.kind === 'preview' ? 'previews' : 'thumbnails', variant.kind === 'preview' ? '生成视频预览' : '生成媒体缓存', JSON.stringify(payload), key);
    if (result.changes) { publishJob(db, id); return id; }
    return (db.prepare("SELECT id FROM jobs WHERE dedupe_key=? AND status IN ('queued','running','paused')").get(key) as { id: string }).id;
  }).immediate();
}
