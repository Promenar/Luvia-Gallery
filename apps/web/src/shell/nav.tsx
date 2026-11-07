import { Album, Brush, Folder, Gauge, Heart, History, Image, Palette, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: '/' | '/photos' | '/folders' | '/albums' | '/favorites' | '/editor' | '/admin';
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: '回忆', icon: History },
  { to: '/photos', label: '照片', icon: Image },
  { to: '/folders', label: '文件夹', icon: Folder },
  { to: '/albums', label: '相册', icon: Album },
  { to: '/favorites', label: '收藏', icon: Heart },
];
export const EDITOR_NAV: NavItem = { to: '/editor', label: '修复', icon: Brush, adminOnly: true };
export const ADMIN_NAV: NavItem = { to: '/admin', label: '控制台', icon: Gauge, adminOnly: true };
export const AppearanceIcon = Palette;
