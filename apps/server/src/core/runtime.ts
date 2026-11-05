import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { openDatabase } from './database.ts';

async function exists(filename: string): Promise<boolean> {
  try { await access(filename); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
export async function openRuntime() {
  const dataDir = path.resolve(process.env.DATA_DIR ?? 'data');
  const cacheDir = path.resolve(process.env.CACHE_DIR ?? 'cache');
  const legacyDir = path.resolve(process.env.LUVIA_LEGACY_DIR ?? dataDir);
  const mediaRoots = (process.env.MEDIA_ROOT ?? '').split(';').map((entry) => entry.trim()).filter(Boolean).map((entry) => path.resolve(entry));
  await Promise.all([mkdir(dataDir, { recursive: true }), mkdir(cacheDir, { recursive: true })]);
  const bootstrapLegacy = await exists(path.join(legacyDir, 'lumina-config.json')) || await exists(path.join(legacyDir, 'lumina.db'));
  const db = openDatabase(path.join(dataDir, 'luvia.db'), { bootstrapLegacy });
  return { db, dataDir, cacheDir, legacyDir, mediaRoots };
}
export function installFatalHandlers(source: string): void {
  process.on('uncaughtException', (error) => { process.stderr.write(`${source} 未捕获异常: ${error.name}\n`); process.exit(1); });
  process.on('unhandledRejection', () => { process.stderr.write(`${source} 出现未处理的异步异常\n`); process.exit(1); });
}
