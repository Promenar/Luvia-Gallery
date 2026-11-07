import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { cacheKey, cachePath, enqueueMediaTask } from '../core/media-cache.ts';
import { publishJob } from '../core/job-view.ts';
import { mediaIgnored } from '../core/media-failures.ts';

export type RecoveryResult = { metadataCandidates: number; thumbnailCandidates: number; skippedExisting: number; skippedEmpty: number; skippedUnavailable: number; metadataSkippedBusy: number; metadataReset: number; thumbnailQueued: number; nextCursor: string | null };
type Row = { id: string; library_id: string; size: number; modified_at: number; cache_generation: number; thumb_ready: number; metadata_status: string };

/** 只安排缺失小缩略图和失败元数据；保留空文件及已有缓存供检查。 */
export async function recoverMissingMedia(db: Database.Database, cacheDir: string, options: { apply: boolean; limit?: number; after?: string }): Promise<RecoveryResult> {
  const limit = options.limit ?? 1000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new Error('恢复条数无效');
  const found = db.prepare(`SELECT f.id,f.library_id,f.size,f.modified_at,f.cache_generation,f.thumb_ready,f.metadata_status
    FROM files f JOIN libraries l ON l.id=f.library_id AND l.enabled=1
    WHERE f.id>? AND f.missing_at_ms IS NULL AND f.media_type IN ('image','video') AND (f.thumb_ready=0 OR f.metadata_status='failed') ORDER BY f.id LIMIT ?`).all(options.after ?? '', limit + 1) as Row[];
  const rows = found.slice(0, limit);
  const result: RecoveryResult = { metadataCandidates: 0, thumbnailCandidates: 0, skippedExisting: 0, skippedEmpty: 0, skippedUnavailable: 0, metadataSkippedBusy: 0, metadataReset: 0, thumbnailQueued: 0, nextCursor: found.length > limit ? rows[rows.length - 1]!.id : null };
  const metadata: Row[] = []; const thumbs: Row[] = [];
  const variant = { kind: 'thumb', size: 's' } as const;
  for (const row of rows) {
    if (!row.size) { result.skippedEmpty++; continue; }
    if (row.metadata_status === 'failed' && !mediaIgnored(db, row, { kind: 'metadata' })) { result.metadataCandidates++; metadata.push(row); }
    if (row.thumb_ready !== 0 || mediaIgnored(db, row, variant)) continue;
    const filename = cachePath(cacheDir, row, variant);
    try {
      await lstat(filename);
      result.skippedExisting++; continue;
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { result.skippedUnavailable++; continue; }
    }
    result.thumbnailCandidates++; thumbs.push(row);
  }
  if (!options.apply) return result;
  db.transaction(() => {
    const libraries = new Map<string, string[]>();
    const reset = db.prepare("UPDATE files SET metadata_status='pending' WHERE id=? AND size=? AND modified_at=? AND cache_generation=? AND metadata_status='failed' AND missing_at_ms IS NULL");
    const busy = db.prepare("SELECT 1 FROM jobs WHERE type='metadata' AND status IN ('queued','running','paused') AND (json_extract(payload,'$.libraryId')=? OR json_extract(payload,'$.libraryId') IS NULL) LIMIT 1");
    for (const row of metadata) {
      if (mediaIgnored(db, row, { kind: 'metadata' })) continue;
      if (!libraries.has(row.library_id) && busy.get(row.library_id)) { result.metadataSkippedBusy++; continue; }
      if (reset.run(row.id, row.size, row.modified_at, row.cache_generation).changes) { result.metadataReset++; const ids = libraries.get(row.library_id) ?? []; ids.push(row.id); libraries.set(row.library_id, ids); }
    }
    for (const [libraryId, recoveryIds] of libraries) {
      const id = randomUUID();
      db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES (?,'metadata','重试失败的拍摄信息','queued','manual',?,unixepoch(),?)")
        .run(id, JSON.stringify({ libraryId, recovery: true, recoveryIds }), `metadata-recovery:${libraryId}`);
      publishJob(db, id);
    }
  }).immediate();
  for (const row of thumbs) {
    const added = db.transaction(() => {
      if (mediaIgnored(db, row, variant)) return false;
      const current = db.prepare("SELECT 1 FROM files WHERE id=? AND size=? AND modified_at=? AND cache_generation=? AND thumb_ready=0 AND missing_at_ms IS NULL").get(row.id, row.size, row.modified_at, row.cache_generation);
      if (!current) return false;
      const key = `media:${cacheKey(row, variant)}`;
      if (db.prepare("SELECT 1 FROM jobs WHERE dedupe_key=? AND status IN ('queued','running','paused')").get(key)) return false;
      enqueueMediaTask(db, row, variant, { preserveUnindexed: true });
      return true;
    }).immediate();
    if (added) result.thumbnailQueued++;
  }
  return result;
}
