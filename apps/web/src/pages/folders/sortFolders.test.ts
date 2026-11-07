import { describe, expect, it } from 'vitest';
import { sortFolders } from './sortFolders';

describe('文件夹卡片排序', () => {
  const folders = [
    { name: '目录10', modifiedAt: '2026-01-01T00:00:00.000Z' },
    { name: '目录2', modifiedAt: '2026-01-01T00:00:00.000Z' },
    { name: '新目录', modifiedAt: '2026-11-01T00:00:00.000Z' },
    { name: '未知', modifiedAt: null },
  ];
  it('按目录自身修改时间倒序，同时间自然排序，未知时间置后', () => {
    expect(sortFolders(folders, 'modified_desc').map((item) => item.name)).toEqual(['新目录', '目录2', '目录10', '未知']);
    expect(folders[0]?.name).toBe('目录10');
  });
  it('支持名称自然排序', () => {
    expect(sortFolders(folders, 'name_asc').map((item) => item.name)).toEqual(['目录2', '目录10', '未知', '新目录']);
  });
});
