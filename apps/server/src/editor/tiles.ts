type Rect = { left: number; top: number; width: number; height: number };
export type EditorTile = { core: Rect; region: Rect };

/** 自动检测尚无蒙版，逐块覆盖整张方向校正后的图片。 */
export function planDetectionTiles(width: number, height: number, coreEdge = 1024, context = 128): EditorTile[] {
  if (![width, height, coreEdge, context].every(Number.isInteger) || Math.min(width, height, coreEdge) <= 0 || context < 0) {
    throw new Error('图片尺寸或分块参数无效');
  }
  const tiles: EditorTile[] = [];
  for (let top = 0; top < height; top += coreEdge) {
    for (let left = 0; left < width; left += coreEdge) {
      const right = Math.min(width, left + coreEdge);
      const bottom = Math.min(height, top + coreEdge);
      const regionLeft = Math.max(0, left - context);
      const regionTop = Math.max(0, top - context);
      tiles.push({
        core: { left, top, width: right - left, height: bottom - top },
        region: { left: regionLeft, top: regionTop, width: Math.min(width, right + context) - regionLeft,
          height: Math.min(height, bottom + context) - regionTop },
      });
    }
  }
  return tiles;
}

/** 仅规划被蒙版覆盖的核心块；输入蒙版与输出坐标均为方向校正后的空间。 */
export function planEditorTiles(mask: Uint8Array, maskWidth: number, maskHeight: number,
  width: number, height: number, coreEdge = 1024, context = 128): EditorTile[] {
  if (mask.length !== maskWidth * maskHeight || Math.min(maskWidth, maskHeight, width, height, coreEdge) <= 0 || context < 0) {
    throw new Error('蒙版尺寸或分块参数无效');
  }
  const columns = Math.ceil(width / coreEdge);
  const selected = new Set<number>();
  for (let y = 0; y < maskHeight; y++) {
    for (let x = 0; x < maskWidth; x++) {
      if (!mask[y * maskWidth + x]) continue;
      const x0 = Math.floor((x * width / maskWidth) / coreEdge);
      const x1 = Math.floor((Math.ceil((x + 1) * width / maskWidth) - 1) / coreEdge);
      const y0 = Math.floor((y * height / maskHeight) / coreEdge);
      const y1 = Math.floor((Math.ceil((y + 1) * height / maskHeight) - 1) / coreEdge);
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) selected.add(cy * columns + cx);
    }
  }
  return [...selected].sort((a, b) => a - b).map((index) => {
    const left = (index % columns) * coreEdge;
    const top = Math.floor(index / columns) * coreEdge;
    const right = Math.min(width, left + coreEdge);
    const bottom = Math.min(height, top + coreEdge);
    const regionLeft = Math.max(0, left - context);
    const regionTop = Math.max(0, top - context);
    return {
      core: { left, top, width: right - left, height: bottom - top },
      region: { left: regionLeft, top: regionTop, width: Math.min(width, right + context) - regionLeft,
        height: Math.min(height, bottom + context) - regionTop },
    };
  });
}
