// components/player/MediaPlayer.tsx
// 播放器壳：自旧版图片查看器组件（Task 5 已删除）迁移的 overlay、控制栏、键盘导航与左右导航按钮。
// 壳层只读展示队列当前项：不提供重命名/删除/跳转文件夹入口（文件级重命名与删除随旧查看器移除后暂停，待后续版本恢复）；
// 收藏经 props { onToggleFavorite } 注入，由 App 透传（Task 5 挂载时接线）。
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMediaPlayer } from './PlayerProvider';
import { ImageViewPane } from './ImageViewPane';
import { VideoPane } from './VideoPane';
import { Icons } from '../ui/Icon';
import type { MediaItem } from '../../types';

interface MediaPlayerProps {
    onToggleFavorite?: (item: MediaItem, type: 'file') => void;
}

export const MediaPlayer: React.FC<MediaPlayerProps> = ({ onToggleFavorite }) => {
    const { state, currentItem, close, next, prev } = useMediaPlayer();
    const [isFullScreen, setIsFullScreen] = useState(false);
    // 信息面板开合由壳层 Info 按钮驱动，面板内容（含 EXIF）在 ImageViewPane 渲染
    const [showInfo, setShowInfo] = useState(false);

    // showInfo 不跨开关周期残留：关闭时立即收起信息面板，避免重开播放器时先渲染一帧带面板的状态再收起（闪烁）。
    useEffect(() => {
        if (!state.isOpen) setShowInfo(false);
    }, [state.isOpen]);

    // 键盘导航：自 旧图片查看器源 191-220 行迁移。Esc 关闭；←→ 队列移动（reducer 在边界自动 no-op）。
    // 空格键不再由壳层处理：幻灯片开合在 ImageViewPane 内部按钮，视频播放由原生控件承接（Task 4）。
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!state.isOpen) return;
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowRight') next();
            if (e.key === 'ArrowLeft') prev();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [state.isOpen, close, next, prev]);

    // 全屏：文档级全屏为既有行为，自源 69-94 行原样迁移（后续打磨任务再升级）。
    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().then(() => {
                setIsFullScreen(true);
            }).catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen().then(() => {
                    setIsFullScreen(false);
                });
            }
        }
    };

    useEffect(() => {
        const handleFullScreenChange = () => {
            setIsFullScreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullScreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullScreenChange);
        };
    }, []);

    if (!currentItem) return null;

    return (
        <AnimatePresence>
            {/* overlay + 背景点击关闭：自源 374-383 行迁移，onClick 改为 close */}
            <motion.div
                data-testid="media-player"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center overflow-hidden"
                onClick={close}
            >
                {/* 控制栏：自 旧图片查看器源 385-479 行迁移。保留：收藏（onToggleFavorite）、信息、全屏、关闭；
                    删除：重命名、删除、跳转文件夹。幻灯片/缩放按钮随面板内部状态留在 ImageViewPane。 */}
                <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center text-white/80 z-50 pointer-events-none bg-gradient-to-b from-black/70 to-transparent">
                    <div className="flex flex-col max-w-[50%] pointer-events-auto">
                        <span className="font-medium text-lg truncate flex items-center gap-2">
                            {currentItem.name}
                        </span>
                        <span className="text-xs opacity-60 truncate">{currentItem.folderPath || 'Root'}</span>
                    </div>
                    <div className="flex items-center gap-2 pointer-events-auto">
                        {/* Favorite Button */}
                        {onToggleFavorite && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onToggleFavorite(currentItem, 'file'); }}
                                className={`p-2 rounded-full transition-colors ${currentItem.isFavorite ? 'text-red-500 hover:bg-white/10' : 'hover:bg-white/10 text-white/70'}`}
                                title="Toggle Favorite"
                            >
                                <Icons.Heart size={20} fill={currentItem.isFavorite ? "currentColor" : "none"} />
                            </button>
                        )}

                        {/* Info Button */}
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowInfo(!showInfo); }}
                            className={`p-2 rounded-full transition-colors ${showInfo ? 'bg-white/20' : 'hover:bg-white/10'}`}
                            title="File Info"
                        >
                            <Icons.Info size={20} />
                        </button>

                        <button
                            onClick={(e) => { e.stopPropagation(); toggleFullScreen(); }}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                            title={isFullScreen ? "Exit Full Screen" : "Full Screen"}
                        >
                            {isFullScreen ? <Icons.Minimize size={24} /> : <Icons.Maximize size={24} />}
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); close(); }}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                        >
                            <Icons.Close size={24} />
                        </button>
                    </div>
                </div>

                {/* 面板调度：图片/视频各自面板根节点自行 stopPropagation（迁移代码已带）；音频不渲染面板 */}
                {currentItem.mediaType === 'video' ? (
                    <VideoPane item={currentItem} />
                ) : currentItem.mediaType === 'image' ? (
                    <ImageViewPane item={currentItem} showInfo={showInfo} onSlideNext={next} />
                ) : null}

                {/* 左右导航按钮：自 旧图片查看器源 675-692 行迁移，onClick 改为 prev()/next()；
                    边界禁用：index===0 隐藏左、index===items.length-1 隐藏右（缩放隐藏逻辑随 scale 状态留在面板，见任务报告披露） */}
                {state.index > 0 && (
                    <button
                        className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-all opacity-0 hover:opacity-100 md:opacity-100 z-50 pointer-events-auto"
                        onClick={(e) => { e.stopPropagation(); prev(); }}
                    >
                        <Icons.Back size={24} />
                    </button>
                )}

                {state.index < state.items.length - 1 && (
                    <button
                        className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-all opacity-0 hover:opacity-100 md:opacity-100 rotate-180 z-50 pointer-events-auto"
                        onClick={(e) => { e.stopPropagation(); next(); }}
                    >
                        <Icons.Back size={24} />
                    </button>
                )}
            </motion.div>
        </AnimatePresence>
    );
};
