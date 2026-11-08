import { open } from 'node:fs/promises';

/** 根据文件头识别 JPEG，扩展名不作为解码格式的依据。 */
export async function isJpegFile(filename: string): Promise<boolean> {
  const file = await open(filename, 'r');
  try {
    const bytes = Buffer.alloc(3);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    return bytesRead === 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  } finally { await file.close(); }
}

/** ISO BMFF 媒体可能使用与内容不一致的图片扩展名。 */
export async function isIsoBmffFile(filename: string): Promise<boolean> {
  const file = await open(filename, 'r');
  try {
    const bytes = Buffer.alloc(8);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    return bytesRead === 8 && bytes.toString('ascii', 4, 8) === 'ftyp';
  } finally { await file.close(); }
}

/** 只对图片解码错误尝试兼容路径，文件访问和任务错误继续交给调用方。 */
export function isImageDecodeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code && /^E[A-Z0-9]+$/.test(code)) return false;
  return /unsupported image format|vips(?:jpeg|png|gif|tiff|webp|foreignload)|tiff2vips|gifload|corrupt|premature|invalid image|bad image/i.test(error.message);
}
