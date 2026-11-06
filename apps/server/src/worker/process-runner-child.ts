import { spawn, type ChildProcess } from 'node:child_process';

/**
 * 子进程代理：内存很小，由 worker 启动后常驻，替 worker 启动 ffprobe、ffmpeg。
 * Linux 上启动子进程要复制父进程页表，在内存占用数 GB 的 worker 主线程里每次要数百毫秒到数秒。
 */
type Run = { type: 'run'; id: number; file: string; args: string[]; path?: string; timeoutMs: number; maxBuffer: number; capture: boolean };
type Kill = { type: 'kill'; id: number };

const children = new Map<number, ChildProcess>();
process.on('message', (message: Run | Kill) => {
  if (message.type === 'kill') { children.get(message.id)?.kill('SIGKILL'); return; }
  const { id } = message;
  let stdout = ''; let size = 0; let error: 'spawn' | 'timeout' | 'maxBuffer' | undefined; let settled = false;
  const env = message.path === undefined ? process.env : { ...process.env, PATH: message.path };
  const child = spawn(message.file, message.args, { stdio: ['ignore', message.capture ? 'pipe' : 'ignore', 'ignore'], env });
  children.set(id, child);
  const timer = setTimeout(() => { error ??= 'timeout'; child.kill('SIGKILL'); }, message.timeoutMs);
  const finish = (code: number | null, signal: NodeJS.Signals | null) => {
    if (settled) return;
    settled = true; clearTimeout(timer); children.delete(id);
    process.send?.({ type: 'done', id, code, signal, stdout, error });
  };
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    size += Buffer.byteLength(chunk);
    if (size > message.maxBuffer) { error ??= 'maxBuffer'; child.kill('SIGKILL'); return; }
    stdout += chunk;
  });
  child.once('error', () => { error ??= 'spawn'; finish(null, null); });
  child.once('close', finish);
});
// worker 退出或断开时结束全部子进程
process.on('disconnect', () => { for (const child of children.values()) child.kill('SIGKILL'); process.exit(0); });
