export type GalleryViewMode = 'home' | 'all' | 'folders' | 'favorites';
export type GallerySortOption = 'dateDesc' | 'dateAsc' | 'nameAsc' | 'nameDesc' | 'sizeDesc' | 'random';
export type GalleryFilterOption = 'all' | 'image' | 'video' | 'audio';
export type GalleryLayout = 'grid' | 'masonry' | 'timeline';

export type LocationSegmentType = 'root' | 'folders' | 'folderName';
export interface LocationSegment {
  type: LocationSegmentType;
  value?: string;
}
export interface GalleryLocationRoot {
  type: 'root';
  view: Exclude<GalleryViewMode, 'folders'>;
}

export interface GalleryLocation {
  key: string;
  view: GalleryViewMode;
  folderPath: string;
  search: string;
  sort: GallerySortOption;
  filter: GalleryFilterOption;
  layout: GalleryLayout;
  randomSeed?: string;
  mediaId?: string;
}

export interface ViewportSnapshot {
  locationKey: string;
  anchorItemId?: string;
  anchorIndex?: number;
  offsetWithinItem: number;
  fallbackScrollTop: number;
  loadedOffset: number;
  capturedAt: number;
}

/** 视口恢复是一次性命令；token 区分同一路径、同时间戳的不同 History 条目。 */
export interface ViewportRestoreCommand {
  token: number;
  entryId?: string;
  snapshot?: ViewportSnapshot;
}

export type ViewportSnapshotInput = Omit<ViewportSnapshot, 'locationKey' | 'capturedAt'>
  & Partial<Pick<ViewportSnapshot, 'locationKey' | 'capturedAt'>>;

export interface HistoryState {
  location: GalleryLocation;
  snapshot?: ViewportSnapshot;
}
