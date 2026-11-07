/** 只对图片解码错误尝试兼容路径，文件访问和任务错误继续交给调用方。 */
export function isImageDecodeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  if (code && /^E[A-Z0-9]+$/.test(code)) return false;
  return /unsupported image format|vips(?:jpeg|png|gif|tiff|webp|foreignload)|corrupt|premature|invalid image|bad image/i.test(error.message);
}
