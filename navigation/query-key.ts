import { ViewMode, SortOption, FilterOption, GridLayout } from '../types';

export type GalleryQueryKeyInput = {
  username: string;
  view: ViewMode;
  folderPath: string;
  search: string;
  sort: SortOption;
  filter?: FilterOption;
  randomSeed: number;
  layout?: GridLayout;
  mediaId?: string;
};

export type GalleryQueryKey = readonly [
  string,
  string,
  ViewMode,
  string,
  string,
  SortOption,
  FilterOption,
  number
];

const normalizeFolderPath = (folderPath: string): string => {
  return folderPath
    .trim()
    .replace(/\\+/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('/');
};

const normalizeSearch = (search: string): string => {
  return search.trim();
};

export const createGalleryQueryKey = (input: GalleryQueryKeyInput): GalleryQueryKey => {
  return [
    'galleryFiles',
    input.username,
    input.view,
    normalizeFolderPath(input.folderPath),
    normalizeSearch(input.search),
    input.sort,
    input.filter ?? 'all',
    input.randomSeed,
  ] as const;
};
