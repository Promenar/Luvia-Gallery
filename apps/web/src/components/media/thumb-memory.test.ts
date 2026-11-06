import { describe, expect, it } from 'vitest';
import { ThumbMemory } from './thumb-memory';

const image = (url: string, width = 5, height = 2) => ({ currentSrc: url, src: url, naturalWidth: width, naturalHeight: height }) as HTMLImageElement;

describe('缩略图内存保留', () => {
  it('按估计解码内存淘汰最久未使用的图片', () => {
    const cache = new ThumbMemory(80);
    cache.remember(image('a')); cache.remember(image('b'));
    expect(cache.has('a')).toBe(true);
    cache.remember(image('c'));
    expect(cache.has('b')).toBe(false); expect(cache.has('a')).toBe(true); expect(cache.has('c')).toBe(true);
  });
  it('忽略无法解码和超出预算的图片，并可清除会话缓存', () => {
    const cache = new ThumbMemory(80, 1);
    cache.remember(image('empty', 0)); cache.remember(image('large', 100));
    expect(cache.has('empty')).toBe(false); expect(cache.has('large')).toBe(false);
    cache.remember(image('a')); cache.remember(image('b'));
    expect(cache.has('a')).toBe(false); cache.clear(); expect(cache.has('b')).toBe(false);
  });
  it('复用同一图片元素切换地址时移除旧预算，超大新图不会被保留', () => {
    const cache = new ThumbMemory(80);
    const mutable = image('small'); cache.remember(mutable);
    Object.assign(mutable, { currentSrc: 'large', src: 'large', naturalWidth: 100 }); cache.remember(mutable);
    expect(cache.has('small')).toBe(false); expect(cache.has('large')).toBe(false);
  });
  it('清理之前开始加载的图片，完成后不能再次进入缓存', () => {
    const cache = new ThumbMemory(80); const generation = cache.generation;
    cache.clear(); cache.remember(image('late'), generation);
    expect(cache.has('late')).toBe(false);
  });
});
