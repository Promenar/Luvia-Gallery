import { createElement } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { MediaItem } from '@luvia/contracts';
import { Thumb } from './Thumb';
import { thumbMemory } from './thumb-memory';
import { rgbaToThumbHash } from 'thumbhash';
import { thumbhashUrl } from './Thumb';

vi.mock('@/lib/dimensions', () => ({ useWantDimensions: () => {} }));
const item = { id: 'photo', name: '照片', mediaType: 'image', thumbVersion: 1, thumbhash: null, width: 600, height: 400 } as MediaItem;
const ready = (image: HTMLImageElement) => {
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 200 });
  Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 200 });
};
afterEach(() => { cleanup(); thumbMemory.clear(); });

it('相同媒体的新占位图不会复用旧 ThumbHash', () => {
  const hash = (r: number, g: number, b: number) => btoa(String.fromCharCode(...rgbaToThumbHash(2, 2,
    Uint8Array.from([r, g, b, 255, r, g, b, 255, r, g, b, 255, r, g, b, 255]))));
  const first = thumbhashUrl({ id: 'unchanged', thumbhash: hash(220, 30, 40) });
  const second = thumbhashUrl({ id: 'unchanged', thumbhash: hash(20, 80, 220) });
  expect(first).toBeTruthy();
  expect(second).toBeTruthy();
  expect(second).not.toEqual(first);
});

it('尺寸或版本变化时替换图片节点，未完成加载的新图不会污染旧缓存', () => {
  const view = render(createElement(Thumb, { item, width: 200, height: 200 }));
  const first = view.container.querySelector('img')!; ready(first); fireEvent.load(first);
  expect(thumbMemory.has(first.src)).toBe(true);
  view.rerender(createElement(Thumb, { item: { ...item, thumbVersion: 2 }, width: 200, height: 200 }));
  const second = view.container.querySelector('img')!; expect(second).not.toBe(first);
  view.unmount(); ready(second); fireEvent.load(second);
  expect(thumbMemory.has(first.src)).toBe(true); expect(thumbMemory.has(second.src)).toBe(false);
});

it('会话缓存清理之前发起的加载完成后不重新加入', () => {
  const view = render(createElement(Thumb, { item, width: 200, height: 200 }));
  const image = view.container.querySelector('img')!; ready(image); thumbMemory.clear(); fireEvent.load(image);
  expect(thumbMemory.has(image.src)).toBe(false);
});
