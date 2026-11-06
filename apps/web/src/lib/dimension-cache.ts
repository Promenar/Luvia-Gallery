/**
 * 页面打开后才读到的媒体宽高（后台拍摄信息读取完成后由 dimensions.ts 拉取）。
 * 已加载的列表项不重新请求，排布时用这里的宽高补上缺失值。
 */
const known = new Map<string, { width: number; height: number }>();
let version = 0;
const listeners = new Set<() => void>();

export function knownDimensions(id: string) { return known.get(id); }

export function addDimensions(items: readonly { id: string; width: number; height: number }[]) {
  if (!items.length) return;
  for (const it of items) known.set(it.id, { width: it.width, height: it.height });
  version++;
  listeners.forEach((l) => l());
}

export function subscribeDimensions(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function dimensionsVersion() { return version; }
