import type Database from 'better-sqlite3';

export function rowIdRange(db: Database.Database): { min: number | null; max: number | null } {
  return db.prepare(`SELECT (SELECT rowid FROM files ORDER BY rowid ASC LIMIT 1) AS min,
    (SELECT rowid FROM files ORDER BY rowid DESC LIMIT 1) AS max`).get() as { min: number | null; max: number | null };
}
