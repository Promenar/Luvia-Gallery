import { test } from 'node:test';
import assert from 'node:assert/strict';

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
