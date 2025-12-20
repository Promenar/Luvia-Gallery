import { FolderNode, MediaItem, SortOption } from '../types';

export const generateId = (): string => {
  return Math.random().toString(36).substr(2, 9);
};

export const isVideo = (mimeType: string): boolean => {
  return mimeType.startsWith('video/');
};

export const isAudio = (mimeType: string): boolean => {
  return mimeType.startsWith('audio/');
};

export const buildFolderTree = (items: MediaItem[]): FolderNode => {
  const root: FolderNode = {
    name: 'Root',
    path: '',
    children: {},
    mediaCount: 0,
  };

  items.forEach((item) => {
    const parts = item.folderPath.split('/').filter(p => p);
    let currentNode = root;

    // Increment root count
    currentNode.mediaCount++;

    parts.forEach((part, index) => {
      if (!currentNode.children[part]) {
        const currentPath = parts.slice(0, index + 1).join('/');
        currentNode.children[part] = {
          name: part,
          path: currentPath,
          children: {},
          mediaCount: 0,
        };
      }
      currentNode = currentNode.children[part];
      currentNode.mediaCount++;

      // Set a cover photo if none exists (prefer images over videos/audio for covers)
      if (!currentNode.coverMedia || (currentNode.coverMedia.mediaType !== 'image' && item.mediaType === 'image')) {
        currentNode.coverMedia = item;
      } else if (!currentNode.coverMedia) {
        currentNode.coverMedia = item;
      }
    });
  });

  return root;
};

export const getMediaInFolder = (items: MediaItem[], folderPath: string): MediaItem[] => {
  if (!folderPath) return items;
  return items.filter(p => p.folderPath === folderPath);
};

export const getImmediateSubfolders = (root: FolderNode, currentPath: string): FolderNode[] => {
  if (!currentPath) return Object.values(root.children);

  const parts = currentPath.split('/').filter(p => p);
  let currentNode = root;

  for (const part of parts) {
    if (currentNode.children[part]) {
      currentNode = currentNode.children[part];
    } else {
      return [];
    }
  }

  return Object.values(currentNode.children);
};

// Fisher-Yates shuffle
const shuffleArray = (array: MediaItem[]): MediaItem[] => {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

export const sortMedia = (items: MediaItem[], sortOption: SortOption): MediaItem[] => {
  const sorted = [...items];
  switch (sortOption) {
    case 'dateDesc':
      return sorted.sort((a, b) => b.lastModified - a.lastModified);
    case 'dateAsc':
      return sorted.sort((a, b) => a.lastModified - b.lastModified);
    case 'nameAsc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'nameDesc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case 'sizeDesc':
      return sorted.sort((a, b) => b.size - a.size);
    case 'random':
      return shuffleArray(sorted);
    default:
      return sorted;
  }
};

export const groupMediaByDate = (items: MediaItem[]): Record<string, MediaItem[]> => {
  const groups: Record<string, MediaItem[]> = {};

  // Filter out items without lastModified to prevent crashes
  const validItems = items.filter(item => item && item.lastModified);

  // Sort by date descending first to ensure groups are in order if iterated
  const sorted = [...validItems].sort((a, b) => b.lastModified - a.lastModified);

  sorted.forEach(item => {
    const date = new Date(item.lastModified);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(item);
  });

  return groups;
};

export const getAuthUrl = (url: string): string => {
  if (!url) return '';
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  const token = localStorage.getItem('lumina_token');
  if (!token) return url;
  if (url.includes('token=')) return url; // Prevent double token
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}token=${token}`;
};