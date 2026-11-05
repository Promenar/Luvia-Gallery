import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('NVENC 需要实际单帧编码成功，否则自动回退 CPU', async () => {
  const module = await import('../src/worker/ffmpeg.ts').catch(() => null);
  assert.ok(module, 'FFmpeg 探测模块尚未实现');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-ffmpeg-'));
  const executable = path.join(dir, 'ffmpeg');
  try {
    const script = (exit: number) => `#!/bin/sh\ncase "$*" in\n  *-version*) echo 'ffmpeg version fixture'; exit 0;;\n  *-encoders*) echo ' V..... h264_nvenc NVIDIA'; exit 0;;\n  *'-frames:v 1'*'-c:v h264_nvenc'*) exit ${exit};;\n  *) exit 4;;\nesac\n`;
    await writeFile(executable, script(1)); await chmod(executable, 0o755);
    const failed = await module.probeFfmpeg(executable);
    assert.equal(failed.available, true); assert.equal(failed.encoder, 'cpu'); assert.deepEqual(failed.hwaccels, []);
    await writeFile(executable, script(0));
    const success = await module.probeFfmpeg(executable);
    assert.equal(success.encoder, 'nvenc'); assert.deepEqual(success.hwaccels, ['nvenc']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('NVENC 探测帧不低于硬件最小尺寸，真实 GPU 上能被识别', async () => {
  const module = await import('../src/worker/ffmpeg.ts');
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-ffmpeg-size-'));
  const executable = path.join(dir, 'ffmpeg');
  try {
    // 模拟真实 NVENC：帧宽或高小于 145 像素时报 “Frame Dimension less than the minimum supported value”。
    const script = `#!/bin/sh\ncase "$*" in\n  *-version*) echo 'ffmpeg version fixture'; exit 0;;\n  *-encoders*) echo ' V..... h264_nvenc NVIDIA'; exit 0;;\nesac\nsize=$(echo "$*" | sed -n 's/.*:s=\\([0-9]*x[0-9]*\\).*/\\1/p')\nw=\${size%x*}; h=\${size#*x}\n[ -n "$w" ] && [ "$w" -ge 145 ] && [ "$h" -ge 145 ] && exit 0\nexit 234\n`;
    await writeFile(executable, script); await chmod(executable, 0o755);
    assert.equal((await module.probeFfmpeg(executable)).encoder, 'nvenc');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
