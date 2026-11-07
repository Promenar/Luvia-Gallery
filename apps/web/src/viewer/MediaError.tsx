import { FileWarning } from 'lucide-react';
import { mediaUrls, type MediaItem } from '@luvia/contracts';

/**
 * 原图不可读时的查看器内错误卡片。
 * 只解释“为什么看不到”和“还能做什么”，不遮挡顶部工具栏与信息栏。
 */
export function MediaError({ item, hint, onRetry }: { item: MediaItem; hint?: string; onRetry: () => void }) {
  return (
    <div className="lv-mediaerr" role="alert">
      <span className="lv-mediaerr-ic" aria-hidden><FileWarning /></span>
      <b>无法显示这个文件</b>
      <p>{hint || '文件可能已损坏、格式不受支持，或服务器暂时无法读取。'}</p>
      <div className="lv-mediaerr-actions">
        <button type="button" className="lv-btn" onClick={onRetry}>重试</button>
        <a className="lv-btn ghost" href={mediaUrls.download(item.id)} download>下载原图</a>
      </div>
    </div>
  );
}
