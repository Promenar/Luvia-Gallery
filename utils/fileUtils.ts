import { FolderNode, MediaItem, SortOption } from '../types';

export const generateId = (): string => {
  return Math.random().toString(36).substr(2, 9);
};

export const isVideo = (mimeType: string): boolean => {
  return mimeType.startsWith('video/');
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
      
      // Set a cover photo if none exists (prefer images over videos for covers)
      if (!currentNode.coverMedia || (currentNode.coverMedia.mediaType === 'video' && item.mediaType === 'image')) {
        currentNode.coverMedia = item;
      }
    });
    
    // Update root count
    root.mediaCount++;
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
    default:
      return sorted;
  }
};
