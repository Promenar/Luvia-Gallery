import sharp from 'sharp';
import { runDetection, type EditorServiceConfig } from './service.ts';
import { planDetectionTiles, type EditorTile } from './tiles.ts';

/** 分块检测原图，按核心区拼接，保持方向校正后的原始像素坐标。 */
export async function detectWatermark(config: EditorServiceConfig, input: {
  image: Buffer; width: number; height: number; jobId: string; threshold: number;
  signal: AbortSignal; progress: (value: number) => void;
}): Promise<{ mask: Buffer; detected: boolean; selectedTiles: EditorTile[] }> {
  const tiles = planDetectionTiles(input.width, input.height);
  const patches: Array<{ input: Buffer; left: number; top: number }> = [];
  const selectedTiles: EditorTile[] = [];
  for (let i = 0; i < tiles.length; i++) {
    input.signal.throwIfAborted();
    const tile = tiles[i]!;
    const image = await sharp(input.image).rotate().extract(tile.region).png().toBuffer();
    const response = await runDetection(config, { jobId: input.jobId, image, signal: input.signal });
    const meta = await sharp(response).metadata();
    if (meta.width !== tile.region.width || meta.height !== tile.region.height) throw new Error('检测蒙版尺寸与图片不一致');
    const mask = await sharp(response).greyscale().extract({
      left: tile.core.left - tile.region.left, top: tile.core.top - tile.region.top,
      width: tile.core.width, height: tile.core.height,
    }).threshold(input.threshold).png().toBuffer();
    const stats = await sharp(mask).removeAlpha().greyscale().stats();
    if ((stats.channels[0]?.max ?? 0) > 0) selectedTiles.push(tile);
    patches.push({ input: mask, left: tile.core.left, top: tile.core.top });
    input.progress((i + 1) / tiles.length);
  }
  input.signal.throwIfAborted();
  const mask = await sharp({ create: { width: input.width, height: input.height, channels: 3, background: '#000' } })
    .composite(patches).greyscale().png().toBuffer();
  return { mask, detected: selectedTiles.length > 0, selectedTiles };
}
