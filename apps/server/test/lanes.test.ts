import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLanes } from '../src/worker/lanes.ts';
import { isTransientSqliteError } from '../src/core/sqlite-errors.ts';

test('并发通道中后面的通道先出错时，抛出该错误而不是其它通道随之产生的中止错误', async () => {
  const stop = new AbortController();
  let index = 0;
  const busy = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
  const lane = async () => {
    const mine = index++;
    if (mine === 0) {
      // 第一个通道正在等待，被其它通道的错误中止
      await new Promise<void>((resolve) => stop.signal.addEventListener('abort', () => resolve(), { once: true }));
      stop.signal.throwIfAborted();
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
    throw busy;
  };
  await assert.rejects(runLanes(3, stop, lane), (error) => error === busy && isTransientSqliteError(error));
  assert.equal(stop.signal.aborted, true);
});

test('所有通道正常结束时不抛错也不中止', async () => {
  const stop = new AbortController(); let done = 0;
  await runLanes(4, stop, async () => { done++; });
  assert.equal(done, 4); assert.equal(stop.signal.aborted, false);
});
