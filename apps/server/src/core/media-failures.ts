import type Database from 'better-sqlite3';
import type { MediaSource, Variant } from './media-cache.ts';

/** 不同缓存变体分别计数，成功的尺寸不掩盖其他尺寸的连续失败。 */
type FailureVariant = Variant | { kind: 'metadata' };
export function failureOperation(variant: FailureVariant): string {
  if (variant.kind === 'thumb') return `thumb:${variant.size}`;
  if (variant.kind === 'tile') return `tile:${variant.level}:${variant.col}:${variant.row}`;
  return variant.kind;
}
const args = (source: MediaSource, variant: FailureVariant) => [source.id, failureOperation(variant), source.size, source.modified_at, source.cache_generation ?? 0] as const;

export class MediaIgnoredError extends Error {
  readonly code = 'MEDIA_IGNORED';
  constructor() { super('此媒体处理已连续失败，等待管理员处理'); }
}

/** 只输出可公开的系统错误码；无法确认的原因保持 unknown。 */
export function classifyMediaFailure(error: unknown, decode = false): { category: 'missing' | 'permission' | 'decode' | 'storage' | 'unknown'; errorCode?: string } {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ENOENT' || code === 'ENOTDIR') return { category: 'missing', errorCode: code };
  if (code === 'EACCES' || code === 'EPERM') return { category: 'permission', errorCode: code };
  if (code === 'ENOSPC' || code === 'EDQUOT' || code === 'EROFS' || code === 'EIO') return { category: 'storage', errorCode: code };
  return { category: decode ? 'decode' : 'unknown' };
}

export function mediaIgnored(db: Database.Database, source: MediaSource, variant: FailureVariant): boolean {
  return !!db.prepare(`SELECT 1 FROM media_failures WHERE media_id=? AND operation=? AND source_size=? AND source_modified=? AND source_generation=? AND ignored=1`).get(...args(source, variant));
}

/** 调用方负责在租约保护的事务中调用；源版本已变化时不计入新文件。 */
export function recordMediaFailure(db: Database.Database, source: MediaSource, variant: FailureVariant, reason: string,
  diagnostic: { category: 'missing' | 'permission' | 'decode' | 'storage' | 'unknown'; errorCode?: string } = { category: 'unknown' }): void {
  db.prepare(`INSERT INTO media_failures(media_id,operation,source_size,source_modified,source_generation,failures,ignored,reason,last_failed_at,category,error_code)
    SELECT ?,?,?,?,?,1,0,?,unixepoch(),?,? WHERE EXISTS (SELECT 1 FROM files WHERE id=? AND size=? AND modified_at=? AND cache_generation=?)
    ON CONFLICT(media_id,operation,source_size,source_modified,source_generation) DO UPDATE SET
      failures=failures+1,ignored=CASE WHEN failures+1>=3 THEN 1 ELSE ignored END,reason=excluded.reason,last_failed_at=excluded.last_failed_at,
      category=excluded.category,error_code=excluded.error_code`)
    .run(...args(source, variant), reason, diagnostic.category, diagnostic.errorCode ?? null, source.id, source.size, source.modified_at, source.cache_generation ?? 0);
}

export function clearMediaFailure(db: Database.Database, source: MediaSource, variant: FailureVariant): void {
  db.prepare('DELETE FROM media_failures WHERE media_id=? AND operation=? AND source_size=? AND source_modified=? AND source_generation=?').run(...args(source, variant));
}
