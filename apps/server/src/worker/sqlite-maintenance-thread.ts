import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';

try {
  const db = new Database(workerData.filename as string, { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 0');
    const result = db.pragma('wal_checkpoint(TRUNCATE)') as { busy: number; log: number; checkpointed: number }[];
    db.pragma('optimize');
    parentPort!.postMessage(result[0]);
  } finally { db.close(); }
} catch { parentPort!.postMessage({ error: true }); }
