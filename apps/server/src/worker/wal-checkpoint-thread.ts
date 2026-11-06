import { statSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';

/**
 * 独立线程把 WAL 写回主库。PASSIVE 不占写锁、不等待读者，写回与 fsync 的磁盘等待不落在主线程上。
 * 写回追平且 WAL 偏大时做一次不等待的 TRUNCATE：此时没有待写回的帧，只短暂占写锁截断文件，有读者时立即放弃。
 * 每轮把 WAL 帧数告诉主线程，主线程据此让后台作业让路（见 wal-checkpoint.ts）。
 */
const db = new Database(workerData.filename as string, { fileMustExist: true });
db.pragma('busy_timeout = 0');
const truncateFrames = workerData.truncateFrames as number;
type Result = { busy: number; log: number; checkpointed: number };
let timer: NodeJS.Timeout | undefined; let stopped = false;
const checkpoint = (): Result => {
  let result: Result = { busy: 1, log: -1, checkpointed: -1 };
  try {
    result = (db.pragma('wal_checkpoint(PASSIVE)') as Result[])[0]!;
    if (!result.busy && result.log >= truncateFrames && result.checkpointed === result.log) {
      const truncated = (db.pragma('wal_checkpoint(TRUNCATE)') as Result[])[0]!;
      if (!truncated.busy) result = truncated;
    }
  } catch { /* 下一轮重试 */ }
  return result;
};
const tick = () => {
  // 积压很多时一次写回要很久，先报告 WAL 文件大小，主线程不必等写回结束才让后台作业让路
  try { parentPort!.postMessage({ bytes: statSync(`${workerData.filename as string}-wal`).size }); } catch { /* WAL 不存在 */ }
  const result = checkpoint();
  if (stopped) return;
  parentPort!.postMessage({ log: result.log });
  // WAL 偏大时缩短间隔，尽快等到可以截断的时机
  timer = setTimeout(tick, result.log >= truncateFrames ? Math.min(100, workerData.intervalMs as number) : workerData.intervalMs as number);
};
timer = setTimeout(tick, workerData.intervalMs as number);
parentPort!.on('message', (message) => {
  if (message !== 'stop') return;
  stopped = true; clearTimeout(timer); checkpoint(); db.close(); parentPort!.close();
});
