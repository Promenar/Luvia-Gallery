import type { GalleryLayout, GalleryViewMode } from './types';
import { getAvailableLayouts } from './location';

export interface LayoutPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GalleryLayoutPreferenceScope {
  serverId: string;
  userId: string;
  view: GalleryViewMode;
}

export const LAYOUT_PREFERENCE_PREFIX = 'luvia.gallery.layout-preference.v1';
export const LEGACY_LAYOUT_PREFERENCE_KEY = 'luvia_layout_mode';

export const getLayoutPreferenceView = (view: GalleryViewMode): 'all' | 'favorites' | 'folders' | undefined =>
  view === 'all' || view === 'favorites' || view === 'folders' ? view : undefined;

/** 旧全局偏好只迁移网格与瀑布流（当年的时间线入口不具备百万级能力，不再沿用）。 */
export const normalizeAvailableLayout = (layout: string | null | undefined): Extract<GalleryLayout, 'grid' | 'masonry'> | undefined =>
  layout === 'grid' || layout === 'masonry' ? layout : undefined;

/** 按视图规范化作用域偏好：时间线只在全部照片与收藏夹可用。 */
export const normalizeScopedLayout = (layout: string | null | undefined, view: GalleryViewMode): GalleryLayout | undefined =>
  getAvailableLayouts(view).includes(layout as GalleryLayout) ? layout as GalleryLayout : undefined;

export const createGalleryLayoutPreferenceKey = (scope: GalleryLayoutPreferenceScope): string | undefined => {
  const view = getLayoutPreferenceView(scope.view);
  if (!scope.serverId || !scope.userId || !view) return undefined;
  return `${LAYOUT_PREFERENCE_PREFIX}:${encodeURIComponent(scope.serverId)}:${encodeURIComponent(scope.userId)}:${view}`;
};

export const readGalleryLayoutPreference = (storage: LayoutPreferenceStorage | undefined, scope: GalleryLayoutPreferenceScope): GalleryLayout | undefined => {
  const key = createGalleryLayoutPreferenceKey(scope);
  if (!storage || !key) return undefined;
  try {
    return normalizeScopedLayout(storage.getItem(key), scope.view);
  } catch {
    return undefined;
  }
};

export const resolveGalleryLayoutPreference = (storage: LayoutPreferenceStorage | undefined, scope: GalleryLayoutPreferenceScope): GalleryLayout | undefined => {
  const key = createGalleryLayoutPreferenceKey(scope);
  if (!storage || !key) return undefined;
  const scopedPreference = readGalleryLayoutPreference(storage, scope);
  try {
    const legacyPreference = normalizeAvailableLayout(storage.getItem(LEGACY_LAYOUT_PREFERENCE_KEY));
    // 旧全局值不能跨用户持续生效；无论合法与否都在首次检查后消费掉。
    storage.removeItem(LEGACY_LAYOUT_PREFERENCE_KEY);
    if (scopedPreference) return scopedPreference;
    if (!legacyPreference) return undefined;
    storage.setItem(key, legacyPreference);
    return legacyPreference;
  } catch {
    return undefined;
  }
};

export const writeGalleryLayoutPreference = (storage: LayoutPreferenceStorage | undefined, scope: GalleryLayoutPreferenceScope, layout: GalleryLayout): void => {
  const key = createGalleryLayoutPreferenceKey(scope);
  const normalizedLayout = normalizeScopedLayout(layout, scope.view);
  if (!storage || !key || !normalizedLayout) return;
  try {
    storage.setItem(key, normalizedLayout);
  } catch {
    // 隐私模式或受限存储下仅保留本次导航位置，不影响图库可用性。
  }
};
