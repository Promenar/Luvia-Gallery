import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { readSettings } from '../core/settings.ts';
import { publishJob } from '../core/job-view.ts';

export function scheduleScans(db: Database.Database, at = Math.floor(Date.now() / 1000)): number {
  return db.transaction(() => {
    const scan = readSettings(db).scan;
    if (scan.mode !== 'interval') return 0;
    const stored = db.prepare("SELECT value FROM settings WHERE key='scan.scheduler'").get() as { value: string } | undefined;
    let due = 0;
    try {
      const state = stored ? JSON.parse(stored.value) as { nextAt?: number; intervalMinutes?: number } : {};
      if (state.intervalMinutes === scan.intervalMinutes && typeof state.nextAt === 'number' && Number.isFinite(state.nextAt)) due = state.nextAt;
    } catch { due = 0; }
    if (due > at) return 0;
    const libraries = db.prepare('SELECT id FROM libraries WHERE enabled=1').all() as { id: string }[];
    const active = db.prepare(`SELECT 1 FROM jobs WHERE type='scan' AND status IN ('queued','running','paused')
      AND (json_extract(payload,'$.libraryId')=? OR json_extract(payload,'$.libraryId') IS NULL) LIMIT 1`);
    const insert = db.prepare("INSERT OR IGNORE INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES (?,'scan','定时扫描媒体库','queued','schedule',?,?,?)");
    let queued = 0;
    for (const library of libraries) {
      if (active.get(library.id)) continue;
      const id = randomUUID();
      if (insert.run(id, JSON.stringify({ libraryId: library.id }), at, `scan:${library.id}`).changes) { queued++; publishJob(db, id); }
    }
    db.prepare("INSERT INTO settings(key,value) VALUES('scan.scheduler',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(JSON.stringify({ nextAt: at + scan.intervalMinutes * 60, intervalMinutes: scan.intervalMinutes }));
    return queued;
  }).immediate();
}
