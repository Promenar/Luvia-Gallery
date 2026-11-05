export function statFields(info: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint }): { dev: string; ino: string; size: number; mtimeMs: number } {
  const size = Number(info.size); const wholeMs = Number(info.mtimeNs / 1_000_000n);
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('文件大小超出可精确处理的范围');
  if (!Number.isSafeInteger(wholeMs)) throw new Error('文件修改时间超出可精确处理的范围');
  return { dev: info.dev.toString(), ino: info.ino.toString(), size, mtimeMs: wholeMs + Number(info.mtimeNs % 1_000_000n) / 1_000_000 };
}
