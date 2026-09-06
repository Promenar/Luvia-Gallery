// components/player/VideoPane.tsx（自 旧图片查看器源 600-631 行迁移，结构不变）
import React, { useEffect, useRef, useState } from 'react';
import { Icons } from '../ui/Icon';
import { getAuthUrl } from '../../utils/fileUtils';
import { resolveVideoSource } from './video-source';
import type { MediaItem } from '../../types';

export const VideoPane: React.FC<{ item: MediaItem; onMediaRatio?: (ratio: number) => void }> = ({ item, onMediaRatio }) => {
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const source = resolveVideoSource(item);
  useEffect(() => setVideoError(false), [item.id]);

  // hotfix-6：缓存命中兜底——视频元数据已就绪（readyState ≥ 1 且已解码）但 onLoadedMetadata
  // 错过时（如命中缓存），挂载后与每次渲染后补检一次，等价上报真实比例（同值重复上报无害）。
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !onMediaRatio) return;
    if (v.readyState >= 1 && v.videoWidth > 0 && v.videoHeight > 0) {
      onMediaRatio(v.videoWidth / v.videoHeight);
    }
  });

  if (videoError) {
    return (
      <div data-testid="video-fallback" className="flex flex-col items-center justify-center p-8 bg-gray-900 rounded-xl border border-gray-700 text-center max-w-md" onClick={(e) => e.stopPropagation()}>
        <Icons.AlertTriangle size={48} className="text-yellow-500 mb-4" />
        <h3 className="text-xl font-bold text-white mb-2">Playback Failed</h3>
        <p className="text-gray-400 text-sm mb-6">
          The video format <span className="font-mono bg-black/30 px-1 rounded">{item.type}</span> might not be supported by your browser.
        </p>
        <a href={getAuthUrl(item.url)} download className="bg-white text-gray-900 hover:bg-gray-200 px-6 py-2 rounded-full font-bold transition-colors flex items-center gap-1">
          <Icons.Download size={18} /> Download Video
        </a>
      </div>
    );
  }
  return (
    <div data-testid="video-pane" className="w-full h-full flex flex-col items-center justify-center relative group" onClick={(e) => e.stopPropagation()}>
      <video
        ref={videoRef}
        src={source.url}
        controls autoPlay
        onError={() => setVideoError(true)}
        onLoadedMetadata={() => {
          // hotfix-5：视频元数据加载后上报真实宽高比（任一边为 0 时无效，不上报），
          // 库内尺寸元数据缺失时浮窗据此把兜底形状校正为真实比例
          const v = videoRef.current;
          if (onMediaRatio && v && v.videoWidth > 0 && v.videoHeight > 0) {
            onMediaRatio(v.videoWidth / v.videoHeight);
          }
        }}
        className="max-w-full max-h-full shadow-2xl rounded-sm focus:outline-none"
      />
    </div>
  );
};
