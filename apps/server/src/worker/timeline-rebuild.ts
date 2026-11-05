import type Database from 'better-sqlite3';
import { setTimeout as delay } from 'node:timers/promises';

export async function processTimelineRebuildBatch(db: Database.Database, batchSize = 256): Promise<boolean> {
  return db.transaction(() => {
    const state = db.prepare('SELECT cursor FROM timeline_rebuild_state WHERE id=1').get() as { cursor: number } | undefined;
    if (!state) return true;
    const limit = Math.max(1, Math.min(500, batchSize));
    const rows = db.prepare(`SELECT rowid,missing_at_ms,strftime('%Y-%m',taken_at,'unixepoch','localtime') AS month
      FROM files WHERE rowid>? ORDER BY rowid LIMIT ?`).all(state.cursor, limit) as { rowid: number; missing_at_ms: number | null; month: string | null }[];
    const increment = db.prepare('INSERT INTO timeline_rebuild_counts(month,count) VALUES (?,1) ON CONFLICT(month) DO UPDATE SET count=count+1');
    for (const row of rows) if (row.missing_at_ms === null && row.month !== null) increment.run(row.month);
    if (rows.length) db.prepare('UPDATE timeline_rebuild_state SET cursor=? WHERE id=1').run(rows[rows.length - 1]!.rowid);
    if (rows.length === limit) return false;
    db.exec('DELETE FROM timeline_counts; INSERT INTO timeline_counts SELECT month,count FROM timeline_rebuild_counts WHERE count>0; DELETE FROM timeline_rebuild_counts; DELETE FROM timeline_rebuild_state');
    return true;
  }).immediate();
}

export async function runTimelineRebuild(db: Database.Database, signal?: AbortSignal): Promise<void> {
  while (!signal?.aborted && !await processTimelineRebuildBatch(db)) {
    try { await delay(50, undefined, { signal }); } catch (error) { if (!signal?.aborted) throw error; }
  }
}
