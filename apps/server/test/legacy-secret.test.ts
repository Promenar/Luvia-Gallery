import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as runtime from '../src/core/runtime.ts';

delete process.env.JWT_SECRET;
test('旧版 JWT 密钥优先使用旧数据目录，新密钥原子持久化且权限收窄', async () => {
  const load = Reflect.get(runtime, 'loadLegacyJwtSecret');
  assert.equal(typeof load, 'function');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-jwt-'));
  const data = path.join(root, 'data'); const legacy = path.join(root, 'legacy');
  await mkdir(data); await mkdir(legacy);
  try {
    const [first, second] = await Promise.all([load(legacy, data), load(legacy, data)]);
    assert.equal(first, second);
    assert.ok(first.length >= 64);
    assert.equal((await stat(path.join(data, 'legacy-jwt.key'))).mode & 0o077, 0);
    await writeFile(path.join(legacy, 'jwt_secret.key'), 'synthetic-legacy-key');
    assert.equal(await load(legacy, data), 'synthetic-legacy-key');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('合成环境变量指定的旧 JWT 签名密钥优先于旧密钥文件', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-jwt-env-'));
  const data = path.join(root, 'data'); const legacy = path.join(root, 'legacy');
  await mkdir(data); await mkdir(legacy);
  try {
    await writeFile(path.join(legacy, 'jwt_secret.key'), 'synthetic-file-key');
    process.env.JWT_SECRET = 'synthetic-environment-key';
    assert.equal(await runtime.loadLegacyJwtSecret(legacy, data), 'synthetic-environment-key');
  } finally { delete process.env.JWT_SECRET; await rm(root, { recursive: true, force: true }); }
});
