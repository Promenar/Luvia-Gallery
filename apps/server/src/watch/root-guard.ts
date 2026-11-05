import path from 'node:path';
import { constants } from 'node:fs';
import { access, opendir, readFile, stat } from 'node:fs/promises';

async function readableRoot(root: string): Promise<boolean> {
  try {
    if (!(await stat(root)).isDirectory()) return false;
    await access(root, constants.R_OK | constants.X_OK);
    const dir = await opendir(root); await dir.close(); return true;
  } catch { return false; }
}
function unescapeMount(value: string): string { return value.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8))); }
async function rootMount(root: string): Promise<string | null> {
  if (process.platform !== 'linux') return null;
  const text = await readFile('/proc/self/mountinfo', 'utf8');
  const absolute = path.resolve(root); let best: { mount: string; identity: string } | null = null;
  for (const line of text.split('\n')) {
    const [before, after] = line.split(' - '); if (!before || !after) continue;
    const fields = before.split(' '); const tail = after.split(' '); if (fields.length < 6 || tail.length < 2) continue;
    const mount = unescapeMount(fields[4]!); const rel = path.relative(mount, absolute);
    if (rel !== '' && (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel))) continue;
    if (!best || mount.length > best.mount.length) best = { mount, identity: [mount, fields[2], unescapeMount(fields[3]!), tail[0], unescapeMount(tail[1]!)].join('\0') };
  }
  if (!best) throw new Error('无法确定媒体库根目录的挂载');
  return best.identity;
}
export class RootGuard {
  private baseline: string | null | undefined;
  private wasUnavailable = false;
  private readonly options: { root: string; probe?: (root: string) => Promise<boolean>; mount?: (root: string) => Promise<string | null> };
  constructor(options: { root: string; probe?: (root: string) => Promise<boolean>; mount?: (root: string) => Promise<string | null> }) { this.options = options; }
  async check(): Promise<{ state: 'available' | 'unavailable'; needsFullReconcile: boolean }> {
    try {
      if (!(await (this.options.probe ?? readableRoot)(this.options.root))) throw new Error('媒体库根目录不可读');
      const mount = await (this.options.mount ?? rootMount)(this.options.root);
      if (this.baseline === undefined) this.baseline = mount;
      else if (this.baseline !== mount) throw new Error('媒体库挂载已改变');
      const needsFullReconcile = this.wasUnavailable; this.wasUnavailable = false;
      return { state: 'available', needsFullReconcile };
    } catch { this.wasUnavailable = true; return { state: 'unavailable', needsFullReconcile: false }; }
  }
}
