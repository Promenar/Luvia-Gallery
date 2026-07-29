export const MEDIA_HOVER_ZOOM_STORAGE_KEY = 'luvia_media_hover_zoom';

export type MediaHoverZoomStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const readMediaHoverZoomPreference = (storage?: MediaHoverZoomStorage): boolean => {
  if (!storage) return true;
  try {
    const stored = storage.getItem(MEDIA_HOVER_ZOOM_STORAGE_KEY);
    if (stored === 'false') return false;
    if (stored === 'true') return true;
  } catch {
    // 存储不可用时保持向后兼容的默认缩放行为。
  }
  return true;
};

export const writeMediaHoverZoomPreference = (
  storage: MediaHoverZoomStorage | undefined,
  enabled: boolean,
): void => {
  try {
    storage?.setItem(MEDIA_HOVER_ZOOM_STORAGE_KEY, String(enabled));
  } catch {
    // 写入失败不应影响当前会话中的设置状态。
  }
};
