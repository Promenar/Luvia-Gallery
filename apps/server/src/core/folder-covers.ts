import type Database from 'better-sqlite3';

export function noteThumbnail(db: Database.Database, id: string): void {
  const candidate = db.prepare('SELECT folder,taken_at FROM files WHERE id=? AND thumb_ready=1 AND missing_at_ms IS NULL').get(id) as { folder: string; taken_at: number } | undefined;
  if (!candidate) return;
  const folder = db.prepare('SELECT parent,cover_file_id FROM folders WHERE path=? AND missing_at_ms IS NULL');
  const file = db.prepare('SELECT id,taken_at,thumb_ready FROM files WHERE id=? AND missing_at_ms IS NULL');
  const update = db.prepare('UPDATE folders SET cover_file_id=? WHERE path=?');
  const seen = new Set<string>(); let current: string | null = candidate.folder;
  while (current && !seen.has(current)) {
    seen.add(current);
    const row = folder.get(current) as { parent: string | null; cover_file_id: string | null } | undefined;
    if (!row) break;
    const old = row.cover_file_id ? file.get(row.cover_file_id) as { id: string; taken_at: number; thumb_ready: number } | undefined : undefined;
    if (!old || !old.thumb_ready || candidate.taken_at > old.taken_at || candidate.taken_at === old.taken_at && id < old.id) update.run(id, current);
    current = row.parent;
  }
}

export function replaceEvictedThumbnailCovers(db: Database.Database, id: string): void {
  const affected = db.prepare('SELECT path FROM folders WHERE cover_file_id=?').all(id) as { path: string }[];
  const best = db.prepare(`SELECT id FROM files WHERE thumb_ready=1 AND missing_at_ms IS NULL AND (folder=? OR (folder>=? AND folder<?)) ORDER BY taken_at DESC,id ASC LIMIT 1`);
  const update = db.prepare('UPDATE folders SET cover_file_id=? WHERE path=? AND cover_file_id=?');
  for (const folder of affected) {
    const next = best.get(folder.path, `${folder.path}/`, `${folder.path}0`) as { id: string } | undefined;
    update.run(next?.id ?? null, folder.path, id);
  }
}
