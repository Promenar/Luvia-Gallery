import { describe, expect, it } from 'vitest';
import { defaultImportName, folderProblem, isImageFile, normalizeFolder } from './format';

describe('isImageFile', () => {
  it('接受服务端支持的图片格式', () => {
    expect(isImageFile({ type: 'image/png', name: 'a.png' })).toBe(true);
    expect(isImageFile({ type: '', name: 'a.HEIC' })).toBe(false);
    expect(isImageFile({ type: 'image/heic', name: 'a.heic' })).toBe(false);
    expect(isImageFile({ type: '', name: 'a.webp' })).toBe(true);
    expect(isImageFile({ type: '', name: 'a.raw' })).toBe(false);
    expect(isImageFile({ type: 'text/plain', name: 'a.txt' })).toBe(false);
  });
});

describe('defaultImportName', () => {
  it('保留受支持的扩展名并追加“-修复”', () => {
    expect(defaultImportName('photo.jpg')).toBe('photo-修复.jpg');
    expect(defaultImportName('photo.JPEG')).toBe('photo-修复.jpeg');
    expect(defaultImportName('archive.v2.png')).toBe('archive.v2-修复.png');
  });

  it('未知或缺失扩展名落到 PNG', () => {
    expect(defaultImportName('photo.heic')).toBe('photo-修复.png');
    expect(defaultImportName('photo')).toBe('photo-修复.png');
  });

  it('空名称有兜底', () => {
    expect(defaultImportName('.png')).toBe('修复图片-修复.png');
  });
});

describe('normalizeFolder', () => {
  it('去掉首尾斜杠并把反斜杠统一为斜杠', () => {
    expect(normalizeFolder(' /2026/07 杭州/ ')).toBe('2026/07 杭州');
    expect(normalizeFolder('2026\\07 杭州')).toBe('2026/07 杭州');
    expect(normalizeFolder('/')).toBe('');
  });
});

describe('folderProblem', () => {
  it('空路径表示根目录', () => {
    expect(folderProblem('')).toBeNull();
  });

  it('多级正常路径通过', () => {
    expect(folderProblem('2026/07 杭州/修复')).toBeNull();
  });

  it('拒绝 .、.. 与连续斜杠', () => {
    expect(folderProblem('a//b')).toBeTruthy();
    expect(folderProblem('../a')).toBeTruthy();
    expect(folderProblem('a/./b')).toBeTruthy();
  });

  it('拒绝过长路径', () => {
    expect(folderProblem('a'.repeat(501))).toBeTruthy();
  });
});
