import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';

try {
  const db = new Database(workerData.filename as string, { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 0');
    type Checkpoint = { busy: number; log: number; checkpointed: number };
    // PASSIVE 写回 WAL 时不占写锁，大 WAL 也不会让其它连接等到超时；
    // 全部帧写回后再 TRUNCATE 截断文件，此时几乎无需拷贝页面，占写锁的时间极短
    const passive = (db.pragma('wal_checkpoint(PASSIVE)') as Checkpoint[])[0]!;
    const result = passive.busy === 0 && passive.checkpointed === passive.log
      ? (db.pragma('wal_checkpoint(TRUNCATE)') as Checkpoint[])[0]!
      : { ...passive, busy: 1 };
    db.pragma('optimize');
    parentPort!.postMessage(result);
  } finally { db.close(); }
} catch { parentPort!.postMessage({ error: true }); }
