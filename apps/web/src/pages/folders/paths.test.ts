import { describe, expect, it } from 'vitest';
import { ancestorsOf, containerPathOf, hostCrumbs, parentPath, relOf } from './paths';

const bc = (...names: [string, string][]) => names.map(([name, path]) => ({ name, path }));

describe('宿主机面包屑分段', () => {
  it('挂载点之外的目录不可点击，挂载点与其下目录可浏览，最后一段为当前', () => {
    const r = hostCrumbs({
      path: 'photos/2025/2025-09 上海',
      breadcrumbs: bc(['照片库', 'photos'], ['2025', 'photos/2025'], ['2025-09 上海', 'photos/2025/2025-09 上海']),
      hostRoot: '/vol1/1000/Photos',
      hostPath: '/vol1/1000/Photos/2025/2025-09 上海',
    });
    expect(r.mode).toBe('host');
    expect(r.crumbs).toEqual([
      { kind: 'outside', name: 'vol1' },
      { kind: 'outside', name: '1000' },
      { kind: 'link', name: 'Photos', path: 'photos' },
      { kind: 'link', name: '2025', path: 'photos/2025' },
      { kind: 'current', name: '2025-09 上海', path: 'photos/2025/2025-09 上海' },
    ]);
  });

  it('位于媒体库根时挂载点本身就是当前目录', () => {
    const r = hostCrumbs({ path: 'phone', breadcrumbs: bc(['手机备份', 'phone']), hostRoot: '/vol2/1000/Backup/Phone/', hostPath: '/vol2/1000/Backup/Phone' });
    expect(r.crumbs.map((c) => c.kind)).toEqual(['outside', 'outside', 'outside', 'current']);
    expect(r.crumbs.at(-1)).toEqual({ kind: 'current', name: 'Phone', path: 'phone' });
  });

  it('挂载点为根目录时没有挂载点之外的段', () => {
    const r = hostCrumbs({ path: 'lib/a', breadcrumbs: bc(['库', 'lib'], ['a', 'lib/a']), hostRoot: '/', hostPath: '/a' });
    expect(r.crumbs).toEqual([
      { kind: 'link', name: '/', path: 'lib' },
      { kind: 'current', name: 'a', path: 'lib/a' },
    ]);
  });

  it('Windows 宿主机路径按反斜杠分段，盘符算作挂载点之外', () => {
    const r = hostCrumbs({ path: 'w/x', breadcrumbs: bc(['W', 'w'], ['x', 'w/x']), hostRoot: 'D:\\Media\\Pics', hostPath: 'D:\\Media\\Pics\\x' });
    expect(r.sep).toBe('\\');
    expect(r.crumbs).toEqual([
      { kind: 'outside', name: 'D:' },
      { kind: 'outside', name: 'Media' },
      { kind: 'link', name: 'Pics', path: 'w' },
      { kind: 'current', name: 'x', path: 'w/x' },
    ]);
  });

  it('前缀相同但不是子目录时不误判（/Photos2 不在 /Photos 之下），退回虚拟面包屑', () => {
    const r = hostCrumbs({ path: 'p/a', breadcrumbs: bc(['照片库', 'p'], ['a', 'p/a']), hostRoot: '/Photos', hostPath: '/Photos2/a' });
    expect(r.mode).toBe('virtual');
  });

  it('普通用户看不到宿主机路径时退回媒体库名 + 虚拟目录', () => {
    const r = hostCrumbs({ path: 'p/a', breadcrumbs: bc(['照片库', 'p'], ['a', 'p/a']), hostRoot: null, hostPath: null });
    expect(r).toEqual({
      mode: 'virtual',
      sep: '/',
      crumbs: [
        { kind: 'link', name: '照片库', path: 'p' },
        { kind: 'current', name: 'a', path: 'p/a' },
      ],
    });
  });

  it('宿主机层级与虚拟面包屑对不上时退回虚拟面包屑', () => {
    const r = hostCrumbs({ path: 'p/a', breadcrumbs: bc(['照片库', 'p'], ['a', 'p/a']), hostRoot: '/x', hostPath: '/x/a/b' });
    expect(r.mode).toBe('virtual');
  });
});

describe('虚拟路径工具', () => {
  it('相对目录、上一级与祖先', () => {
    expect(relOf('photos')).toBe('');
    expect(relOf('photos/2025/上海')).toBe('2025/上海');
    expect(parentPath('photos')).toBeUndefined();
    expect(parentPath('photos/2025/上海')).toBe('photos/2025');
    expect(ancestorsOf('photos/2025/上海')).toEqual(['photos', 'photos/2025']);
    expect(ancestorsOf('photos')).toEqual([]);
  });

  it('容器内路径拼接', () => {
    expect(containerPathOf('/media/photos', 'photos')).toBe('/media/photos');
    expect(containerPathOf('/media/photos/', 'photos/2025/上海')).toBe('/media/photos/2025/上海');
    expect(containerPathOf('/', 'x/a')).toBe('/a');
  });
});
