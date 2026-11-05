import path from 'node:path';
import { constants } from 'node:fs';
import { access, opendir, readFile, realpath, stat } from 'node:fs/promises';
import type Database from 'better-sqlite3';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function readableRoot(root: string): Promise<boolean> {
  try {
    if (!(await stat(root)).isDirectory()) return false;
    await access(root, constants.R_OK | constants.X_OK);
    const dir = await opendir(root); await dir.close(); return true;
  } catch { return false; }
}
function unescapeMount(value: string): string { return value.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8))); }
export async function readRootMountIdentity(root: string): Promise<string | null> {
  if (process.platform === 'linux') {
    const text = await readFile('/proc/self/mountinfo', 'utf8');
    return parseMountIdentity(text, await realpath(root));
  }
  if (process.platform === 'darwin') {
    const { stdout } = await execFileAsync('/sbin/mount', [], { timeout: 2000, maxBuffer: 16 * 1024 * 1024 });
    return parseDarwinMountIdentity(stdout, await realpath(root));
  }
  return null;
}
export function parseDarwinMountIdentity(text: string, absolute: string): string {
  let best: { mount: string; identity: string } | null = null;
  for (const line of text.split('\n')) {
    const marker = line.lastIndexOf(' (');
    if (marker < 0) continue;
    const fsType = line.slice(marker + 2).split(/[,) ]/, 1)[0];
    for (let separator = line.indexOf(' on '); separator >= 0 && separator < marker; separator = line.indexOf(' on ', separator + 4)) {
      const source = line.slice(0, separator); const mount = line.slice(separator + 4, marker);
      if (!source || !fsType || !path.isAbsolute(mount)) continue;
      const rel = path.relative(mount, absolute);
      if (rel !== '' && (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))) continue;
      if (!best || mount.length > best.mount.length) best = { mount, identity: JSON.stringify([fsType, source, path.posix.join('/', rel)]) };
    }
  }
  if (!best) throw new Error('无法确定媒体库根目录的挂载');
  return best.identity;
}
export function parseMountIdentity(text: string, absolute: string): string {
  let best: { mount: string; identity: string } | null = null;
  for (const line of text.split('\n')) {
    const [before, after] = line.split(' - '); if (!before || !after) continue;
    const fields = before.split(' '); const tail = after.split(' '); if (fields.length < 6 || tail.length < 2) continue;
    const mount = unescapeMount(fields[4]!); const rel = path.relative(mount, absolute);
    if (rel !== '' && (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))) continue;
    if (!best || mount.length > best.mount.length) best = { mount, identity: JSON.stringify([tail[0], unescapeMount(tail[1]!), path.posix.join(unescapeMount(fields[3]!), rel)]) };
  }
  if (!best) throw new Error('无法确定媒体库根目录的挂载');
  return best.identity;
}

function inside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/** 首次确认和挂载变化都以已有媒体内容为依据，监控与扫描共用。 */
export async function confirmLibraryMount(db: Database.Database, library: { id: string; root: string }, options: {
  allowedRoots: string[]; mount?: (root: string) => Promise<string | null>; probe?: (root: string) => Promise<boolean>;
  allowChange?: boolean; assertLease?: () => void; signal?: AbortSignal;
}): Promise<{ available: boolean; identity: string | null; reason: string | null; changed: boolean }> {
  const unavailable = (reason: string) => ({ available: false, identity: null, reason, changed: false });
  try {
    const actual = await realpath(library.root);
    const allowed = await Promise.all(options.allowedRoots.map((root) => realpath(root).catch(() => null)));
    options.signal?.throwIfAborted();
    if (!allowed.some((root) => root !== null && inside(root, actual))) return unavailable('媒体库根目录不在允许的挂载根目录内');
    if (!(await (options.probe ?? readableRoot)(actual))) return unavailable('媒体库根目录不可读');
    const identity = await (options.mount ?? readRootMountIdentity)(actual);
    options.signal?.throwIfAborted();
    const saved = db.prepare('SELECT l.root,s.mount_root,s.mount_identity FROM libraries l LEFT JOIN library_watch_state s ON s.library_id=l.id WHERE l.id=?')
      .get(library.id) as { root: string; mount_root: string | null; mount_identity: string | null } | undefined;
    if (!saved || saved.root !== library.root) return unavailable('媒体库根目录配置已改变');
    const changed = saved.mount_root !== library.root || saved.mount_identity !== identity;
    if (changed) {
      if (options.allowChange === false) return unavailable('扫描期间媒体库挂载身份发生变化');
      const sample = db.prepare('SELECT relative_path,size,mtime_ms FROM files WHERE library_id=? AND missing_at_ms IS NULL ORDER BY random() LIMIT 200')
        .all(library.id) as { relative_path: string; size: number; mtime_ms: number | null }[];
      let matches = 0;
      for (const file of sample) {
        options.signal?.throwIfAborted();
        try {
          const full = await realpath(path.join(actual, file.relative_path));
          if (!inside(actual, full)) continue;
          const info = await stat(full);
          if (info.isFile() && info.size === file.size && file.mtime_ms !== null && Math.abs(info.mtimeMs - file.mtime_ms) < 0.001) matches++;
        } catch { /* 无法读取的样本不计为匹配。 */ }
      }
      if (sample.length && matches / sample.length < 0.9) return unavailable('媒体库挂载内容抽样不符，等待恢复');
      const accepted = db.transaction(() => {
        options.signal?.throwIfAborted();
        options.assertLease?.();
        const current = db.prepare('SELECT l.root,s.mount_root,s.mount_identity FROM libraries l LEFT JOIN library_watch_state s ON s.library_id=l.id WHERE l.id=?').get(library.id) as typeof saved;
        if (!current || current.root !== saved.root || current.mount_root !== saved.mount_root || current.mount_identity !== saved.mount_identity) return false;
        db.prepare('INSERT OR IGNORE INTO library_watch_state(library_id) VALUES (?)').run(library.id);
        db.prepare('UPDATE library_watch_state SET mount_root=?,mount_identity=?,mount_attempted=1 WHERE library_id=?').run(library.root, identity, library.id);
        return true;
      }).immediate();
      if (!accepted) return unavailable('媒体库挂载状态已改变，等待重试');
    }
    return { available: true, identity, reason: null, changed };
  } catch { return unavailable('媒体库根目录不可用或挂载身份无法确认'); }
}
export class RootGuard {
  private baseline: string | null | undefined;
  private wasUnavailable = false;
  private readonly options: { root: string; expectedMountIdentity?: string | null; probe?: (root: string) => Promise<boolean>; mount?: (root: string) => Promise<string | null>; confirm?: () => Promise<{ available: boolean; changed: boolean }> };
  constructor(options: { root: string; expectedMountIdentity?: string | null; probe?: (root: string) => Promise<boolean>; mount?: (root: string) => Promise<string | null>; confirm?: () => Promise<{ available: boolean; changed: boolean }> }) { this.options = options; this.baseline = options.expectedMountIdentity; }
  async check(): Promise<{ state: 'available' | 'unavailable'; needsFullReconcile: boolean }> {
    try {
      if (this.options.confirm) {
        const result = await this.options.confirm();
        if (!result.available) throw new Error('媒体库挂载未确认');
        const needsFullReconcile = this.wasUnavailable || result.changed; this.wasUnavailable = false;
        return { state: 'available', needsFullReconcile };
      }
      if (!(await (this.options.probe ?? readableRoot)(this.options.root))) throw new Error('媒体库根目录不可读');
      const mount = await (this.options.mount ?? readRootMountIdentity)(this.options.root);
      if (this.baseline === undefined) this.baseline = mount;
      else if (this.baseline !== mount) throw new Error('媒体库挂载已改变');
      const needsFullReconcile = this.wasUnavailable; this.wasUnavailable = false;
      return { state: 'available', needsFullReconcile };
    } catch { this.wasUnavailable = true; return { state: 'unavailable', needsFullReconcile: false }; }
  }
}
