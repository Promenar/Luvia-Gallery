import path from 'node:path';
import Database from 'better-sqlite3';
import { recoverMissingMedia } from '../src/worker/media-recovery.ts';

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--apply' && !/^--limit=\d+$/.test(arg) && !/^--after=[A-Za-z0-9_-]+$/.test(arg)) || args.filter((arg) => arg.startsWith('--limit=')).length > 1 || args.filter((arg) => arg.startsWith('--after=')).length > 1) {
  throw new Error('用法：node scripts/recover-missing-media.ts [--apply] [--limit=1000] [--after=游标]');
}
const apply = args.includes('--apply');
const limit = Number(args.find((arg) => arg.startsWith('--limit='))?.slice('--limit='.length) ?? 1000);
const after = args.find((arg) => arg.startsWith('--after='))?.slice('--after='.length);
const database = path.join(path.resolve(process.env.DATA_DIR ?? 'data'), 'luvia.db');
const cache = path.resolve(process.env.CACHE_DIR ?? 'cache');
const db = new Database(database, { fileMustExist: true, readonly: !apply, timeout: 1000 });
try {
  const result = await recoverMissingMedia(db, cache, { apply, limit, after });
  process.stdout.write(`${JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...result })}\n`);
} finally { db.close(); }
