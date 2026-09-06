// components/player/ImageViewPane.tsx
// 自旧版图片查看器组件（Task 5 已删除）迁移的图片面板：
// - 状态/处理逻辑源行号：31-104（transform/slideshow/exif）、224-330（wheel/drag/touch/zoom）、
//   481-590（信息面板含 EXIF）、592-673 的图片分支（650-671 motion.img）。
// - 结构性改动仅三处：item 来自 props；删除 onClose/onNext/onPrev/onDelete/onRename/onJumpToFolder
//   相关 props 与逻辑；showInfo 由壳层控制栏（MediaPlayer）驱动，经 props 传入。
// - 幻灯片定时器保留在面板内部（4s），推进经 onSlideNext 回调（MediaPlayer 传队列 next）。
import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { MediaItem, ExifData } from '../../types';
import { getAuthUrl } from '../../utils/fileUtils';
import { Icons } from '../ui/Icon';
import { useLanguage } from '../../contexts/LanguageContext';
import { formatDate as utilsFormatDate, formatSize as utilsFormatSize } from '../../utils/formatters';

interface ImageViewPaneProps {
    item: MediaItem;
    /** 信息面板开合：由 MediaPlayer 控制栏的 Info 按钮驱动 */
    showInfo: boolean;
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
const usePaneLanguage = (): { t: (key: string) => string; language: 'en' | 'zh' } => {
    try {
        return useLanguage();
    } catch {
        return { t: (key: string) => key, language: 'en' };
    }
};

export const ImageViewPane: React.FC<ImageViewPaneProps> = ({ item, showInfo, onSlideNext }) => {
    const { t, language } = usePaneLanguage();
    const [transform, setTransform] = useState<TransformState>({ scale: 1, x: 0, y: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const [dragConstraints, setDragConstraints] = useState<{ left: number, right: number, top: number, bottom: number } | null>(null);

    // Slideshow State
    const [isPlaying, setIsPlaying] = useState(false);
    const slideshowIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Info Panel（showInfo 来自 props，EXIF 数据仍为面板本地状态）
    const [exifData, setExifData] = useState<ExifData | null>(null);
    const [isExifLoading, setIsExifLoading] = useState(false);

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
        setExifData(null);
    }, [item?.id]);

    // EXIF Parsing Logic (Server-Side)
    useEffect(() => {
        if (showInfo && item && item.mediaType === 'image') {
            const fetchExif = async () => {
                setIsExifLoading(true);
                try {
                    // Use Server-Side API instead of client-side parsing (avoids Auth/CORS issues)
                    const token = localStorage.getItem('luvia_token') || localStorage.getItem('lumina_token');
                    const headers: any = {};
                    if (token) headers['Authorization'] = `Bearer ${token}`;

                    const res = await fetch(`/api/file/${item.id}/exif`, { headers });
                    if (res.ok) {
                        const data = await res.json();
                        setExifData(data);
                    } else {
                        setExifData(null);
                    }
                } catch (e) {
                    console.warn("Failed to fetch EXIF", e);
                    setExifData(null);
                } finally {
                    setIsExifLoading(false);
                }
            };
            fetchExif();
        }
    }, [showInfo, item]);

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

    const formatDate = (ts: number | Date | undefined) => {
        return utilsFormatDate(ts, language);
    };

    const formatSize = (bytes: number) => {
        return utilsFormatSize(bytes);
    };

    const formatExposure = (t: number | undefined) => {
        if (!t) return '-';
        if (t >= 1) return t + 's';
        return '1/' + Math.round(1 / t);
    };

    return (
        <>
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

            {/* Info Panel Overlay：自 旧图片查看器源 481-590 行 原样迁移，仅 item 改为 props */}
            <AnimatePresence>
                {showInfo && (
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        className="absolute top-0 right-0 bottom-0 w-80 bg-black/90 z-40 p-6 pt-20 border-l border-white/10 text-white overflow-y-auto transform translate-z-0"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><Icons.Info size={20} /> {t('file_info')}</h3>
                        <div className="space-y-6 text-sm">
                            <section>
                                <h4 className="text-white/60 text-xs font-bold uppercase tracking-wider mb-3 border-b border-white/10 pb-1">{t('file_details')}</h4>
                                <div className="space-y-3">
                                    <div>
                                        <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('name')}</p>
                                        <p className="font-medium break-all">{item.name}</p>
                                    </div>
                                    <div>
                                        <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('path')}</p>
                                        <p className="text-white/80 break-all text-xs font-mono">{item.path}</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('size')}</p>
                                            <p className="text-white/80">{formatSize(item.size)}</p>
                                        </div>
                                        <div>
                                            <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('type')}</p>
                                            <p className="text-white/80">{item.mediaType.toUpperCase()}</p>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('date_modified')}</p>
                                        <p className="text-white/80">{formatDate(item.lastModified)}</p>
                                    </div>
                                </div>
                            </section>

                            {/* EXIF Section */}
                            {item.mediaType === 'image' && (
                                <section>
                                    <h4 className="text-white/60 text-xs font-bold uppercase tracking-wider mb-3 border-b border-white/10 pb-1 mt-6">{t('camera_details')}</h4>
                                    {isExifLoading ? (
                                        <div className="flex items-center gap-2 text-white/50 text-xs">
                                            <Icons.Loader size={12} className="animate-spin" /> {t('loading_metadata')}
                                        </div>
                                    ) : exifData ? (
                                        <div className="space-y-3">
                                            {(exifData.Make || exifData.Model) && (
                                                <div>
                                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('camera')}</p>
                                                    <p className="text-white/80">{exifData.Make} {exifData.Model}</p>
                                                </div>
                                            )}
                                            {exifData.LensModel && (
                                                <div>
                                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('lens')}</p>
                                                    <p className="text-white/80">{exifData.LensModel}</p>
                                                </div>
                                            )}
                                            <div className="grid grid-cols-2 gap-4">
                                                {exifData.FNumber && (
                                                    <div>
                                                        <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('aperture')}</p>
                                                        <p className="text-white/80">f/{exifData.FNumber}</p>
                                                    </div>
                                                )}
                                                {exifData.ExposureTime && (
                                                    <div>
                                                        <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('shutter')}</p>
                                                        <p className="text-white/80">{formatExposure(exifData.ExposureTime)}</p>
                                                    </div>
                                                )}
                                                {exifData.ISO && (
                                                    <div>
                                                        <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('iso')}</p>
                                                        <p className="text-white/80">{exifData.ISO}</p>
                                                    </div>
                                                )}
                                                {exifData.FocalLength && (
                                                    <div>
                                                        <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('focal_length')}</p>
                                                        <p className="text-white/80">{exifData.FocalLength}mm</p>
                                                    </div>
                                                )}
                                                {(exifData.width || exifData.height) && (
                                                    <div>
                                                        <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('dimensions')}</p>
                                                        <p className="text-white/80">{exifData.width || '?'} x {exifData.height || '?'}</p>
                                                    </div>
                                                )}
                                            </div>
                                            {exifData.DateTimeOriginal && (
                                                <div>
                                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('date_taken')}</p>
                                                    <p className="text-white/80">{formatDate(exifData.DateTimeOriginal)}</p>
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <p className="text-xs text-white/40 italic">{t('no_exif')}</p>
                                    )}
                                </section>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* 面板最小覆盖按钮组：幻灯片播放/暂停（源 444-452）与缩放切换（源 452-463）
                依赖 isPlaying/transform 面板内部状态，随状态一并留在面板内；
                位置改挂右下角，避免与 MediaPlayer 顶部控制栏重叠。 */}
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
        </>
    );
};
