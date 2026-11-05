/**
 * 剪贴板与下载辅助。查看器是模态对话框（顶层、页面其余部分惰性），
 * 因此临时元素都挂在传入的容器（对话框）内部。
 */

/** iOS Safari 画布面积上限约 16.7M 像素，超过时等比缩小。 */
const MAX_CANVAS_AREA = 16_777_216;

export const CLIPBOARD_HINT_INSECURE =
  '用局域网 IP 通过 http 访问时，浏览器不允许网页写入剪贴板。改用 HTTPS 访问，或按住 Shift 右键，用浏览器自带的“复制图像”';
export const CLIPBOARD_HINT_DENIED =
  '浏览器拒绝了剪贴板权限。可以在地址栏的网站设置里允许，或按住 Shift 右键，用浏览器自带的“复制图像”';

export const clipboardFailMessage = () => (window.isSecureContext ? CLIPBOARD_HINT_DENIED : CLIPBOARD_HINT_INSECURE);

export function canWriteImage(): boolean {
  return window.isSecureContext && typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';
}

function drawToPng(source: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const k = w * h > MAX_CANVAS_AREA ? Math.sqrt(MAX_CANVAS_AREA / (w * h)) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(w * k));
  canvas.height = Math.max(1, Math.floor(h * k));
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('无法创建画布'));
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('无法生成 PNG'))), 'image/png'));
}

async function pngFromUrl(url: string): Promise<Blob> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return drawToPng(img, img.naturalWidth || 1, img.naturalHeight || 1);
}

/**
 * 把图片（display 全分辨率 URL）或视频当前画面以 PNG 写入剪贴板。
 * Blob 以 Promise 形式交给 ClipboardItem，保证 write() 在用户手势内同步调用（Safari 要求）。
 */
export async function copyImageToClipboard(source: string | HTMLVideoElement): Promise<void> {
  if (!canWriteImage()) throw new Error('insecure');
  const blob = typeof source === 'string'
    ? pngFromUrl(source)
    : drawToPng(source, source.videoWidth || 1, source.videoHeight || 1);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** 写入文本：安全上下文用异步剪贴板，否则退回 execCommand（在 http 局域网访问时仍可用）。 */
export async function copyTextToClipboard(text: string, container: HTMLElement | null): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* 继续尝试回退方案 */
    }
  }
  const host = container ?? document.body;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  host.appendChild(ta);
  const prev = document.activeElement as HTMLElement | null;
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  prev?.focus?.({ preventScroll: true });
  return ok;
}

/** 通过临时链接触发下载（同源，Cookie 鉴权）。 */
export function triggerDownload(url: string, container: HTMLElement | null) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  a.rel = 'noopener';
  (container ?? document.body).appendChild(a);
  a.click();
  a.remove();
}
