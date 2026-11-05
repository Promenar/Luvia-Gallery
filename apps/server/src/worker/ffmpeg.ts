import { spawn } from 'node:child_process';

type Probe = { available: boolean; version: string | null; hwaccels: string[]; encoder: 'nvenc' | 'cpu' };
async function execute(executable: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<{ code: number | null; output: string }> {
  signal?.throwIfAborted();
  return new Promise((resolve) => {
    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let settled = false;
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', stop); resolve({ code, output });
    };
    const collect = (chunk: Buffer) => { if (output.length < 65536) output += chunk.toString('utf8').slice(0, 65536 - output.length); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
    const stop = () => { child.kill('SIGKILL'); };
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, timeoutMs);
    timer.unref();
  });
}
export async function probeFfmpeg(executable = 'ffmpeg', signal?: AbortSignal): Promise<Probe> {
  const version = await execute(executable, ['-version'], 5000, signal);
  if (version.code !== 0) return { available: false, version: null, hwaccels: [], encoder: 'cpu' };
  const displayVersion = version.output.split('\n')[0]?.slice(0, 160) || null;
  const encoders = await execute(executable, ['-hide_banner', '-encoders'], 5000, signal);
  if (encoders.code === 0 && /\bh264_nvenc\b/.test(encoders.output)) {
    const test = await execute(executable, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:r=1', '-frames:v', '1', '-c:v', 'h264_nvenc', '-f', 'null', '-'], 10000, signal);
    if (test.code === 0) return { available: true, version: displayVersion, hwaccels: ['nvenc'], encoder: 'nvenc' };
  }
  return { available: true, version: displayVersion, hwaccels: [], encoder: 'cpu' };
}
