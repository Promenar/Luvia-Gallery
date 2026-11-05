import path from 'node:path';
import type Database from 'better-sqlite3';

const registered = new WeakSet<Database.Database>();
export function registerLegacyFunctions(db: Database.Database): void {
  if (registered.has(db)) return;
  db.function('legacy_id', { deterministic: true }, (root: string, relative: string) => Buffer.from(path.join(root, relative)).toString('base64'));
  db.function('legacy_rank', { deterministic: true }, (id: string, seed: number) => {
    const text = `${seed}:${id}`;
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  });
  registered.add(db);
}
