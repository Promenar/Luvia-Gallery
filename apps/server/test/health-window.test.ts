import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workerReady } from '../src/core/health-window.ts';

test('工作进程心跳必须存在、健康并且未过期', () => {
  assert.equal(workerReady(null, 100), false);
  assert.equal(workerReady({ at: 79, healthy: true }, 100), false);
  assert.equal(workerReady({ at: 99, healthy: false }, 100), false);
  assert.equal(workerReady({ at: 99, healthy: true }, 100), true);
  assert.equal(workerReady({ at: 106, healthy: true }, 100), false);
});
