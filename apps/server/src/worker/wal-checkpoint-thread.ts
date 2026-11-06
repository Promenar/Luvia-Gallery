import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';

// 独立线程定期把 WAL 写回主库。PASSIVE 不占写锁、不等待读者，写回与 fsync 的磁盘等待不落在主线程上。
const db = new Database(workerData.filename as string, { fileMustExist: true });
db.pragma('busy_timeout = 0');
const checkpoint = () => { try { db.pragma('wal_checkpoint(PASSIVE)'); } catch { /* 下一轮重试 */ } };
const timer = setInterval(checkpoint, workerData.intervalMs as number);
parentPort!.on('message', (message) => {
  if (message !== 'stop') return;
  clearInterval(timer); checkpoint(); db.close(); parentPort!.close();
});
