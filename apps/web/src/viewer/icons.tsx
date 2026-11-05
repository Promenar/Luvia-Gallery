import {
  ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FileText, FolderOpen, Heart, Info, Link, Minus, Pause, Play,
  Plus, Presentation, ScanSearch, Shuffle, X,
} from 'lucide-react';

const ICONS = {
  close: X, play: Play, pause: Pause, heart: Heart, download: Download, info: Info, prev: ChevronLeft, next: ChevronRight,
  shuffle: Shuffle, copy: Copy, link: Link, path: FileText, folder: FolderOpen, open: ExternalLink, hero: Presentation,
  pixels: ScanSearch, minus: Minus, plus: Plus,
} as const;

export type IconName = keyof typeof ICONS;

/** 查看器图标：播放/暂停/收藏（选中）使用实心填充，其余为线条。 */
export function Icon({ name, filled }: { name: IconName; filled?: boolean }) {
  const C = ICONS[name];
  const solid = filled || name === 'play' || name === 'pause';
  return <C aria-hidden strokeWidth={solid && name !== 'heart' ? 0 : 1.8} fill={solid ? 'currentColor' : 'none'} />;
}
