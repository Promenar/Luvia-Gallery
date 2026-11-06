import { fork, type ChildProcess } from 'node:child_process';

export type ProcessResult = { code: number | null; signal: NodeJS.Signals | null; stdout: string; error?: 'spawn' | 'timeout' | 'maxBuffer' | 'runner' };
type Pending = { resolve: (result: ProcessResult) => void; cleanup: () => void };

let runner: ChildProcess | null = null;
let nextId = 0;
const pending = new Map<number, Pending>();

function settle(id: number, result: ProcessResult) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id); entry.cleanup(); entry.resolve(result);
  if (!pending.size) { runner?.unref(); runner?.channel?.unref(); }
}

/**
 * 启动子进程代理（见 process-runner-child.ts）。worker 启动时内存还小，尽早调用；
 * 代理意外退出时未完成的调用按失败返回，下次调用时重新启动。
 */
export function startProcessRunner(): ChildProcess {
  if (runner?.connected) return runner;
  const child = fork(new URL('./process-runner-child.ts', import.meta.url), [], { execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  child.on('message', (message: { type: 'done'; id: number } & ProcessResult) => {
    if (message.type === 'done') settle(message.id, { code: message.code, signal: message.signal, stdout: message.stdout, ...(message.error ? { error: message.error } : {}) });
  });
  const lost = () => {
    if (runner === child) runner = null;
    for (const id of [...pending.keys()]) settle(id, { code: null, signal: null, stdout: '', error: 'runner' });
  };
  child.once('exit', lost); child.once('error', lost);
  child.unref(); child.channel?.unref();
  runner = child;
  return child;
}

export function stopProcessRunner() {
  const child = runner; runner = null;
  if (child?.connected) child.disconnect();
}

/** 通过代理启动外部程序并等待结束；取消时终止程序。只在 capture 时收集标准输出。 */
export async function runProcess(file: string, args: string[], options: { timeoutMs: number; maxBuffer?: number; capture?: boolean; signal?: AbortSignal }): Promise<ProcessResult> {
  options.signal?.throwIfAborted();
  const child = startProcessRunner();
  const id = ++nextId;
  return new Promise((resolve) => {
    const abort = () => { if (child.connected) child.send({ type: 'kill', id }); };
    options.signal?.addEventListener('abort', abort, { once: true });
    pending.set(id, { resolve, cleanup: () => options.signal?.removeEventListener('abort', abort) });
    child.ref(); child.channel?.ref();
    child.send({ type: 'run', id, file, args, path: process.env.PATH, timeoutMs: options.timeoutMs, maxBuffer: options.maxBuffer ?? 1024 * 1024, capture: !!options.capture }, (error) => {
      if (error) settle(id, { code: null, signal: null, stdout: '', error: 'runner' });
    });
  });
}
