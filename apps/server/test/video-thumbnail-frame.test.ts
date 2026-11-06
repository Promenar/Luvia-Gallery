import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { openDatabase } from '../src/core/database.ts';
import { cachePath } from '../src/core/media-cache.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { generateMediaCache } from '../src/worker/media-cache.ts';
import { stopProcessRunner } from '../src/worker/process-runner.ts';

const exec = promisify(execFile);
test('视频缩略图跳过黑场，只有黑场时仍生成封面', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-video-frame-source-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-video-frame-cache-'));
  const db = openDatabase(':memory:');
  try {
    for (const [name, dark, red] of [['intro.mp4', 2, 2], ['later.mp4', 7, 3], ['unknown.mp4', 4, 6], ['short.mp4', 0.4, 0.2], ['three.mp4', 1.5, 1.5]] as const) {
      await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=black:s=128x96:r=10:d=${dark}`,
        '-f', 'lavfi', '-i', `color=red:s=128x96:r=10:d=${red}`, '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
        '-c:v', 'libx264', '-y', path.join(root, name)]);
    }
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=128x96:r=10:d=3',
      '-f', 'lavfi', '-i', 'color=red:s=128x96:r=10:d=4', '-f', 'lavfi', '-i', 'color=black:s=128x96:r=10:d=3',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0', '-c:v', 'libx264', '-y', path.join(root, 'unknown-middle.mp4')]);
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=128x96:r=10:d=1', '-c:v', 'libx264', '-y', path.join(root, 'black.mp4')]);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','视频',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const rows = db.prepare('SELECT id,name,size,modified_at,cache_generation FROM files').all() as { id: string; name: string; size: number; modified_at: number; cache_generation: number }[];
    for (const row of rows) {
      db.prepare('UPDATE files SET duration_sec=? WHERE id=?').run(row.name.startsWith('unknown') ? null : row.name === 'short.mp4' ? 0.6 : row.name === 'three.mp4' ? 3 : row.name === 'later.mp4' ? 10 : row.name === 'intro.mp4' ? 4 : 1, row.id);
      const variant = { kind: 'thumb', size: 's' } as const;
      await generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant },
        { owner: 'worker', cacheDir: cache, allowedRoots: [root], assertLease: () => {} });
      const { channels } = await sharp(cachePath(cache, row, variant)).stats();
      if (row.name === 'black.mp4') assert.ok(channels[0]!.mean < 20, '全黑视频仍应产生可用封面');
      else assert.ok(channels[0]!.mean > 150 && channels[1]!.mean < 60, `${row.name} 应选中红色画面`);
    }
    assert.equal(rows.length, 7);
  } finally {
    stopProcessRunner(); db.close();
    await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true });
  }
});

test('未知时长探测被系统中止时停止后续视频取帧', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-video-probe-source-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-video-probe-cache-'));
  const tools = await mkdtemp(path.join(tmpdir(), 'luvia-video-probe-tools-'));
  const db = openDatabase(':memory:'); const previousPath = process.env.PATH;
  try {
    await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=128x96:r=10:d=2', '-c:v', 'libx264', '-y', path.join(root, 'black.mp4')]);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','视频',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    db.prepare('UPDATE files SET duration_sec=NULL WHERE id=?').run(row.id);
    await writeFile(path.join(tools, 'ffprobe'), '#!/bin/sh\nkill -KILL $$\n'); await chmod(path.join(tools, 'ffprobe'), 0o755);
    process.env.PATH = `${tools}${path.delimiter}${previousPath ?? ''}`;
    await assert.rejects(generateMediaCache(db, { mediaId: row.id, sourceSize: row.size, sourceModified: row.modified_at, sourceGeneration: row.cache_generation, variant: { kind: 'thumb', size: 's' } },
      { owner: 'worker', cacheDir: cache, allowedRoots: [root], assertLease: () => {} }), /媒体信息读取被系统中止/);
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
  } finally {
    stopProcessRunner(); if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; db.close();
    await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); await rm(tools, { recursive: true, force: true });
  }
});
