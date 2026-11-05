import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('mountinfo 解码路径并使用显式宿主机映射，系统挂载不能成为候选', async () => {
  const module = await import('../src/core/mounts.ts').catch(() => null);
  assert.ok(module, '挂载解析模块尚未实现');
  const lines = [
    '20 1 0:1 / / rw - overlay overlay rw',
    '21 20 0:2 /vol1/Photos /media/photos ro,relatime - ext4 /dev/sda1 rw',
    '22 20 0:3 /vol2/Phone\\040Backup /media/phone\\040backup rw - ext4 /dev/sdb1 rw',
    '23 20 0:4 /luvia-data /data rw - ext4 /dev/sdc1 rw',
    '24 20 0:5 / /proc rw - proc proc rw',
  ].join('\n');
  const mounts = module.parseMountInfo(lines, { mediaRoots: ['/media'], systemRoots: ['/data', '/cache'], hostPaths: '/media/photos=/host/photos' });
  const photo = mounts.find((item) => item.containerPath === '/media/photos');
  assert.equal(photo?.kind, 'candidate');
  assert.equal(photo?.hostPath, '/host/photos');
  assert.equal(photo?.readOnly, true);
  const phone = mounts.find((item) => item.containerPath === '/media/phone backup');
  assert.equal(phone?.hostPath, '/vol2/Phone Backup');
  assert.equal(phone?.kind, 'candidate');
  assert.equal(mounts.find((item) => item.containerPath === '/data')?.kind, 'system');
  assert.equal(mounts.find((item) => item.containerPath === '/proc')?.kind, 'other');
});

test('挂载媒体估计只读取前两层并在超时后返回空值', async () => {
  const module = await import('../src/worker/mount-estimate.ts').catch(() => null);
  assert.ok(module, '挂载抽样模块尚未实现');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-mount-sample-'));
  try {
    await mkdir(path.join(root, 'first', 'deep'), { recursive: true });
    await writeFile(path.join(root, 'a.jpg'), 'a');
    await writeFile(path.join(root, 'first', 'b.mp4'), 'b');
    await writeFile(path.join(root, 'first', 'deep', 'c.png'), 'c');
    assert.equal(await module.estimateMount(root), 2);
    const slow = async () => new Promise<never>(() => {});
    assert.equal(await module.estimateMount(root, { timeoutMs: 25, openDir: slow }), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
