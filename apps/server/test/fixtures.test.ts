import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import exifr from 'exifr';
import sharp from 'sharp';

const run = promisify(execFile);
test('夹具生成图片、EXIF GPS、视频和音频，重复执行不覆盖', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-fixtures-'));
  const script = fileURLToPath(new URL('../scripts/fixtures.ts', import.meta.url));
  try {
    assert.ok(await access(script).then(() => true, () => false), '缺少夹具生成入口');
    await run(process.execPath, [script, '--output', root]);
    const exifFile = path.join(root, 'photos', 'nested', 'exif-gps.jpg');
    const metadata = await exifr.parse(exifFile, { gps: true, exif: true });
    assert.ok(metadata?.DateTimeOriginal instanceof Date);
    assert.equal(metadata.latitude, 30.5); assert.equal(metadata.longitude, 120);
    assert.equal((await sharp(path.join(root, 'photos', 'portrait.jpg')).metadata()).height, 900);
    const video = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', path.join(root, 'video', 'direct.mp4')]);
    assert.match(video.stdout, /h264/);
    const mkv = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', path.join(root, 'video', 'transcode.mkv')]);
    assert.match(mkv.stdout, /ffv1/);
    const audio = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path.join(root, 'audio', 'sample.m4a')]);
    assert.match(audio.stdout, /audio/);
    const before = await readFile(exifFile);
    await assert.rejects(run(process.execPath, [script, '--output', root]));
    assert.deepEqual(await readFile(exifFile), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
