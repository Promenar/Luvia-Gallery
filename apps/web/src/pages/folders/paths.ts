import type { Breadcrumb } from '@luvia/contracts';

/**
 * 宿主机面包屑的一段：
 * - outside：挂载点之外的宿主机目录，容器访问不到，只展示不可点击
 * - link：可浏览的上级目录，点击进入对应虚拟路径
 * - current：当前所在目录
 */
export type HostCrumb =
  | { kind: 'outside'; name: string }
  | { kind: 'link'; name: string; path: string }
  | { kind: 'current'; name: string; path: string };

export interface HostCrumbs {
  /** host：按宿主机真实路径分段；virtual：缺少宿主机信息时退回媒体库名 + 虚拟目录。 */
  mode: 'host' | 'virtual';
  /** 路径分隔符，Windows 宿主机为反斜杠。 */
  sep: '/' | '\\';
  crumbs: HostCrumb[];
}

interface ListingLike {
  path: string;
  breadcrumbs: Breadcrumb[];
  hostPath: string | null;
  hostRoot: string | null;
}

const trimEnd = (s: string, sep: string) => {
  let out = s;
  while (out.length > 1 && out.endsWith(sep) && !/^[A-Za-z]:\\$/.test(out)) out = out.slice(0, -1);
  return out;
};

/** 把宿主机路径拆成目录名数组，兼容 POSIX 与 Windows（盘符作为第一段）。 */
function splitHost(p: string, sep: '/' | '\\') {
  return p.split(sep).filter(Boolean);
}

/** 虚拟面包屑：第一段为媒体库名，其余为目录名，全部可点击（最后一段为当前）。 */
function virtualCrumbs(listing: ListingLike): HostCrumbs {
  const crumbs: HostCrumb[] = listing.breadcrumbs.map((b, i, all) =>
    i === all.length - 1 ? { kind: 'current', name: b.name, path: b.path } : { kind: 'link', name: b.name, path: b.path },
  );
  return { mode: 'virtual', sep: '/', crumbs };
}

/**
 * 按媒体库挂载点（hostRoot）把当前目录的宿主机路径分成“挂载点之外”与“可浏览”两段。
 * 挂载点本身对应媒体库根（breadcrumbs[0]），其下每一级目录对应 breadcrumbs 的后续各项。
 * 宿主机路径缺失、不在挂载点之下或层级与虚拟面包屑对不上时，退回虚拟面包屑，避免给出错误的跳转目标。
 */
export function hostCrumbs(listing: ListingLike): HostCrumbs {
  const { hostPath, hostRoot, breadcrumbs } = listing;
  if (!hostPath || !hostRoot || breadcrumbs.length === 0) return virtualCrumbs(listing);
  const sep: '/' | '\\' = hostRoot.includes('\\') && !hostRoot.includes('/') ? '\\' : '/';
  const root = trimEnd(hostRoot, sep);
  const full = trimEnd(hostPath, sep);
  const isRootSlash = root === '/';
  const under = full === root || full.startsWith(isRootSlash ? '/' : root + sep);
  if (!under) return virtualCrumbs(listing);

  const rootParts = splitHost(root, sep);
  const relParts = splitHost(isRootSlash ? full : full.slice(root.length), sep);
  if (relParts.length !== breadcrumbs.length - 1) return virtualCrumbs(listing);

  const crumbs: HostCrumb[] = rootParts.slice(0, -1).map((name) => ({ kind: 'outside', name }));
  const mountName = rootParts.at(-1) ?? sep;
  const libRoot = breadcrumbs[0]!;
  crumbs.push(relParts.length ? { kind: 'link', name: mountName, path: libRoot.path } : { kind: 'current', name: mountName, path: libRoot.path });
  relParts.forEach((name, i) => {
    const b = breadcrumbs[i + 1]!;
    crumbs.push(i === relParts.length - 1 ? { kind: 'current', name, path: b.path } : { kind: 'link', name, path: b.path });
  });
  return { mode: 'host', sep, crumbs };
}

/** 虚拟路径中媒体库之下的相对目录（媒体库根为空串）。 */
export function relOf(path: string) {
  const i = path.indexOf('/');
  return i < 0 ? '' : path.slice(i + 1);
}

/** 虚拟路径所属媒体库 ID。 */
export const libraryIdOf = (path: string) => path.split('/')[0] ?? '';

/** 上一级虚拟路径；媒体库根的上一级是“全部目录”（返回 undefined）。 */
export function parentPath(path: string): string | undefined {
  const i = path.lastIndexOf('/');
  return i < 0 ? undefined : path.slice(0, i);
}

/** 从媒体库根到 path 的各级祖先（不含 path 本身），用于自动展开目录树。 */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** 容器内路径 = 媒体库容器内根目录 + 相对目录。 */
export function containerPathOf(libraryRoot: string, path: string) {
  const rel = relOf(path);
  const root = libraryRoot.endsWith('/') && libraryRoot.length > 1 ? libraryRoot.slice(0, -1) : libraryRoot;
  if (!rel) return root;
  return root === '/' ? `/${rel}` : `${root}/${rel}`;
}
