/** 为最近看过的缩略图保留图片元素，让浏览器有机会复用解码后的资源。 */
export class ThumbMemory {
  private entries = new Map<string, { image: HTMLImageElement; bytes: number }>();
  private byImage = new WeakMap<HTMLImageElement, string>();
  private bytes = 0;
  generation = 0;
  private limit: number;
  private maxItems: number;
  constructor(limit: number, maxItems = 512) { this.limit = limit; this.maxItems = maxItems; }

  remember(image: HTMLImageElement, generation = this.generation): void {
    if (generation !== this.generation) return;
    this.forget(image);
    const url = image.currentSrc || image.src;
    const bytes = image.naturalWidth * image.naturalHeight * 4;
    if (!url || !Number.isFinite(bytes) || bytes <= 0 || bytes > this.limit) return;
    const previous = this.entries.get(url);
    if (previous) { this.entries.delete(url); this.byImage.delete(previous.image); this.bytes -= previous.bytes; }
    this.entries.set(url, { image, bytes }); this.byImage.set(image, url); this.bytes += bytes;
    while (this.bytes > this.limit || this.entries.size > this.maxItems) {
      const first = this.entries.entries().next().value as [string, { image: HTMLImageElement; bytes: number }] | undefined;
      if (!first) break;
      this.entries.delete(first[0]); this.byImage.delete(first[1].image); this.bytes -= first[1].bytes;
    }
  }

  has(url: string): boolean {
    const entry = this.entries.get(url);
    if (!entry) return false;
    this.entries.delete(url); this.entries.set(url, entry);
    return true;
  }

  forget(image: HTMLImageElement): void {
    const url = this.byImage.get(image); if (!url) return;
    const entry = this.entries.get(url);
    if (entry?.image === image) { this.entries.delete(url); this.bytes -= entry.bytes; }
    this.byImage.delete(image);
  }

  clear(): void { this.entries.clear(); this.byImage = new WeakMap(); this.bytes = 0; this.generation++; }
}

const memoryGiB = typeof navigator === 'undefined' ? 4 : (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
export const thumbMemory = new ThumbMemory(Math.min(256, Math.max(32, memoryGiB * 32)) * 1024 * 1024);
