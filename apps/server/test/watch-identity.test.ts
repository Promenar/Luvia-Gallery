import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDarwinMountIdentity, parseMountIdentity } from '../src/watch/root-guard.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('macOS 返回可比较的文件系统挂载身份', { skip: process.platform !== 'darwin' }, async () => {
  const { readRootMountIdentity } = await import('../src/watch/root-guard.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-mount-identity-'));
  try {
    const value = await readRootMountIdentity(root); assert.notEqual(value, null);
    const identity = JSON.parse(value!) as string[];
    assert.equal(identity.length, 3); assert.ok(identity.every((part) => typeof part === 'string' && part.length > 0));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('macOS 卸载后选择底层文件系统身份，恢复时选择网络挂载', () => {
  const base = '/dev/disk1s1 on / (apfs, local, read-only)';
  const mounted = `${base}\nserver:/share on /Volumes/Photos (nfs, nodev, mounted by user)`;
  assert.deepEqual(JSON.parse(parseDarwinMountIdentity(mounted, '/Volumes/Photos/album')), ['nfs', 'server:/share', '/album']);
  assert.deepEqual(JSON.parse(parseDarwinMountIdentity(base, '/Volumes/Photos/album')), ['apfs', '/dev/disk1s1', '/Volumes/Photos/album']);
  const spaced = `${base}\nserver:/folder on photos on /Volumes/My on Photos (nfs, nodev)`;
  assert.deepEqual(JSON.parse(parseDarwinMountIdentity(spaced, '/Volumes/My on Photos/album')), ['nfs', 'server:/folder on photos', '/album']);
});

test('挂载编号和设备号变化不改变持久挂载身份', () => {
  const first = '42 1 8:1 /photos /media/a rw - nfs server:/share rw';
  const remounted = '99 1 8:9 /photos /media/a rw - nfs server:/share rw';
  assert.equal(parseMountIdentity(first, '/media/a/album'), parseMountIdentity(remounted, '/media/a/album'));
  assert.deepEqual(JSON.parse(parseMountIdentity(first, '/media/a/album')), ['nfs', 'server:/share', '/photos/album']);
});

test('设备号与大于安全整数的 inode 保持精确，避免错误配对', async () => {
  const m = await import('../src/watch/file-info.ts'); assert.ok(m, '精确文件标识转换尚未实现');
  const first = m.statFields({ dev: 123n, ino: 9007199254740992n, size: 42n, mtimeNs: 1700000000123456789n });
  const second = m.statFields({ dev: 123n, ino: 9007199254740993n, size: 42n, mtimeNs: 1700000000123456789n });
  assert.equal(first.dev, '123'); assert.equal(first.ino, '9007199254740992');
  assert.equal(second.ino, '9007199254740993'); assert.notEqual(first.ino, second.ino);
  assert.equal(first.size, 42); assert.equal(first.mtimeMs, 1700000000123.4568);
  assert.throws(() => m.statFields({ dev: 1n, ino: 1n, size: 9007199254740993n, mtimeNs: 1n }), /大小/);
});
