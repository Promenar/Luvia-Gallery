import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

function checkedRelative(relative: string, allowEmpty: boolean): string {
  if (relative === '' && allowEmpty) return relative;
  if (!relative || relative.includes('\\') || relative.includes('\0') || relative.startsWith('/')) {
    throw new Error('无效的相对路径');
  }
  if (relative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('无效的相对路径');
  }
  return relative;
}

function checkedLibraryId(libraryId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(libraryId)) throw new Error('无效的媒体库 ID');
  return libraryId;
}

export function mediaId(libraryId: string, relative: string): string {
  checkedLibraryId(libraryId);
  checkedRelative(relative, false);
  return createHash('sha256').update(libraryId).update('\0').update(relative).digest('base64url').slice(0, 32);
}

export function virtualPath(libraryId: string, relative: string): string {
  checkedLibraryId(libraryId);
  checkedRelative(relative, true);
  return relative ? `${libraryId}/${relative}` : libraryId;
}

function validVirtualPath(value: string): boolean {
  const slash = value.indexOf('/');
  const libraryId = slash < 0 ? value : value.slice(0, slash);
  const relative = slash < 0 ? '' : value.slice(slash + 1);
  try {
    checkedLibraryId(libraryId);
    checkedRelative(relative, true);
    return slash < 0 || relative !== '';
  } catch {
    return false;
  }
}

export function pathAllowed(virtual: string, allowed: string[] | null): boolean {
  if (!validVirtualPath(virtual)) return false;
  if (allowed === null) return true;
  return allowed.some((prefix) => validVirtualPath(prefix) && (virtual === prefix || virtual.startsWith(`${prefix}/`)));
}

export async function secureMediaPath(root: string, relative: string): Promise<string> {
  checkedRelative(relative, false);
  const actualRoot = await realpath(root);
  const target = await realpath(path.join(actualRoot, relative));
  const fromRoot = path.relative(actualRoot, target);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    throw new Error('媒体路径不在允许的目录中');
  }
  if (!(await stat(target)).isFile()) throw new Error('媒体路径不是文件');
  return target;
}
