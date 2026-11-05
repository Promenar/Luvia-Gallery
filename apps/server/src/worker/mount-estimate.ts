import { opendir } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Mount } from '../core/mounts.ts';

const extensions = new Set(['.jpg','.jpeg','.png','.gif','.webp','.avif','.heic','.heif','.tif','.tiff','.bmp','.mp4','.m4v','.mkv','.mov','.webm','.avi','.wmv','.mpeg','.mpg','.mp3','.wav','.flac','.m4a','.aac','.ogg','.wma','.opus']);
export async function estimateMount(root: string, options: { timeoutMs?: number; openDir?: typeof opendir } = {}): Promise<number | null> {
  const timeout = Math.max(1, Math.min(2000, options.timeoutMs ?? 2000));
  const openDir = options.openDir ?? opendir;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  const expired = new Promise<null>((resolve) => { timer = setTimeout(() => { stopped = true; resolve(null); }, timeout); });
  const scan = async (): Promise<number | null> => {
    let count = 0;
    const queue = [{ directory: root, depth: 0 }];
    try {
      while (queue.length && !stopped) {
        const current = queue.shift()!;
        const dir = await openDir(current.directory);
        if (stopped) { await dir.close(); break; }
        for await (const entry of dir) {
          if (stopped) break;
          if (entry.isDirectory() && current.depth === 0 && !entry.name.startsWith('.') && entry.name !== '@eaDir' && entry.name !== '#recycle')
            queue.push({ directory: path.join(current.directory, entry.name), depth: 1 });
          else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) count++;
        }
      }
      return stopped ? null : count;
    } catch { return null; }
  };
  const result = await Promise.race([scan(), expired]);
  stopped = true; clearTimeout(timer!);
  return result;
}
export async function sampleMounts(db: Database.Database, mounts: Mount[], signal?: AbortSignal): Promise<void> {
  const candidates = mounts.filter((mount) => mount.kind === 'candidate');
  const results: Record<string, number | null> = {};
  for (let i = 0; i < candidates.length && !signal?.aborted; i += 4) {
    const batch = candidates.slice(i, i + 4);
    const counts = await Promise.all(batch.map((mount) => estimateMount(mount.containerPath)));
    batch.forEach((mount, index) => { results[mount.containerPath] = counts[index] ?? null; });
  }
  if (!signal?.aborted) db.prepare("INSERT INTO settings(key,value) VALUES('mount.estimates',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(results));
}
