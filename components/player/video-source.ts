// components/player/video-source.ts
import type { MediaItem } from '../../types';
import { getAuthUrl } from '../../utils/fileUtils';

export type VideoSource = { kind: 'native'; url: string };

/** 视频播放源唯一解析点：阶段四服务端转码只需扩展此函数（探测+转码 URL 回退）。 */
export const resolveVideoSource = (item: MediaItem): VideoSource => ({
  kind: 'native',
  url: getAuthUrl(item.url),
});
