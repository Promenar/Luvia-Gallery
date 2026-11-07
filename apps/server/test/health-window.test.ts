import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HealthWindow, workerReady } from '../src/core/health-window.ts';

test('短时事件循环尖峰不使服务失去就绪，持续异常会失败并在恢复后返回', () => {
  const state = new HealthWindow();
  assert.equal(state.observe(20), true);
  assert.equal(state.observe(80), true);
  assert.equal(state.observe(25), true);
  assert.equal(state.observe(80), true);
  assert.equal(state.observe(80), true);
  assert.equal(state.observe(80), false);
  assert.equal(state.observe(25), true);
});

test('工作进程心跳必须存在、健康并且未过期', () => {
  assert.equal(workerReady(null, 100), false);
  assert.equal(workerReady({ at: 79, healthy: true }, 100), false);
  assert.equal(workerReady({ at: 99, healthy: false }, 100), false);
  assert.equal(workerReady({ at: 99, healthy: true }, 100), true);
  assert.equal(workerReady({ at: 106, healthy: true }, 100), false);
});
