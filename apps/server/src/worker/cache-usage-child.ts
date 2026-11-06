import Database from 'better-sqlite3';

try {
  const db = new Database(process.argv[2]!, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    db.pragma('busy_timeout = 1000');
    const row = db.prepare('SELECT COALESCE(sum(bytes),0) AS n FROM cache_entries').get() as { n: number };
    process.stdout.write(JSON.stringify({ bytes: row.n }));
  } finally { db.close(); }
} catch (error) {
  const code = (error as { code?: unknown } | null)?.code;
  process.stdout.write(JSON.stringify({ error: typeof code === 'string' && /^SQLITE_[A-Z0-9_]+$/.test(code) ? code : null }));
  process.exitCode = 1;
}
