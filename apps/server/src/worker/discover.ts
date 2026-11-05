import type Database from 'better-sqlite3';
import { realpath, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Mount } from '../core/mounts.ts';
import { readSettings } from '../core/settings.ts';
import { publishJob } from '../core/job-view.ts';

const within = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
export async function discoverNewMounts(db: Database.Database, mounts: Mount[], systemRoots: string[]): Promise<number> {
  if (!readSettings(db).libraries.autoEnableNewMounts) return 0;
  const systems = await Promise.all(systemRoots.map(async (entry) => {
    try { return await realpath(entry); } catch { return path.resolve(entry); }
  }));
  let added = 0;
  for (const mount of mounts) {
    if (mount.kind !== 'candidate' || !path.isAbsolute(mount.containerPath)) continue;
    let actual: string;
    try {
      actual = await realpath(mount.containerPath);
      if (!(await stat(actual)).isDirectory()) continue;
    } catch { continue; }
    if (systems.some((system) => within(system, actual) || within(actual, system))) continue;
    added += db.transaction(() => {
      const id = randomUUID(); const root = path.resolve(mount.containerPath);
      const inserted = db.prepare('INSERT OR IGNORE INTO libraries(id,name,root,enabled,host_root,host_root_source) VALUES (?,?,?,1,?,?)')
        .run(id, path.basename(root) || root, root, mount.hostPath, mount.hostPath ? 'auto' : null);
      if (!inserted.changes) return 0;
      const jobId = randomUUID();
      db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES (?,'scan','扫描媒体库','queued','system',?,unixepoch())")
        .run(jobId, JSON.stringify({ libraryId: id }));
      publishJob(db, jobId);
      return 1;
    }).immediate();
  }
  return added;
}
