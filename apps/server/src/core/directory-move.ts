import type Database from 'better-sqlite3';
import { virtualPath } from './paths.ts';

function remap(value: string, source: string, target: string): string {
  return value === source || value.startsWith(`${source}/`) ? target + value.slice(source.length) : value;
}

/** 调用方负责事务、目录身份校验、日志和汇总更新。 */
export function moveDirectoryPaths(db: Database.Database, libraryId: string, from: string, to: string, toParent: string): void {
  const source = virtualPath(libraryId, from); const target = virtualPath(libraryId, to);
  if (source === target) return;
  if (target.startsWith(`${source}/`) || source.startsWith(`${target}/`)) throw new Error('目录移动目标与源重叠');
  db.prepare('DELETE FROM scan_expiry_logged WHERE library_id=? AND (path=? OR (path>=? AND path<?))').run(libraryId, from, `${from}/`, `${from}0`);
  db.prepare(`UPDATE files SET relative_path=? || substr(relative_path,length(?)+1),folder=? || substr(folder,length(?)+1)
    WHERE library_id=? AND (folder=? OR (folder>=? AND folder<?))`)
    .run(to, from, target, source, libraryId, source, `${source}/`, `${source}0`);
  db.prepare(`UPDATE folders SET path=? || substr(path,length(?)+1),
    parent=CASE WHEN path=? THEN ? ELSE ? || substr(parent,length(?)+1) END
    WHERE library_id=? AND (path=? OR (path>=? AND path<?))`)
    .run(target, source, source, toParent, target, source, libraryId, source, `${source}/`, `${source}0`);
  db.prepare(`INSERT OR IGNORE INTO favorites(user_id,item_id,item_type,created_at)
    SELECT user_id,? || substr(item_id,length(?)+1),item_type,created_at FROM favorites
    WHERE item_type='folder' AND (item_id=? OR (item_id>=? AND item_id<?))`)
    .run(target, source, source, `${source}/`, `${source}0`);
  db.prepare("DELETE FROM favorites WHERE item_type='folder' AND (item_id=? OR (item_id>=? AND item_id<?))").run(source, `${source}/`, `${source}0`);
  const users = db.prepare('SELECT id,allowed_paths FROM users WHERE allowed_paths IS NOT NULL').all() as { id: string; allowed_paths: string }[];
  for (const row of users) {
    const values = JSON.parse(row.allowed_paths) as string[]; const next = values.map((value) => remap(value, source, target));
    if (next.some((value, index) => value !== values[index])) db.prepare('UPDATE users SET allowed_paths=? WHERE id=?').run(JSON.stringify(next), row.id);
  }
  for (const [table, key, column, field] of [['albums', 'id', 'filter', 'under'], ['shares', 'id', 'target', 'path'], ['download_tickets', 'token_hash', 'target', 'folder'], ['api_tokens', 'id', 'wallpaper', 'folder']] as const) {
    const rows = db.prepare(`SELECT ${key} AS id,${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`).all() as { id: string; value: string }[];
    for (const row of rows) {
      const value = JSON.parse(row.value) as Record<string, unknown>;
      if (typeof value[field] !== 'string') continue;
      const mapped = remap(value[field] as string, source, target);
      if (mapped !== value[field]) { value[field] = mapped; db.prepare(`UPDATE ${table} SET ${column}=? WHERE ${key}=?`).run(JSON.stringify(value), row.id); }
    }
  }
}
