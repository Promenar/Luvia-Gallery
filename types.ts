
import React from 'react';

export type MediaType = 'image' | 'video' | 'audio';

export interface MediaItem {
  id: string;
  file?: File;      // Optional because it might be missing after config load
  url: string;      // Blob URL (session only) or empty
  name: string;
  path: string;       // Full relative path: "Vacation/2023/beach.jpg"
  folderPath: string; // Directory path: "Vacation/2023"
  size: number;
  type: string;       // MIME type
  lastModified: number;
  mediaType: MediaType;
  sourceId: string;   // To identify which "import" this came from
  isFavorite?: boolean; // New: Favorite status
}

export interface ExifData {
  Make?: string;
  Model?: string;
  ExposureTime?: number;
  FNumber?: number;
  ISO?: number;
  FocalLength?: number;
  LensModel?: string;
  DateTimeOriginal?: Date;
  width?: number;
  height?: number;
}

export interface FolderNode {
  name: string;
  path: string;
  children: Record<string, FolderNode>;
  mediaCount: number;
  coverMedia?: MediaItem;
}

export interface User {
  username: string;
  password: string; // In a real app, this should be hashed. Here we use plain text for demo mock.
  isAdmin: boolean;
  avatar?: string;
}

// New interface for per-user data persistence
export interface UserData {
  files: MediaItem[];
  sources: { id: string, name: string, count: number }[];
  favoriteFolderPaths?: string[]; // New: Persist favorite folders in client mode
}

export interface HomeScreenConfig {
  mode: 'random' | 'folder' | 'single';
  path?: string; // Used for folder or single file mode
}

// The serializable configuration structure
export interface AppConfig {
  title: string;
  homeSubtitle?: string;
  homeScreen?: HomeScreenConfig;
  users: User[];
  // We only store source metadata, not the file blobs themselves due to browser security
  userSources: Record<string, { id: string, name: string, count: number }[]>;
  // List of relative paths within MEDIA_ROOT to scan
  libraryPaths?: string[];
  lastModified: number;
}

export interface SystemStatus {
  ffmpeg: boolean;
  ffmpegHwAccels: string[];
  sharp: boolean;
  imageProcessor?: string;
  cacheCount: number;
  totalItems: number;
  mediaBreakdown: {
    image: number;
    video: number;
    audio: number;
  };
  platform: string;
}

export type ViewMode = 'home' | 'all' | 'folders' | 'favorites';
export type GridLayout = 'grid' | 'masonry' | 'timeline';
export type SortOption = 'dateDesc' | 'dateAsc' | 'nameAsc' | 'nameDesc' | 'sizeDesc' | 'random';
export type FilterOption = 'all' | 'image' | 'video' | 'audio';
