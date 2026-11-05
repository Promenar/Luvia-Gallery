import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mediaId, virtualPath, pathAllowed, secureMediaPath } from '../src/core/paths.ts';

test('媒体 ID 稳定、区分媒体库与路径且适合作为 URL 分量', () => {
  const id = mediaId('lib1', '旅行/照片.jpg');
  assert.match(id, /^[A-Za-z0-9_-]+$/);
  assert.equal(id, mediaId('lib1', '旅行/照片.jpg'));
  assert.notEqual(id, mediaId('lib2', '旅行/照片.jpg'));
  assert.notEqual(id, mediaId('lib1', '旅行/照片2.jpg'));
  assert.throws(() => mediaId('lib1', '../逃逸.jpg'));
});

test('虚拟路径和权限比较按路径边界执行', () => {
  assert.equal(virtualPath('lib1', ''), 'lib1');
  assert.equal(virtualPath('lib1', '旅行/夏天'), 'lib1/旅行/夏天');
  assert.throws(() => virtualPath('lib1', '../私人'));
  assert.equal(pathAllowed('lib1/旅行', ['lib1/旅行']), true);
  assert.equal(pathAllowed('lib1/旅行/夏天', ['lib1/旅行']), true);
  assert.equal(pathAllowed('lib1/旅行者', ['lib1/旅行']), false);
  assert.equal(pathAllowed('lib1/其它', []), false);
  assert.equal(pathAllowed('lib1/其它', null), true);
});

test('原文件只能读取媒体根内真实路径，拒绝符号链接逃逸', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-path-'));
  try {
    const root = path.join(dir, 'library');
    await mkdir(root);
    await writeFile(path.join(root, 'ok.jpg'), 'ok');
    await writeFile(path.join(dir, 'outside.jpg'), 'private');
    await symlink(path.join(dir, 'outside.jpg'), path.join(root, 'link.jpg'));
    assert.equal(await secureMediaPath(root, 'ok.jpg'), await realpath(path.join(root, 'ok.jpg')));
    await assert.rejects(secureMediaPath(root, 'link.jpg'));
    await assert.rejects(secureMediaPath(root, '../outside.jpg'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
