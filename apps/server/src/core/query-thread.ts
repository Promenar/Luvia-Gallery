import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { registerLegacyFunctions } from './legacy-functions.ts';

type Statement = { sql: string; params: (string | number)[] };
const db = new Database(workerData.filename as string, { readonly: true, fileMustExist: true });
registerLegacyFunctions(db);
db.pragma('query_only = ON');
db.pragma('busy_timeout = 5000');
parentPort!.on('message', ({ id, statements }: { id: number; statements: Statement[] }) => {
  try {
    const rows = db.transaction(() => statements.map(({ sql, params }) => db.prepare(sql).all(...params)))();
    parentPort!.postMessage({ id, rows });
  } catch {
    parentPort!.postMessage({ id, error: true });
  }
});
