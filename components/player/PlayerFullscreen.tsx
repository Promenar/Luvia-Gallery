// components/player/PlayerFullscreen.tsx
// Task D：独占全屏形态（displayMode==='fullscreen' 分支，由 MediaPlayer 壳层调度）。
// - 布局：迁移旧 MediaPlayer 全屏遮罩样式——fixed inset-0 z-50 bg-black/95 + 顶部控制栏
//   （收藏/信息/全屏退出/关闭）+ 左右导航（队列边界隐藏）+ 壳层下传的信息面板节点。
// - 宿主全屏 effect：挂载即在容器 ref 上 requestFullscreen（可选链 + catch：jsdom 等
//   无 Fullscreen API 环境短路 no-op，浏览器拒绝时静默降级为纯 CSS 全屏遮罩）；
//   监听 fullscreenchange——fullscreenElement 已空且仍处全屏形态（含用户 Esc 退出浏览器
//   原生全屏）时回 window 形态。监听器只挂一次，setMode/displayMode 经 ref 间接消费，
//   不随 context value 重建反复挂卸。
// - 退出路径：退出按钮与兜底 Esc 直接 setMode('window')（jsdom 无 exitFullscreen 也保证
//   UI 回落）；卸载清理时若仍处原生全屏则主动 exitFullscreen 归还，避免"UI 已回浮窗但
//   浏览器还独占全屏"的残留。
// - 全屏形态内 Esc 不关闭播放器（与 window 形态差异由 MediaPlayer 键盘分支区分）：
//   原生全屏激活时交给浏览器退出全屏，兜底场景由壳层 Esc 分支回 window。
// - video 在 window→fullscreen 间允许重挂（计划已接受，阶段三再做 keep-alive）。
import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMediaPlayer } from './PlayerProvider';
import { ImageViewPane } from './ImageViewPane';
import { VideoPane } from './VideoPane';
import { Icons } from '../ui/Icon';
import type { MediaItem } from '../../types';

interface PlayerFullscreenProps {
    /** 收藏回调：由 App 透传（控制栏按钮直接调用） */
    onToggleFavorite?: (item: MediaItem, type: 'file') => void;
    /** 信息面板开合状态（状态与 EXIF 拉取由 MediaPlayer 壳层持有，本组件只渲染开关按钮） */
    showInfo: boolean;
    onToggleInfo: () => void;
    /** 信息面板节点（MediaPlayer 壳层构建，absolute 定位相对本全屏容器） */
    infoPanel?: React.ReactNode;
}

export const PlayerFullscreen: React.FC<PlayerFullscreenProps> = ({ onToggleFavorite, showInfo, onToggleInfo, infoPanel }) => {
    const { state, currentItem, close, next, prev, displayMode, setMode } = useMediaPlayer();
    const containerRef = useRef<HTMLDivElement>(null);

    // setMode/displayMode 经 ref 间接消费：fullscreenchange 监听器只挂一次，
    // 避免 context value 随 state 重建导致监听器反复挂卸（与 PlayerWindow 同模式）
    const setModeRef = useRef(setMode);
    const displayModeRef = useRef(displayMode);
    useEffect(() => {
        setModeRef.current = setMode;
        displayModeRef.current = displayMode;
    });

    // 宿主全屏 effect：挂载即请求容器原生全屏。requestFullscreen 可选调用 + catch：
    // jsdom 等无此 API 的环境可选链短路返回 undefined（?.catch 同样短路），不抛错；
    // 浏览器拒绝（权限/非用户手势）时静默降级为纯 CSS 全屏遮罩，形态状态不受影响。
    useEffect(() => {
        void containerRef.current?.requestFullscreen?.()?.catch(() => {
            // 浏览器拒绝全屏：保持 CSS 全屏遮罩形态，无需额外处理
        });
        const onFullscreenChange = () => {
            // fullscreenElement 已空 = 原生全屏已退出（含用户 Esc）：若仍处全屏形态则回 window。
            // 非 empty 的事件（进入原生全屏的确认）不动作。
            if (!document.fullscreenElement && displayModeRef.current === 'fullscreen') {
                setModeRef.current('window');
            }
        };
        document.addEventListener('fullscreenchange', onFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', onFullscreenChange);
            // 卸载清理：退出按钮/关闭播放器可能先于浏览器完成退出，若仍处原生全屏则主动归还
            if (document.fullscreenElement) {
                void document.exitFullscreen?.()?.catch(() => {
                    // 归还失败（已被浏览器退出等）无需处理
                });
            }
        };
    }, []);

    // 显式退出（控制栏按钮）：请求浏览器退出原生全屏（异步，成功后的 fullscreenchange
    // 因形态已切回 window 而 no-op），同时立即回 window 形态——jsdom 等无 Fullscreen API
    // 的兜底场景也保证 UI 正确回落，无需等待事件。
    const exitToWindow = () => {
        void document.exitFullscreen?.()?.catch(() => {
            // 退出原生全屏失败（权限等）：形态仍回 window，浏览器侧由卸载清理兜底
        });
        setMode('window');
    };

    // 完整关闭（hotfix-2，Close 按钮）：先请求浏览器退出原生全屏再关闭播放器。
    // 只调 close 时系统全屏不会退出、黑底容器残留，用户会被锁在灰屏；exitFullscreen
    // 失败（权限等）被 catch 吞掉不阻断关闭（浏览器侧由卸载清理兜底）。
    // close 后 reducer 已把 displayMode 重置为 window，调度层不再渲染全屏空壳。
    const closeFromFullscreen = () => {
        void document.exitFullscreen?.()?.catch(() => {
            // 退出原生全屏失败（权限等）：播放器仍完整关闭
        });
        close();
    };

    return (
        <AnimatePresence>
            {/* 关闭动画期间 currentItem 为 null 自动收敛；displayMode 由壳层调度保证只挂一份 */}
            {state.isOpen && currentItem && (
                <motion.div
                    ref={containerRef}
                    data-testid="player-fullscreen"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center overflow-hidden"
                >
                    {/* 顶部控制栏：自旧 MediaPlayer 全屏布局迁移（收藏/信息/全屏退出/关闭） */}
                    <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center text-white/80 z-50 pointer-events-none bg-gradient-to-b from-black/70 to-transparent">
                        <div className="flex flex-col max-w-[50%] pointer-events-auto">
                            <span className="font-medium text-lg truncate flex items-center gap-2">{currentItem.name}</span>
                            <span className="text-xs opacity-60 truncate">{currentItem.folderPath || 'Root'}</span>
                        </div>
                        <div className="flex items-center gap-2 pointer-events-auto">
                            {onToggleFavorite && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(currentItem, 'file'); }}
                                    className={`p-2 rounded-full transition-colors ${currentItem.isFavorite ? 'text-red-500 hover:bg-white/10' : 'hover:bg-white/10 text-white/70'}`}
                                    title="Toggle Favorite"
                                >
                                    <Icons.Heart size={20} fill={currentItem.isFavorite ? 'currentColor' : 'none'} />
                                </button>
                            )}
                            <button
                                onClick={(e) => { e.stopPropagation(); onToggleInfo(); }}
                                className={`p-2 rounded-full transition-colors ${showInfo ? 'bg-white/20' : 'hover:bg-white/10'}`}
                                title="File Info"
                            >
                                <Icons.Info size={20} />
                            </button>
                            {/* 全屏退出：原生全屏与 CSS 形态一并回落 window（见 exitToWindow） */}
                            <button
                                onClick={(e) => { e.stopPropagation(); exitToWindow(); }}
                                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                                title="Exit Full Screen"
                            >
                                <Icons.Minimize size={24} />
                            </button>
                            <button
                                onClick={(e) => { e.stopPropagation(); closeFromFullscreen(); }}
                                className="p-2 hover:bg-white/10 rounded-full transition-colors"
                                title="Close"
                            >
                                <Icons.Close size={24} />
                            </button>
                        </div>
                    </div>

                    {/* 面板调度：图片/视频各自面板；音频不渲染面板（仍由 AudioPlayer 承接） */}
                    {currentItem.mediaType === 'video' ? (
                        <VideoPane item={currentItem} />
                    ) : currentItem.mediaType === 'image' ? (
                        <ImageViewPane item={currentItem} onSlideNext={next} />
                    ) : null}

                    {/* 信息面板节点：MediaPlayer 壳层构建，absolute 定位相对本全屏容器 */}
                    {infoPanel}

                    {/* 左右导航：自旧全屏布局迁移，队列边界隐藏（首项隐藏左、末项隐藏右） */}
                    {state.index > 0 && (
                        <button
                            title="Previous"
                            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-all opacity-0 hover:opacity-100 md:opacity-100 z-50 pointer-events-auto"
                            onClick={(e) => { e.stopPropagation(); prev(); }}
                        >
                            <Icons.Back size={24} />
                        </button>
                    )}
                    {state.index < state.items.length - 1 && (
                        <button
                            title="Next"
                            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-all opacity-0 hover:opacity-100 md:opacity-100 rotate-180 z-50 pointer-events-auto"
                            onClick={(e) => { e.stopPropagation(); next(); }}
                        >
                            <Icons.Back size={24} />
                        </button>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
};
