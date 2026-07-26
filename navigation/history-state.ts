import { type GalleryLocation, type ViewportSnapshot } from './types';
import { buildNormalizedGalleryLocation } from './location';

export interface GalleryHistoryState {
  location: GalleryLocation;
  snapshot?: ViewportSnapshot;
  path?: string;
}

export const createHistoryState = (
  location: GalleryLocation,
  snapshot?: Omit<ViewportSnapshot, 'locationKey'>
): GalleryHistoryState => {
  const normalizedLocation = buildNormalizedGalleryLocation(location);

  if (snapshot) {
    const normalizedSnapshot: ViewportSnapshot = {
      ...snapshot,
      locationKey: normalizedLocation.key,
    };
    return {
      path: normalizedLocation.folderPath,
      location: normalizedLocation,
      snapshot: normalizedSnapshot,
    };
  }

  return {
    path: normalizedLocation.folderPath,
    location: normalizedLocation,
  };
};
