/** 外部图片修复页的纯逻辑：文件类型、默认导入名与相对文件夹校验。 */

const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const isImageFile = (file: Pick<File, 'type' | 'name'>) => file.type ? IMAGE_MIME.has(file.type.toLowerCase()) : IMAGE_EXT.test(file.name);

/** 默认导入名：保留受支持的原扩展名，未知格式落到 PNG；同名由后端追加序号。 */
export function defaultImportName(original: string): string {
  const ext = (/\.[^.]+$/.exec(original)?.[0] ?? '').toLowerCase();
  const allowed = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? ext : '.png';
  const stem = original.slice(0, original.length - (ext ? ext.length : 0)).trim() || '修复图片';
  return `${stem}-修复${allowed}`;
}

/** 把用户输入规整为媒体库内的相对路径；空字符串表示库根。 */
export function normalizeFolder(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/** 相对文件夹的本地校验；后端仍会做最终路径与符号链接校验。 */
export function folderProblem(value: string): string | null {
  if (!value) return null;
  const parts = value.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return '路径不能包含 .、.. 或连续斜杠';
  if (value.length > 500) return '路径过长';
  return null;
}
