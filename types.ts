import 'react';

// Extend React HTML attributes to support webkitdirectory
declare module 'react' {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

export type MediaType = 'image' | 'video';

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
    sources: {id: string, name: string, count: number}[];
}

// The serializable configuration structure
export interface AppConfig {
  title: string;
  users: User[];
  // We only store source metadata, not the file blobs themselves due to browser security
  userSources: Record<string, {id: string, name: string, count: number}[]>; 
  // List of relative paths within MEDIA_ROOT to scan
  libraryPaths?: string[];
  lastModified: number;
}

export type ViewMode = 'all' | 'folders';
export type GridLayout = 'grid' | 'masonry';
export type SortOption = 'dateDesc' | 'dateAsc' | 'nameAsc' | 'nameDesc' | 'sizeDesc';
export type FilterOption = 'all' | 'image' | 'video';