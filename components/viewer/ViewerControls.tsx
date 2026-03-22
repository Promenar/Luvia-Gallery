import React from 'react';
import { motion } from 'framer-motion';
import { Icons } from '../ui/Icon';
import { useLanguage } from '../../contexts/LanguageContext';

interface ViewerControlsProps {
  item: {
    name: string;
    folderPath?: string;
    isFavorite?: boolean;
    mediaType: string;
  };
  isFavorite: boolean;
  isPlaying: boolean;
  isFullScreen: boolean;
  transformScale: number;
  isRenaming: boolean;
  renameValue: string;
  showInfo: boolean;
  onClose: () => void;
  onToggleFavorite?: () => void;
  onStartRename?: (e: React.MouseEvent) => void;
  onTogglePlay?: () => void;
  onToggleInfo: () => void;
  onToggleFullScreen?: () => void;
  onToggleZoom?: () => void;
  onDelete?: (e: React.MouseEvent) => void;
  onJumpToFolder?: (e: React.MouseEvent) => void;
  onRenameSubmit: () => void;
  onRenameChange: (value: string) => void;
  onRenameKeyDown: (e: React.KeyboardEvent) => void;
  onRenameBlur: () => void;
  setIsRenaming: (value: boolean) => void;
}

export const ViewerControls: React.FC<ViewerControlsProps> = ({
  item,
  isFavorite,
  mediaType,
  isPlaying,
  isFullScreen,
  transformScale,
  isRenaming,
  renameValue,
  showInfo,
  onClose,
  onToggleFavorite,
  onStartRename,
  onTogglePlay,
  onToggleInfo,
  onToggleFullScreen,
  onToggleZoom,
  onDelete,
  onJumpToFolder,
  onRenameSubmit,
  onRenameChange,
  onRenameKeyDown,
  onRenameBlur,
  setIsRenaming,
}) => {
  const { t } = useLanguage();

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onRenameSubmit();
    if (e.key === 'Escape') setIsRenaming(false);
  };

  return (
    <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center text-white/80 z-50 pointer-events-none bg-gradient-to-b from-black/70 to-transparent">
      {/* 文件信息 */}
      <div className="flex flex-col max-w-[50%] pointer-events-auto">
        {isRenaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={handleRenameKeyDown}
            onBlur={onRenameBlur}
            onClick={(e) => e.stopPropagation()}
            className="bg-white/10 text-white border-b border-white outline-none p-1 rounded"
          />
        ) : (
          <span className="font-medium text-lg truncate flex items-center gap-2">
            {item.name}
            {onStartRename && (
              <button
                onClick={onStartRename}
                className="p-1 hover:bg-white/20 rounded opacity-50 hover:opacity-100"
              >
                <Icons.Edit size={14} />
              </button>
            )}
          </span>
        )}
        <span className="text-xs opacity-60 truncate">{item.folderPath || 'Root'}</span>
      </div>

      {/* 控制按钮组 */}
      <div className="flex items-center gap-2 pointer-events-auto">
        {/* 收藏按钮 */}
        {onToggleFavorite && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(); }}
            className={`p-2 rounded-full transition-colors ${
              isFavorite ? 'text-red-500 hover:bg-white/10' : 'hover:bg-white/10 text-white/70'
            }`}
            title="Toggle Favorite"
          >
            <Icons.Heart size={20} fill={isFavorite ? 'currentColor' : 'none'} />
          </button>
        )}

        {/* 信息按钮 */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleInfo(); }}
          className={`p-2 rounded-full transition-colors ${showInfo ? 'bg-white/20' : 'hover:bg-white/10'}`}
          title="File Info"
        >
          <Icons.Info size={20} />
        </button>

        {/* 跳转文件夹 */}
        {onJumpToFolder && (
          <button
            onClick={onJumpToFolder}
            className="p-2 hover:bg-white/10 rounded-full transition-colors block"
            title="Jump to Folder"
          >
            <Icons.Jump size={20} />
          </button>
        )}

        {/* 删除按钮 */}
        {onDelete && (
          <button
            onClick={onDelete}
            className="p-2 hover:bg-red-900/50 hover:text-red-400 rounded-full transition-colors mr-2"
            title="Delete File"
          >
            <Icons.Trash size={20} />
          </button>
        )}

        {/* 播放/暂停按钮 */}
        {onTogglePlay && item.mediaType === 'image' && (
          <button
            onClick={(e) => { e.stopPropagation(); onTogglePlay(); }}
            className={`p-2 rounded-full transition-colors ${
              isPlaying ? 'bg-accent-500 text-white' : 'hover:bg-white/10'
            }`}
            title={isPlaying ? 'Pause Slideshow' : 'Play Slideshow'}
          >
            {isPlaying ? <Icons.Pause size={24} /> : <Icons.Play size={24} />}
          </button>
        )}

        {/* 缩放按钮 */}
        {item.mediaType === 'image' && onToggleZoom && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleZoom(); }}
            className="p-2 hover:bg-white/10 rounded-full transition-colors hidden md:block"
            title={transformScale > 1 ? 'Zoom Out' : 'Zoom In'}
          >
            {transformScale > 1 ? <Icons.ZoomOut size={24} /> : <Icons.ZoomIn size={24} />}
          </button>
        )}

        {/* 全屏按钮 */}
        {onToggleFullScreen && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleFullScreen(); }}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
            title={isFullScreen ? 'Exit Full Screen' : 'Full Screen'}
          >
            {isFullScreen ? <Icons.Minimize size={24} /> : <Icons.Maximize size={24} />}
          </button>
        )}

        {/* 关闭按钮 */}
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="p-2 hover:bg-white/10 rounded-full transition-colors"
        >
          <Icons.Close size={24} />
        </button>
      </div>
    </div>
  );
};
