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

export interface HistoryState {
  location: GalleryLocation;
  snapshot?: ViewportSnapshot;
}
