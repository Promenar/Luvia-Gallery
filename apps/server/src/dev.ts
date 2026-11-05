import { spawn } from 'node:child_process';

const children = ['src/api/main.ts', 'src/worker/main.ts'].map((entry) => spawn(process.execPath, ['--watch', entry], { stdio: 'inherit' }));
let stopping = false;
function stop(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}
for (const child of children) {
  child.on('error', () => stop(1));
  child.on('exit', (code, signal) => { if (!stopping) stop(signal ? 1 : code ?? 1); });
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
