import { createHash } from 'node:crypto';
import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { secureMediaPath } from './paths.ts';

/**
 * 查找复制到缓存目录中的 1.x 缩略图（宽约 300 像素的 WebP，按原文件绝对路径的 base64 取 MD5 命名）。
 * 只在缩略图不早于原文件、原文件大小与修改时间和记录一致、且解析后仍位于缓存目录内时返回其路径。
 */
export async function findLegacyThumbnail(cacheDir: string, row: { root: string; relative_path: string; size: number; modified_at: number }): Promise<string | undefined> {
  const source = path.join(row.root, row.relative_path);
  const hash = createHash('md5').update(Buffer.from(source).toString('base64')).digest('hex');
  const filename = path.join(cacheDir, hash.slice(0, 2), hash.slice(2, 4), `${hash}.webp`);
  try {
    const [info, sourceInfo] = await Promise.all([lstat(filename), secureMediaPath(row.root, row.relative_path).then((resolved) => stat(resolved))]);
    if (!info.isFile() || info.isSymbolicLink() || info.size === 0 || info.mtimeMs < sourceInfo.mtimeMs || sourceInfo.size !== row.size || Math.floor(sourceInfo.mtimeMs / 1000) !== row.modified_at) return undefined;
    const [root, actual] = await Promise.all([realpath(cacheDir), realpath(filename)]);
    const relative = path.relative(root, actual);
    return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) ? actual : undefined;
  } catch { return undefined; }
}
