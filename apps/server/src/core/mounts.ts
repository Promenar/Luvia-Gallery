import path from 'node:path';
import { readFile } from 'node:fs/promises';

export type Mount = { containerPath: string; hostPath: string | null; kind: 'candidate' | 'system' | 'other'; libraryId: null; readOnly: boolean; mediaEstimate: null };
type Options = { mediaRoots: string[]; systemRoots: string[]; hostPaths?: string };
const unescapeMount = (value: string) => value.replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)));
function within(root: string, child: string): boolean {
  const relative = path.posix.relative(root, child);
  return relative === '' || (relative !== '..' && !relative.startsWith('../') && !path.posix.isAbsolute(relative));
}
export function parseHostPaths(value: string): { container: string; host: string }[] {
  return value.split(';').flatMap((part) => {
    const equal = part.indexOf('=');
    if (equal < 1) return [];
    const container = part.slice(0, equal).trim(); const host = part.slice(equal + 1).trim();
    if (!path.posix.isAbsolute(container) || !path.posix.isAbsolute(host)) return [];
    return [{ container: path.posix.resolve(container), host: path.posix.resolve(host) }];
  }).sort((a, b) => b.container.length - a.container.length);
}
export function parseMountInfo(text: string, options: Options): Mount[] {
  const mappings = parseHostPaths(options.hostPaths ?? '');
  const systemDirs = ['/dev', '/proc', '/sys', '/run', '/etc', '/var', '/tmp', '/usr', '/bin', '/sbin', '/lib'];
  const seen = new Set<string>();
  const result: Mount[] = [];
  for (const line of text.split('\n')) {
    const separator = line.indexOf(' - ');
    if (separator < 0) continue;
    const fields = line.slice(0, separator).split(' ');
    if (fields.length < 6) continue;
    const rawRoot = unescapeMount(fields[3]!); const rawPath = unescapeMount(fields[4]!);
    if (!path.posix.isAbsolute(rawRoot) || !path.posix.isAbsolute(rawPath)) continue;
    const containerPath = path.posix.resolve(rawPath);
    if (seen.has(containerPath)) continue;
    seen.add(containerPath);
    const system = options.systemRoots.some((base) => within(path.posix.resolve(base), containerPath));
    const other = containerPath === '/' || systemDirs.some((base) => within(base, containerPath));
    const selected = options.mediaRoots.length === 0 || options.mediaRoots.some((base) => within(path.posix.resolve(base), containerPath));
    const mapping = mappings.find((item) => within(item.container, containerPath));
    const hostPath = mapping ? path.posix.join(mapping.host, path.posix.relative(mapping.container, containerPath)) : path.posix.resolve(rawRoot);
    result.push({ containerPath, hostPath, kind: system ? 'system' : other || !selected ? 'other' : 'candidate', libraryId: null,
      readOnly: fields[5]!.split(',').includes('ro'), mediaEstimate: null });
  }
  return result;
}
export async function detectMounts(options: Options): Promise<Mount[]> {
  try { return parseMountInfo(await readFile('/proc/self/mountinfo', 'utf8'), options); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
