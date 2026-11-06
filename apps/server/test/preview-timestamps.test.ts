import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/core/database.ts';
import { enqueueMediaTask, cachePath } from '../src/core/media-cache.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { runNextJob } from '../src/worker/runner.ts';
import { stopProcessRunner } from '../src/worker/process-runner.ts';
import { generateMediaCache } from '../src/worker/media-cache.ts';

const exec = promisify(execFile);
test('普通预览封装失败时，规范时间戳后生成可播放 MP4', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-preview-source-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-preview-cache-'));
  const tools = await mkdtemp(path.join(tmpdir(), 'luvia-preview-tools-')); const db = openDatabase(':memory:');
  const previousPath = process.env.PATH;
  try {
    const ffmpeg = (await exec('which', ['ffmpeg'])).stdout.trim();
    await exec(process.execPath, [fileURLToPath(new URL('../scripts/fixtures.ts', import.meta.url)), '--output', root]);
    const attempts = path.join(tools, 'attempts');
    const script = `#!/usr/bin/env node\nconst fs=require('node:fs');const cp=require('node:child_process');\nconst normalized=process.argv.includes('scale=640:-2,fps=30');fs.appendFileSync(${JSON.stringify(attempts)},normalized?'normalized\\n':'ordinary\\n');\nif(!normalized)process.exit(1);const result=cp.spawnSync(${JSON.stringify(ffmpeg)},process.argv.slice(2),{stdio:'ignore'});process.exit(result.status??1);\n`;
    await writeFile(path.join(tools, 'ffmpeg'), script); await chmod(path.join(tools, 'ffmpeg'), 0o755);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','视频',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare("SELECT id,size,modified_at,cache_generation FROM files WHERE name='direct.mp4'").get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const variant = { kind: 'preview' } as const; const job = enqueueMediaTask(db, row, variant);
    process.env.PATH = `${tools}${path.delimiter}${previousPath ?? ''}`;
    await runNextJob(db, { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [], cacheDir: cache });
    assert.equal((db.prepare('SELECT status FROM jobs WHERE id=?').get(job) as { status: string }).status, 'succeeded');
    assert.deepEqual((await readFile(attempts, 'utf8')).trim().split('\n'), ['ordinary', 'normalized']);
    const probe = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name', '-of', 'json', cachePath(cache, row, variant)]);
    assert.equal(JSON.parse(probe.stdout).streams[0].codec_name, 'h264');
  } finally {
    stopProcessRunner(); if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; db.close();
    await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); await rm(tools, { recursive: true, force: true });
  }
});

test('领取转码槽位时数据库繁忙应原样抛出，不进入时间戳回退', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-preview-busy-source-')); const cache = await mkdtemp(path.join(tmpdir(), 'luvia-preview-busy-cache-'));
  const db = openDatabase(':memory:');
  try {
    await exec(process.execPath, [fileURLToPath(new URL('../scripts/fixtures.ts', import.meta.url)), '--output', root]);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','视频',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare("SELECT id,size,modified_at,cache_generation FROM files WHERE name='direct.mp4'").get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const prepare = db.prepare.bind(db); let injected = false;
    db.prepare = ((sql: string) => {
      if (!injected && sql.startsWith('SELECT count(*) AS n FROM ffmpeg_slots')) { injected = true; throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }); }
      return prepare(sql);
    }) as typeof db.prepare;
    await assert.rejects(generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant: { kind: 'preview' } },
      { owner: 'worker', cacheDir: cache, allowedRoots: [root], assertLease: () => {} }), { code: 'SQLITE_BUSY' });
    assert.equal((prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
  } finally { stopProcessRunner(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
