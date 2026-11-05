import type Database from 'better-sqlite3';
import { Job } from '@luvia/contracts';

export type JobRecord = {
  id: string; type: string; label: string; status: string; progress_done: number; progress_total: number | null;
  message: string | null; error: string | null; result: string | null; trigger: string;
  created_at: number; started_at: number | null; finished_at: number | null;
};
const iso = (time: number | null) => time === null ? null : new Date(time * 1000).toISOString();

export function jobView(row: JobRecord) {
  return Job.parse({
    id: row.id, type: row.type, label: row.label, status: row.status,
    progress: { done: row.progress_done, total: row.progress_total }, message: row.message,
    error: row.error, result: row.result ? JSON.parse(row.result) : null, trigger: row.trigger,
    createdAt: iso(row.created_at), startedAt: iso(row.started_at), finishedAt: iso(row.finished_at), etaSec: null,
  });
}

export function publishJob(db: Database.Database, id: string): void {
  const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as JobRecord | undefined;
  if (!row) throw new Error('作业不存在');
  db.prepare("INSERT INTO job_events(event_type,payload) VALUES ('job',?)").run(JSON.stringify(jobView(row)));
}
