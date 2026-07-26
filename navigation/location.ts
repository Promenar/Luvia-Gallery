import {
  type GalleryFilterOption,
  type GalleryLayout,
  type GalleryLocation,
  type GallerySortOption,
  type GalleryViewMode,
} from './types';

export const DEFAULT_VIEW: GalleryViewMode = 'all';
export const DEFAULT_SORT: GallerySortOption = 'dateDesc';
export const DEFAULT_FILTER: GalleryFilterOption = 'all';
export const DEFAULT_LAYOUT: GalleryLayout = 'grid';

const SEARCH_PARAMS = {
  VIEW: 'view',
  FOLDER: 'folder',
  SEARCH: 'q',
  SORT: 'sort',
  FILTER: 'filter',
  LAYOUT: 'layout',
  RANDOM_SEED: 'randomSeed',
  MEDIA_ID: 'mediaId',
} as const;

const hashToken = (value: string) => encodeURIComponent(value);
const safeDecodeToken = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isGalleryViewMode = (value: string | null): value is GalleryViewMode =>
  value === 'home' || value === 'all' || value === 'folders' || value === 'favorites';

const isGallerySortOption = (value: string | null): value is GallerySortOption =>
  value === 'dateDesc' || value === 'dateAsc' || value === 'nameAsc' || value === 'nameDesc' || value === 'sizeDesc' || value === 'random';

const isGalleryFilterOption = (value: string | null): value is GalleryFilterOption =>
  value === 'all' || value === 'image' || value === 'video' || value === 'audio';

const isGalleryLayout = (value: string | null): value is GalleryLayout =>
  value === 'grid' || value === 'masonry' || value === 'timeline';

const normalizeFolderPath = (raw: string): string => {
  if (!raw) return '';
  const normalizedSlashes = raw.replace(/\\\\/g, '/').replace(/\\/g, '/');
  const hasLeadingSlash = normalizedSlashes.startsWith('/');
  const hasWindowsDrive = /^[a-zA-Z]:/.test(normalizedSlashes);
  const parts = normalizedSlashes
    .split('/')
    .filter((part) => part && part !== '.')
    .map((part) => part);

  const normalizedParts: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      if (normalizedParts.length > 0 && normalizedParts[0] !== '..') {
        normalizedParts.pop();
      } else {
        normalizedParts.push(part);
      }
      continue;
    }
    normalizedParts.push(part);
  }

  if (!normalizedParts.length) {
    return hasLeadingSlash && !hasWindowsDrive ? '/' : '';
  }

  if (hasWindowsDrive) {
    return normalizedParts.join('/');
  }

  return hasLeadingSlash ? `/${normalizedParts.join('/')}` : normalizedParts.join('/');
};

export const getParentFolderPath = (folderPath: string): string => {
  const normalized = normalizeFolderPath(folderPath);
  if (!normalized) return '';

  const hasWindowsDrive = /^[a-zA-Z]:/.test(normalized);
  const isRootPath = normalized === '/';

  if (isRootPath) return '';

  const segments = normalized.split('/');
  if (segments.length <= 1) return '';

  if (hasWindowsDrive && segments.length === 2 && /^[a-zA-Z]:$/.test(segments[0])) {
    return '';
  }

  return segments.slice(0, -1).join('/');
};

export const createLocationKey = (location: GalleryLocation): string => {
  const normalizedPath = normalizeFolderPath(location.folderPath);
  const components = [
    `view=${location.view}`,
    `folder=${normalizedPath || '/'}`,
    `search=${location.search || ''}`,
    `sort=${location.sort}`,
    `filter=${location.filter}`,
    `layout=${location.layout}`,
    `seed=${location.randomSeed ?? ''}`,
    `media=${location.mediaId ?? ''}`,
  ];

  return components.map((value) => hashToken(value)).join('|');
};

const parseParams = (input: string): URLSearchParams => {
  const query = input.startsWith('?') ? input.slice(1) : input;
  try {
    return new URLSearchParams(query);
  } catch {
    const fallback = new URLSearchParams();
    for (const pair of query.split('&')) {
      if (!pair) continue;
      const [rawKey, ...rest] = pair.split('=');
      const rawValue = rest.join('=');
      fallback.set(safeDecodeToken(rawKey), safeDecodeToken(rawValue));
    }
    return fallback;
  }
};

const buildParams = (location: GalleryLocation): URLSearchParams => {
  const params = new URLSearchParams();
  if (location.view !== DEFAULT_VIEW) params.set(SEARCH_PARAMS.VIEW, location.view);
  if (location.search) params.set(SEARCH_PARAMS.SEARCH, location.search);
  if (location.sort !== DEFAULT_SORT) params.set(SEARCH_PARAMS.SORT, location.sort);
  if (location.filter !== DEFAULT_FILTER) params.set(SEARCH_PARAMS.FILTER, location.filter);
  if (location.layout !== DEFAULT_LAYOUT) params.set(SEARCH_PARAMS.LAYOUT, location.layout);
  if (location.randomSeed) params.set(SEARCH_PARAMS.RANDOM_SEED, location.randomSeed);
  if (location.mediaId) params.set(SEARCH_PARAMS.MEDIA_ID, location.mediaId);
  return params;
};

export const parseGalleryUrl = (input: string): GalleryLocation => {
  let location: GalleryLocation = {
    key: '',
    view: DEFAULT_VIEW,
    folderPath: '',
    search: '',
    sort: DEFAULT_SORT,
    filter: DEFAULT_FILTER,
    layout: DEFAULT_LAYOUT,
  };

  const hashIndex = input.indexOf('#');
  const hash = hashIndex >= 0 ? input.slice(hashIndex + 1) : input;
  let params = parseParams(hash.includes('?') ? hash.split('?').pop() ?? '' : hash);

  if (hash.startsWith('folder=')) {
    params = parseParams(hash);
  }

  const folderInHash = params.get(SEARCH_PARAMS.FOLDER);
  if (folderInHash !== null) {
    location = {
      ...location,
      folderPath: normalizeFolderPath(folderInHash),
      view: 'folders',
    };
  }

  const view = params.get(SEARCH_PARAMS.VIEW);
  if (isGalleryViewMode(view)) {
    location.view = view;
  } else if (!folderInHash && location.folderPath) {
    location.view = 'folders';
  }

  const search = params.get(SEARCH_PARAMS.SEARCH);
  if (search !== null) {
    location.search = search;
  }

  const sort = params.get(SEARCH_PARAMS.SORT);
  if (isGallerySortOption(sort)) {
    location.sort = sort;
  }

  const filter = params.get(SEARCH_PARAMS.FILTER);
  if (isGalleryFilterOption(filter)) {
    location.filter = filter;
  }

  const layout = params.get(SEARCH_PARAMS.LAYOUT);
  if (isGalleryLayout(layout)) {
    location.layout = layout;
  }

  const randomSeed = params.get(SEARCH_PARAMS.RANDOM_SEED);
  if (randomSeed) {
    location.randomSeed = randomSeed;
  }

  const mediaId = params.get(SEARCH_PARAMS.MEDIA_ID);
  if (mediaId) {
    location.mediaId = mediaId;
  }

  location.key = createLocationKey(location);
  return location;
}

export const serializeGalleryUrl = (location: GalleryLocation): string => {
  const normalized = {
    ...location,
    folderPath: normalizeFolderPath(location.folderPath),
  };
  const params = buildParams(normalized);
  const pathParam = normalized.folderPath ? `folder=${hashToken(normalized.folderPath)}` : '';
  const query = params.toString();
  const parts = [pathParam, query].filter(Boolean);
  return `#${parts.join('&')}`;
};
