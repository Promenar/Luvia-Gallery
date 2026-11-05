import { link, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';

const outputIndex = process.argv.indexOf('--output');
if (outputIndex < 0 || !process.argv[outputIndex + 1]) throw new Error('请使用 --output 指定夹具目录');
const root = path.resolve(process.argv[outputIndex + 1]!);
const directories = ['photos', 'photos/nested', 'photos/empty', 'video', 'audio'];
const files = ['photos/landscape.jpg', 'photos/portrait.jpg', 'photos/nested/exif-gps.jpg', 'video/direct.mp4', 'video/transcode.mkv', 'audio/sample.m4a'];
async function existing(filename: string) {
  try { return await lstat(filename); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
await mkdir(root, { recursive: true });
for (const directory of directories) {
  const current = await existing(path.join(root, directory));
  if (current && (!current.isDirectory() || current.isSymbolicLink())) throw new Error('夹具目录存在不可用路径');
}
for (const file of files) if (await existing(path.join(root, file))) throw new Error('夹具文件已存在，拒绝覆盖');
for (const directory of directories) await mkdir(path.join(root, directory), { recursive: true });
const staging = await mkdtemp(path.join(root, '.luvia-fixtures-'));
for (const directory of directories) await mkdir(path.join(staging, directory), { recursive: true });
const save = async (relative: string, buffer: Buffer) => {
  const filename = path.join(staging, relative);
  await writeFile(filename, buffer, { flag: 'wx' });
};
const run = promisify(execFile);
const video = async (relative: string, args: string[]) => {
  const filename = path.join(staging, relative);
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-n', ...args, filename], { timeout: 30000, maxBuffer: 65536 });
};
try {
  await save('photos/landscape.jpg', await sharp({ create: { width: 1200, height: 675, channels: 3, background: '#718d9f' } }).jpeg().toBuffer());
  await save('photos/portrait.jpg', await sharp({ create: { width: 600, height: 900, channels: 3, background: '#a78980' } }).jpeg().toBuffer());
  await save('photos/nested/exif-gps.jpg', await sharp({ create: { width: 960, height: 640, channels: 3, background: '#7c9b83' } }).jpeg().withExif({
    IFD0: { Make: 'Luvia Fixture', Model: 'Fixture Camera' },
    IFD2: { DateTimeOriginal: '2024:05:06 10:11:12', OffsetTimeOriginal: '+08:00' },
    IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '30/1 30/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '120/1 0/1 0/1' },
  }).toBuffer());
  await video('video/direct.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=12', '-t', '1', '-threads', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart']);
  await video('video/transcode.mkv', ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=12', '-t', '1', '-threads', '1', '-c:v', 'ffv1', '-pix_fmt', 'yuv420p']);
  await video('audio/sample.m4a', ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1', '-c:a', 'aac']);
  for (const file of files) await link(path.join(staging, file), path.join(root, file));
  process.stdout.write('已生成 3 张图片、2 个视频和 1 个音频夹具。\n');
} finally { await rm(staging, { recursive: true, force: true }); }
