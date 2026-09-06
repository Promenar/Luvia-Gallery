// components/player/ImageViewPane.tsx
// 自旧版图片查看器组件（Task 5 已删除）迁移的图片面板：
// - 状态/处理逻辑源行号：31-104（transform/slideshow/exif）、224-330（wheel/drag/touch/zoom）、
//   592-673 的图片分支（650-671 motion.img）。
// - 结构性改动仅三处：item 来自 props；删除 onClose/onNext/onPrev/onDelete/onRename/onJumpToFolder
//   相关 props 与逻辑；信息面板（含 EXIF 拉取）已于 hotfix-1 上移到壳层 MediaPlayer 统一渲染，
//   否则视频分支点 Info 无任何面板出现。
// - 幻灯片定时器保留在面板内部（4s），推进经 onSlideNext 回调（MediaPlayer 传队列 next）。
import React, { useEffect, useState, useRef } from 'react';
import { motion, PanInfo } from 'framer-motion';
import { MediaItem } from '../../types';
import { getAuthUrl } from '../../utils/fileUtils';
import { Icons } from '../ui/Icon';
import { useLanguage } from '../../contexts/LanguageContext';

interface ImageViewPaneProps {
    item: MediaItem;
    /** 幻灯片推进回调（MediaPlayer 传入队列 next） */
    onSlideNext: () => void;
}

interface TransformState {
    scale: number;
    x: number;
    y: number;
}

// 面板可能在未挂 LanguageProvider 的隔离环境（单元测试）渲染；
// 用 try/catch 包装保持 hook 调用顺序稳定，缺失 Provider 时回退英文与翻译 key 原文。
// 信息面板（含 EXIF）已上移至 MediaPlayer，本 hook 由 ImageViewPane 与 MediaPlayer 共用。
export const usePaneLanguage = (): { t: (key: string) => string; language: 'en' | 'zh' } => {
    try {
        return useLanguage();
    } catch {
        return { t: (key: string) => key, language: 'en' };
    }
};

export const ImageViewPane: React.FC<ImageViewPaneProps> = ({ item, onSlideNext }) => {
    const [transform, setTransform] = useState<TransformState>({ scale: 1, x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const [dragConstraints, setDragConstraints] = useState<{ left: number, right: number, top: number, bottom: number } | null>(null);

    // Slideshow State
    const [isPlaying, setIsPlaying] = useState(false);
    const slideshowIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Ref for callback to prevent hook dependency loops
    const onSlideNextRef = useRef(onSlideNext);

    useEffect(() => {
        onSlideNextRef.current = onSlideNext;
    }, [onSlideNext]);

    // Pinch zoom state
    const lastDist = useRef<number | null>(null);

    // Reset state when item changes
    useEffect(() => {
        setTransform({ scale: 1, x: 0, y: 0 });
        setDragConstraints(null);
        lastDist.current = null;
    }, [item?.id]);

    // Slideshow Logic
    useEffect(() => {
        if (isPlaying) {
            slideshowIntervalRef.current = setInterval(() => {
                if (onSlideNextRef.current) onSlideNextRef.current();
            }, 4000);
        } else {
            if (slideshowIntervalRef.current) {
                clearInterval(slideshowIntervalRef.current);
                slideshowIntervalRef.current = null;
            }
        }
        return () => {
            if (slideshowIntervalRef.current) {
                clearInterval(slideshowIntervalRef.current);
                slideshowIntervalRef.current = null;
            }
        };
    }, [isPlaying]);

    // Stop playing if closed or zoomed
    useEffect(() => {
        if (transform.scale > 1) setIsPlaying(false);
    }, [transform.scale]);

    // Update drag constraints when scale changes
    useEffect(() => {
        if (transform.scale === 1) {
            setDragConstraints(null);
            return;
        }

        const updateConstraints = () => {
            if (!containerRef.current) return;
            const { width, height } = containerRef.current.getBoundingClientRect();
            const xLimit = (width * transform.scale - width) / 2;
            const yLimit = (height * transform.scale - height) / 2;

            setDragConstraints({
                left: -xLimit,
                right: xLimit,
                top: -yLimit,
                bottom: yLimit
            });
        };

        updateConstraints();
        window.addEventListener('resize', updateConstraints);
        return () => window.removeEventListener('resize', updateConstraints);
    }, [transform.scale]);

    const handleWheel = (e: React.WheelEvent) => {
        if (item.mediaType === 'video' || item.mediaType === 'audio') return;

        if (e.ctrlKey || Math.abs(e.deltaY) > 0) {
            setIsPlaying(false);
            const container = containerRef.current;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            const pointerX = e.clientX - rect.left - rect.width / 2;
            const pointerY = e.clientY - rect.top - rect.height / 2;

            const delta = -e.deltaY * 0.002;
            const targetScale = Math.min(Math.max(1, transform.scale + delta), 5);

            const ratio = targetScale / transform.scale;

            let newX = pointerX - (pointerX - transform.x) * ratio;
            let newY = pointerY - (pointerY - transform.y) * ratio;

            const xLimit = (rect.width * targetScale - rect.width) / 2;
            const yLimit = (rect.height * targetScale - rect.height) / 2;

            if (targetScale === 1) {
                newX = 0;
                newY = 0;
            } else {
                if (newX > xLimit) newX = xLimit;
                if (newX < -xLimit) newX = -xLimit;
                if (newY > yLimit) newY = yLimit;
                if (newY < -yLimit) newY = -yLimit;
            }

            setTransform({
                scale: targetScale,
                x: newX,
                y: newY
            });
        }
    };

    const handleDrag = (event: any, info: PanInfo) => {
        setTransform(prev => ({
            ...prev,
            x: prev.x + info.delta.x,
            y: prev.y + info.delta.y
        }));
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            lastDist.current = dist;
        }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (e.touches.length === 2 && lastDist.current !== null) {
            const dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            const delta = dist - lastDist.current;
            const sensitivity = 0.01;
            const newScale = Math.min(Math.max(1, transform.scale + delta * sensitivity), 5);

            setTransform(prev => ({
                ...prev,
                scale: newScale,
                x: newScale === 1 ? 0 : Math.max(-500, Math.min(500, prev.x)),
                y: newScale === 1 ? 0 : Math.max(-500, Math.min(500, prev.y))
            }));
            lastDist.current = dist;
        }
    };

    const handleTouchEnd = () => {
        lastDist.current = null;
    };

    const toggleZoom = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsPlaying(false);
        if (transform.scale > 1) {
            setTransform({ scale: 1, x: 0, y: 0 });
        } else {
            const container = containerRef.current;
            if (container) {
                const rect = container.getBoundingClientRect();
                const pointerX = e.clientX - rect.left - rect.width / 2;
                const pointerY = e.clientY - rect.top - rect.height / 2;

                const targetScale = 2.5;
                const ratio = targetScale / 1;

                const newX = pointerX - (pointerX - 0) * ratio;
                const newY = pointerY - (pointerY - 0) * ratio;

                setTransform({ scale: targetScale, x: newX, y: newY });
            } else {
                setTransform({ scale: 2.5, x: 0, y: 0 });
            }
        }
    };

    // Task B 适配浮窗：根容器由旧全屏壳层铺满改为 absolute inset-0 铺满 PlayerWindow 内容区，
    // 内容 contain 显示（flex 居中 + max-w/h-full）；缩放/双击/拖拽等 transform 逻辑保持不变。
    return (
        <div className="absolute inset-0">
            {/* Content Container：自 旧图片查看器源 592-672 行迁移，仅保留图片分支。
                onWheel 原挂在壳层 overlay（源 381 行），随缩放逻辑一并迁入本面板根容器。 */}
            <div
                ref={containerRef}
                className={`relative w-full h-full flex items-center justify-center transition-all duration-300 ${transform.scale === 1 ? 'p-4 md:p-10' : 'p-0'}`}
                onWheel={handleWheel}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <motion.img
                    src={getAuthUrl(item.url)}
                    alt={item.name}
                    className="max-w-full max-h-full object-contain shadow-2xl rounded-sm"
                    style={{ cursor: transform.scale > 1 ? 'grab' : 'zoom-in' }}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={toggleZoom}

                    animate={{
                        scale: transform.scale,
                        x: transform.x,
                        y: transform.y
                    }}
                    transition={{ type: 'spring', stiffness: 300, damping: 30 }}

                    drag={transform.scale > 1}
                    dragConstraints={dragConstraints || undefined}
                    dragElastic={0.05}
                    dragMomentum={false}
                    onDrag={handleDrag}
                    whileDrag={{ cursor: 'grabbing' }}
                />
            </div>

            {/* 信息面板已上移至壳层 MediaPlayer（hotfix-1）：图片与视频共用同一面板，
                EXIF 相机区块在壳层面板内仍仅对图片显示。 */}

            {/* 面板最小覆盖按钮组：幻灯片播放/暂停（源 444-452）与缩放切换（源 452-463）
                依赖 isPlaying/transform 面板内部状态，随状态一并留在面板内；
                位置挂窗口内容区右下角，不与浮窗头部控制栏重叠（Task B 起锚定本面板根容器）。 */}
            <div className="absolute bottom-4 right-4 z-50 flex items-center gap-2">
                <button
                    onClick={(e) => { e.stopPropagation(); setIsPlaying(!isPlaying); }}
                    className={`p-2 rounded-full transition-colors ${isPlaying ? 'bg-primary-600 text-white' : 'hover:bg-white/10 text-white/80'}`}
                    title={isPlaying ? "Pause Slideshow" : "Play Slideshow"}
                >
                    {isPlaying ? <Icons.Pause size={24} /> : <Icons.Play size={24} />}
                </button>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setTransform(prev => prev.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 });
                    }}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors hidden md:block text-white/80"
                    title={transform.scale > 1 ? "Zoom Out" : "Zoom In"}
                >
                    {transform.scale > 1 ? <Icons.ZoomOut size={24} /> : <Icons.ZoomIn size={24} />}
                </button>
            </div>
        </div>
    );
};
