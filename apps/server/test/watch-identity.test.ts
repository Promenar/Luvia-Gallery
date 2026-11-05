import { test } from 'node:test';
import assert from 'node:assert/strict';

test('设备号与大于安全整数的 inode 保持精确，避免错误配对', async () => {
  const m = await import('../src/watch/file-info.ts'); assert.ok(m, '精确文件标识转换尚未实现');
  const first = m.statFields({ dev: 123n, ino: 9007199254740992n, size: 42n, mtimeNs: 1700000000123456789n });
  const second = m.statFields({ dev: 123n, ino: 9007199254740993n, size: 42n, mtimeNs: 1700000000123456789n });
  assert.equal(first.dev, '123'); assert.equal(first.ino, '9007199254740992');
  assert.equal(second.ino, '9007199254740993'); assert.notEqual(first.ino, second.ino);
  assert.equal(first.size, 42); assert.equal(first.mtimeMs, 1700000000123.4568);
  assert.throws(() => m.statFields({ dev: 1n, ino: 1n, size: 9007199254740993n, mtimeNs: 1n }), /大小/);
});
