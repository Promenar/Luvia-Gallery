import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { runProcess, startProcessRunner, stopProcessRunner } from '../src/worker/process-runner.ts';

after(() => stopProcessRunner());

test('外部程序由子进程代理启动，不由当前进程 fork', async () => {
  const runner = startProcessRunner();
  const result = await runProcess('sh', ['-c', 'echo $PPID'], { timeoutMs: 5000, capture: true });
  assert.equal(result.code, 0);
  const parent = Number(result.stdout.trim());
  assert.equal(parent, runner.pid);
  assert.notEqual(parent, process.pid);
});

test('返回退出码与输出，超时、输出超限、程序不存在与取消均可区分', async () => {
  assert.deepEqual(await runProcess('sh', ['-c', 'printf hello; exit 3'], { timeoutMs: 5000, capture: true }), { code: 3, signal: null, stdout: 'hello' });
  assert.equal((await runProcess('sh', ['-c', 'printf hello'], { timeoutMs: 5000 })).stdout, '');
  assert.equal((await runProcess('sleep', ['5'], { timeoutMs: 100 })).error, 'timeout');
  assert.equal((await runProcess('sh', ['-c', 'head -c 4096 /dev/zero'], { timeoutMs: 5000, capture: true, maxBuffer: 1024 })).error, 'maxBuffer');
  assert.equal((await runProcess('luvia-missing-binary', [], { timeoutMs: 5000 })).error, 'spawn');
  const controller = new AbortController();
  const started = Date.now();
  const running = runProcess('sleep', ['5'], { timeoutMs: 10000, signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  const aborted = await running;
  assert.equal(aborted.signal, 'SIGKILL');
  assert.ok(Date.now() - started < 3000);
  await assert.rejects(runProcess('sh', ['-c', 'true'], { timeoutMs: 5000, signal: AbortSignal.abort() }), { name: 'AbortError' });
});

test('代理意外退出时未完成的调用返回失败，下一次调用重新启动代理', async () => {
  const runner = startProcessRunner();
  const running = runProcess('sleep', ['5'], { timeoutMs: 10000 });
  runner.kill('SIGKILL');
  assert.equal((await running).error, 'runner');
  const next = await runProcess('sh', ['-c', 'echo ok'], { timeoutMs: 5000, capture: true });
  assert.equal(next.stdout.trim(), 'ok');
});

test('代理能有界传递二进制数据，输出超限会中止', async () => {
  const input = Buffer.from([0, 255, 128, 42, 13, 10]).toString('base64');
  const result = await runProcess('cat', [], { timeoutMs: 5000, capture: true, binary: true, inputBase64: input });
  assert.equal(result.code, 0);
  assert.deepEqual(Buffer.from(result.stdout, 'base64'), Buffer.from(input, 'base64'));
  const large = await runProcess('sh', ['-c', 'head -c 4096 /dev/zero'], { timeoutMs: 5000, capture: true, binary: true, maxBuffer: 1024 });
  assert.equal(large.error, 'maxBuffer');
});
