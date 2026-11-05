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
