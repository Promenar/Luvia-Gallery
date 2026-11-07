import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planEditorTiles } from '../src/editor/tiles.ts';
import * as tilePlanner from '../src/editor/tiles.ts';

test('自动检测分块完整覆盖图片且边缘上下文受图片范围约束', () => {
  assert.equal(typeof (tilePlanner as Record<string, unknown>).planDetectionTiles, 'function');
  const plan = (tilePlanner as unknown as { planDetectionTiles: typeof planEditorTiles }).planDetectionTiles;
  const tiles = (plan as unknown as (w: number, h: number, core: number, context: number) => ReturnType<typeof planEditorTiles>)(2300, 1300, 1024, 128);
  assert.equal(tiles.length, 6);
  assert.deepEqual(tiles.map((tile) => [tile.core.left, tile.core.top]), [[0, 0], [1024, 0], [2048, 0], [0, 1024], [1024, 1024], [2048, 1024]]);
  assert.deepEqual(tiles[5]?.core, { left: 2048, top: 1024, width: 252, height: 276 });
  assert.deepEqual(tiles[5]?.region, { left: 1920, top: 896, width: 380, height: 404 });
  assert.equal(tiles.reduce((sum, tile) => sum + tile.core.width * tile.core.height, 0), 2300 * 1300);
});

test('只为蒙版覆盖的核心块规划带上下文的原图区域', () => {
  const mask = new Uint8Array(16 * 16);
  mask[2 * 16 + 2] = 255;
  mask[13 * 16 + 13] = 255;
  const tiles = planEditorTiles(mask, 16, 16, 1600, 1600, 400, 50);
  assert.equal(tiles.length, 2);
  assert.deepEqual(tiles.map((t) => [t.core.left, t.core.top]), [[0, 0], [1200, 1200]]);
  assert.deepEqual(tiles[0]?.region, { left: 0, top: 0, width: 450, height: 450 });
  assert.deepEqual(tiles[1]?.region, { left: 1150, top: 1150, width: 450, height: 450 });
});

test('跨块和边缘蒙版被覆盖且上下文不超出图像', () => {
  const mask = new Uint8Array(7 * 5);
  mask[2 * 7 + 2] = 255;
  mask[2 * 7 + 3] = 255;
  mask[4 * 7 + 6] = 255;
  const tiles = planEditorTiles(mask, 7, 5, 700, 500, 300, 80);
  assert.deepEqual(tiles.map((t) => [t.core.left, t.core.top]), [[0, 0], [300, 0], [600, 300]]);
  for (const tile of tiles) {
    assert.ok(tile.region.left >= 0 && tile.region.top >= 0);
    assert.ok(tile.region.left + tile.region.width <= 700);
    assert.ok(tile.region.top + tile.region.height <= 500);
  }
});

test('空蒙版没有需要推理的区域', () => {
  assert.deepEqual(planEditorTiles(new Uint8Array(4), 2, 2, 9000, 7000, 1024, 128), []);
});
