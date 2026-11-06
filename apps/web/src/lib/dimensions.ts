import { useEffect, useSyncExternalStore } from 'react';
import { call } from './api';
import { addDimensions, dimensionsVersion, knownDimensions, subscribeDimensions } from './dimension-cache';

/**
 * 正在显示但缺少宽高的媒体：网格格子挂载时登记、卸载时注销。
 * 有登记项时每 2 秒向服务器询问一次——已读到的宽高立即补上，其余提到后台读取队首。
 */
const wanted = new Map<string, number>();
const FIRST_DELAY = 400;
const INTERVAL = 2000;
const MAX_IDS = 200;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;

function schedule(delay: number) {
  if (timer || inFlight || !wanted.size) return;
  timer = setTimeout(() => { timer = null; void poll(); }, delay);
}

async function poll() {
  // 最近登记的格子最可能还在视口内
  const ids = [...wanted.keys()].slice(-MAX_IDS);
  if (!ids.length) return;
  inFlight = true;
  try {
    const result = await call('mediaDimensions', { body: { ids } });
    for (const it of result.items) wanted.delete(it.id);
    addDimensions(result.items);
  } catch { /* 下一轮重试 */ }
  finally { inFlight = false; }
  schedule(INTERVAL);
}

/** 格子显示期间若缺少宽高，登记为需要优先读取。 */
export function useWantDimensions(item: { id: string; width: number | null; height: number | null }) {
  const missing = !item.width || !item.height;
  useEffect(() => {
    if (!missing || knownDimensions(item.id)) return;
    const id = item.id;
    wanted.set(id, (wanted.get(id) ?? 0) + 1);
    schedule(FIRST_DELAY);
    return () => {
      const n = (wanted.get(id) ?? 1) - 1;
      if (n > 0) wanted.set(id, n); else wanted.delete(id);
    };
  }, [item.id, missing]);
}

/** 补到新宽高时变化，排布据此重新计算。 */
export function useDimensionsVersion() { return useSyncExternalStore(subscribeDimensions, dimensionsVersion, dimensionsVersion); }
