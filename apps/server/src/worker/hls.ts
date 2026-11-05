import { randomUUID } from 'node:crypto';
import { lstat, mkdir, opendir, readdir, realpath, rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { hlsCacheKey, hlsDirectory } from '../core/hls.ts';
import type { HlsSession } from '../core/hls.ts';
import { secureMediaPath } from '../core/paths.ts';
import { publishJob } from '../core/job-view.ts';
import { readSettings } from '../core/settings.ts';
import { runFfmpeg } from './ffmpeg-slots.ts';

function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
async function account(db: Database.Database, cacheDir: string, session: HlsSession, generation: string, assertLease: () => void): Promise<void> {
  const directory = hlsDirectory(cacheDir, session.id, generation);
  let files: string[];
  try { files = await readdir(directory); } catch { return; }
  for (const name of files) {
    if (name !== 'index.m3u8' && !/^seg-\d{6}\.ts$/.test(name)) continue;
    const filename = path.join(directory, name);
    let info;
    try { info = await lstat(filename); } catch { continue; }
    if (!info.isFile() || info.isSymbolicLink()) continue;
    db.transaction(() => {
      assertLease();
      const active = db.prepare('SELECT last_access_at FROM hls_sessions WHERE id=? AND job_id=? AND generation=?')
        .get(session.id, session.job_id, generation) as { last_access_at: number } | undefined;
      if (!active) throw new Error('HLS 会话已经变化');
      db.prepare(`INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at,media_id,variant,source_size,source_modified,hls_session_id)
        VALUES (?,?,?,?,?,'hls',?,?,?) ON CONFLICT(cache_key) DO UPDATE SET bytes=excluded.bytes,last_access_at=excluded.last_access_at`)
        .run(hlsCacheKey(session.id, generation, name), path.relative(path.resolve(cacheDir), filename), info.size, active.last_access_at,
          session.media_id, session.source_size, session.source_modified, session.id);
    }).immediate();
  }
}

export async function generateHls(db: Database.Database, sessionId: string, jobId: string, options: { owner: string; cacheDir: string; allowedRoots: string[]; assertLease: () => void; signal?: AbortSignal; idleMs?: number }): Promise<{ idle: number }> {
  const session = db.prepare('SELECT * FROM hls_sessions WHERE id=? AND job_id=?').get(sessionId, jobId) as HlsSession | undefined;
  if (!session) throw new Error('HLS 会话不存在');
  const source = db.prepare(`SELECT f.id,f.relative_path,f.size,f.modified_at,f.playability,l.root FROM files f JOIN libraries l ON l.id=f.library_id
    WHERE f.id=? AND f.media_type='video' AND f.missing_at_ms IS NULL AND l.enabled=1`).get(session.media_id) as { id: string; relative_path: string; size: number; modified_at: number; playability: string | null; root: string } | undefined;
  if (!source || source.playability !== 'transcode' || source.size !== session.source_size || source.modified_at !== session.source_modified || !readSettings(db).transcode.enabled) throw new Error('视频不可转码');
  const root = await realpath(source.root);
  const allowed = await Promise.all(options.allowedRoots.map((candidate) => realpath(candidate).catch(() => '')));
  if (!allowed.some((candidate) => candidate && within(candidate, root))) throw new Error('媒体库不在挂载内');
  const filename = await secureMediaPath(root, source.relative_path);
  const before = await stat(filename);
  if (before.size !== source.size || Math.floor(before.mtimeMs / 1000) !== source.modified_at) throw new Error('视频已变化');
  let generation = '';
  const startGeneration = async () => {
    generation = randomUUID().replaceAll('-', '');
    const directory = hlsDirectory(options.cacheDir, session.id, generation);
    const cacheRoot = await realpath(options.cacheDir);
    const hlsRoot = path.join(path.resolve(options.cacheDir), 'hls');
    await mkdir(hlsRoot, { recursive: true });
    const baseInfo = await lstat(hlsRoot);
    if (!baseInfo.isDirectory() || baseInfo.isSymbolicLink() || !within(cacheRoot, await realpath(hlsRoot))) throw new Error('HLS 缓存根目录无效');
    const sessionRoot = path.dirname(directory);
    await mkdir(sessionRoot, { recursive: true });
    const sessionInfo = await lstat(sessionRoot);
    if (!sessionInfo.isDirectory() || sessionInfo.isSymbolicLink() || !within(cacheRoot, await realpath(sessionRoot))) throw new Error('HLS 缓存目录无效');
    await mkdir(directory);
    db.transaction(() => {
      options.assertLease();
      if (!db.prepare("UPDATE hls_sessions SET generation=?,state='running' WHERE id=? AND job_id=?").run(generation, session.id, jobId).changes) throw new Error('HLS 会话已经变化');
    }).immediate();
    return directory;
  };
  let directory = await startGeneration();
  const local = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, local.signal]) : local.signal;
  let idle = false; let tracking = false; let pending: Promise<void> = Promise.resolve();
  const timer = setInterval(() => {
    try {
      options.assertLease();
      const current = db.prepare('SELECT last_access_at,generation FROM hls_sessions WHERE id=? AND job_id=?').get(session.id, jobId) as { last_access_at: number; generation: string | null } | undefined;
      if (!current || current.generation !== generation) { local.abort(); return; }
      if (Date.now() - current.last_access_at > (options.idleMs ?? 30_000)) { idle = true; local.abort(); return; }
      if (!tracking) {
        tracking = true;
        const trackedGeneration = generation;
        pending = account(db, options.cacheDir, session, trackedGeneration, options.assertLease).catch(() => { if (generation === trackedGeneration) local.abort(); }).finally(() => { tracking = false; });
      }
    } catch { local.abort(); }
  }, 1000);
  timer.unref();
  try {
    const settings = readSettings(db);
    const probe = db.prepare("SELECT value FROM settings WHERE key='worker.ffmpeg'").get() as { value: string } | undefined;
    let nvenc = false;
    try { nvenc = (settings.transcode.hwaccel === 'auto' || settings.transcode.hwaccel === 'nvenc') && !!probe && JSON.parse(probe.value).encoder === 'nvenc'; } catch { nvenc = false; }
    const encode = (hardware: boolean) => runFfmpeg(db, options.owner, ['-n', '-i', filename, '-map', '0:v:0', '-map', '0:a:0?',
      ...(hardware ? ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '26'] : ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '24']),
      '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*4)', '-hls_time', '4', '-hls_playlist_type', 'event',
      '-hls_flags', 'temp_file', '-hls_segment_filename', path.join(directory, 'seg-%06d.ts'), '-f', 'hls', path.join(directory, 'index.m3u8')],
    { signal, assertLease: options.assertLease, timeoutMs: 6 * 60 * 60 * 1000 });
    if (nvenc) {
      try { await encode(true); }
      catch {
        signal.throwIfAborted(); options.assertLease();
        directory = await startGeneration();
        await encode(false);
      }
    } else await encode(false);
    signal.throwIfAborted();
    const after = await stat(filename);
    if (after.size !== source.size || Math.floor(after.mtimeMs / 1000) !== source.modified_at) throw new Error('视频已变化');
    clearInterval(timer); await pending;
    await account(db, options.cacheDir, session, generation, options.assertLease);
    db.transaction(() => {
      options.assertLease();
      if (!db.prepare("UPDATE hls_sessions SET state='ready' WHERE id=? AND job_id=? AND generation=?").run(session.id, jobId, generation).changes) throw new Error('HLS 会话已经变化');
    }).immediate();
    return { idle: 0 };
  } catch (error) {
    clearInterval(timer); await pending;
    if (idle && !options.signal?.aborted) {
      options.assertLease();
      await account(db, options.cacheDir, session, generation, options.assertLease);
      db.prepare("UPDATE hls_sessions SET state='idle' WHERE id=? AND job_id=? AND generation=?").run(session.id, jobId, generation);
      return { idle: 1 };
    }
    try { options.assertLease(); db.prepare("UPDATE hls_sessions SET state='failed' WHERE id=? AND job_id=? AND generation=?").run(session.id, jobId, generation); } catch { /* 租约失效时由接管者处理。 */ }
    throw error;
  } finally { clearInterval(timer); }
}

export async function cleanupHls(db: Database.Database, cacheDir: string, at = Date.now()): Promise<number> {
  const stale = db.prepare('SELECT * FROM hls_sessions WHERE last_access_at<? ORDER BY last_access_at LIMIT 100').all(at - 60_000) as HlsSession[];
  let removed = 0;
  for (const session of stale) {
    const claimed = db.transaction(() => {
      const current = db.prepare('SELECT * FROM hls_sessions WHERE id=? AND last_access_at<?').get(session.id, at - 60_000) as HlsSession | undefined;
      if (!current || current.generation !== session.generation || current.job_id !== session.job_id) return false;
      const job = current.job_id ? db.prepare('SELECT status,lease_expires_at FROM jobs WHERE id=?').get(current.job_id) as { status: string; lease_expires_at: number | null } | undefined : undefined;
      if (job?.status === 'running' && (job.lease_expires_at ?? 0) > Math.floor(at / 1000)) return false;
      if (job && ['queued', 'paused', 'running'].includes(job.status)) {
        db.prepare("UPDATE jobs SET status='cancelled',owner=NULL,heartbeat_at=NULL,lease_expires_at=NULL,lease_token=NULL,finished_at=? WHERE id=?").run(Math.floor(at / 1000), current.job_id);
        publishJob(db, current.job_id!);
      }
      db.prepare('DELETE FROM hls_sessions WHERE id=?').run(current.id);
      return true;
    }).immediate();
    if (!claimed) continue;
    if (session.generation) {
      const directory = hlsDirectory(cacheDir, session.id, session.generation);
      const root = path.resolve(cacheDir);
      try {
        const parent = await realpath(path.dirname(directory)); const actualRoot = await realpath(root);
        if (within(actualRoot, parent)) {
          await rm(directory, { recursive: true, force: true });
          db.prepare('DELETE FROM cache_entries WHERE hls_session_id=? AND relative_path LIKE ?').run(session.id, `hls/${session.id}/${session.generation}/%`);
        }
      } catch { /* 路径不可访问时保留文件供后续检查。 */ }
    }
    try { await rmdir(path.join(path.resolve(cacheDir), 'hls', session.id)); } catch { /* 非空目录可能仍由新会话使用。 */ }
    removed++;
  }
  const root = path.resolve(cacheDir); const hlsRoot = path.join(root, 'hls');
  try {
    const rootInfo = await lstat(hlsRoot); const realCache = await realpath(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !within(realCache, await realpath(hlsRoot))) return removed;
    let checked = 0;
    for await (const sessionEntry of await opendir(hlsRoot)) {
      if (!sessionEntry.isDirectory() || !/^[a-f0-9]{64}$/.test(sessionEntry.name)) continue;
      const sessionDir = path.join(hlsRoot, sessionEntry.name);
      const sessionInfo = await lstat(sessionDir);
      if (!sessionInfo.isDirectory() || sessionInfo.isSymbolicLink() || !within(realCache, await realpath(sessionDir))) continue;
      for await (const generationEntry of await opendir(sessionDir)) {
        if (++checked > 100) return removed;
        if (!generationEntry.isDirectory() || !/^[a-f0-9]{32}$/.test(generationEntry.name)) continue;
        const directory = path.join(sessionDir, generationEntry.name);
        const info = await lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink() || info.mtimeMs >= at - 60_000) continue;
        const current = db.prepare('SELECT generation FROM hls_sessions WHERE id=?').get(sessionEntry.name) as { generation: string | null } | undefined;
        if (current?.generation === generationEntry.name) continue;
        await rm(directory, { recursive: true, force: true });
        db.prepare('DELETE FROM cache_entries WHERE hls_session_id=? AND relative_path LIKE ?')
          .run(sessionEntry.name, `hls/${sessionEntry.name}/${generationEntry.name}/%`);
      }
      try { await rmdir(sessionDir); } catch { /* 活跃或非空目录保留。 */ }
    }
  } catch { /* 缓存根不存在或不可访问时留待下次回收。 */ }
  return removed;
}
