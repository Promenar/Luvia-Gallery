// components/player/MediaPlayer.tsx
// 播放器调度器 + 信息面板持有层（Task B 起不再自渲染全屏遮罩）：
// - isOpen 时按 displayMode 调度：window/mini/fab 渲染 PlayerWindow 浮窗，
//   fullscreen 渲染 PlayerFullscreen 独占全屏（Task D，宿主全屏 effect 在其内部）。
// - 键盘导航（←→ 队列移动；Esc 按形态区分）保留在本层：window/mini/fab 形态 Esc 关闭；
//   fullscreen 形态 Esc 交由浏览器原生全屏退出（fullscreenchange 监听回 window），
//   requestFullscreen 不可用的兜底场景直接回 window，两种场景都不误关播放器。
// - 信息面板（含 EXIF 拉取，hotfix-1 上移到壳层）仍由本层持有：状态与数据逻辑不变，
//   面板 JSX 以 infoPanel 节点同构下传 PlayerWindow / PlayerFullscreen（最小改动选择）。
// - 收藏经 props { onToggleFavorite } 注入并同构透传两形态（App 接线不变）。
import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMediaPlayer } from './PlayerProvider';
import { PlayerWindow } from './PlayerWindow';
import { PlayerFullscreen } from './PlayerFullscreen';
import { usePaneLanguage } from './ImageViewPane';
import { Icons } from '../ui/Icon';
import { formatDate as utilsFormatDate, formatSize as utilsFormatSize } from '../../utils/formatters';
import type { MediaItem, ExifData } from '../../types';

interface MediaPlayerProps {
    onToggleFavorite?: (item: MediaItem, type: 'file') => void;
}

export const MediaPlayer: React.FC<MediaPlayerProps> = ({ onToggleFavorite }) => {
    const { state, currentItem, close, next, prev, displayMode, setMode } = useMediaPlayer();
    // 信息面板开合由窗口头部 Info 按钮驱动，面板内容（含 EXIF）在壳层构建后下传浮窗渲染
    const { t, language } = usePaneLanguage();
    const [showInfo, setShowInfo] = useState(false);

    // Info Panel：EXIF 数据为壳层本地状态（自 ImageViewPane 原样迁移，hotfix-1）
    const [exifData, setExifData] = useState<ExifData | null>(null);
    const [isExifLoading, setIsExifLoading] = useState(false);

    // showInfo 不跨开关周期残留：关闭时立即收起信息面板，避免重开播放器时先渲染一帧带面板的状态再收起（闪烁）。
    useEffect(() => {
        if (!state.isOpen) setShowInfo(false);
    }, [state.isOpen]);

    // EXIF Parsing Logic (Server-Side)：仅图片项拉取；读取 token 的 localStorage 调用在生产浏览器可用，
    // 暂不改走 apiFetch（阶段三重构另行处理）。
    // 依赖用 currentItem?.id 而非 currentItem 引用：收藏回写（patchItem 同 id 浅合并）会生成新引用，
    // 若按引用依赖会在每次收藏点击时重复发起相同 EXIF 请求；按 id 依赖仅在 showInfo 切换或换项时拉取。
    useEffect(() => {
        if (showInfo && currentItem && currentItem.mediaType === 'image') {
            const fetchExif = async () => {
                setIsExifLoading(true);
                try {
                    const token = localStorage.getItem('luvia_token') || localStorage.getItem('lumina_token');
                    const headers: any = {};
                    if (token) headers['Authorization'] = `Bearer ${token}`;

                    const res = await fetch(`/api/file/${currentItem.id}/exif`, { headers });
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
    }, [showInfo, currentItem?.id]);

    // 切换队列项时立即丢弃旧 EXIF，避免下一项的 EXIF 请求返回前短暂显示上一项的相机信息（原面板行为）。
    useEffect(() => {
        setExifData(null);
    }, [currentItem?.id]);

    // 键盘导航：Esc 按形态区分——window/mini/fab 关闭播放器；fullscreen 形态不误关
    // （原生全屏激活时 Esc 由浏览器退出全屏、fullscreenchange 监听回 window，
    // requestFullscreen 不可用的兜底场景直接回 window 形态）；←→ 队列移动（边界自动 no-op）。
    // 输入控件放行：非模态浮窗打开时画廊行内可能存在聚焦输入框（重命名）或滑杆（音频控制），
    // 事件 target 落在可编辑元素/输入控件时直接放行，方向键与 Esc 优先作用于输入本身。
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!state.isOpen) return;
            const target = e.target;
            const isEditableTarget = target instanceof HTMLInputElement
                || target instanceof HTMLTextAreaElement
                || (target instanceof HTMLElement && target.isContentEditable);
            if (isEditableTarget) return;
            if (e.key === 'Escape') {
                if (displayMode === 'fullscreen') {
                    // 原生全屏未激活（兜底：jsdom/浏览器拒绝全屏）才主动回 window；
                    // 已激活时留给浏览器退出全屏，避免与 fullscreenchange 监听双重处理
                    if (!document.fullscreenElement) setMode('window');
                } else {
                    close();
                }
            }
            if (e.key === 'ArrowRight') next();
            if (e.key === 'ArrowLeft') prev();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [state.isOpen, close, next, prev, displayMode, setMode]);

    // 信息面板格式化辅助：自 ImageViewPane 原样迁移（仅信息面板使用）
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

    // 关闭动画期间队列仍保留（reducer close 不清空 items），AnimatePresence 得以播放退出动画；彻底无队列时不渲染。
    if (!state.items.length) return null;

    // Info Panel Overlay：自 旧图片查看器源 481-590 行迁移（hotfix-1 起挂壳层）。
    // Task B 起渲染在 PlayerWindow 内容区内（absolute 定位相对浮窗容器），图片/视频通用。
    const infoPanel = (
        <AnimatePresence>
            {showInfo && currentItem && (
                <motion.div
                    initial={{ x: '100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '100%' }}
                    className="absolute top-0 right-0 bottom-0 w-80 bg-black/90 z-40 p-6 pt-14 border-l border-white/10 text-white overflow-y-auto transform translate-z-0"
                    onClick={(e) => e.stopPropagation()}
                >
                    <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><Icons.Info size={20} /> {t('file_info')}</h3>
                    <div className="space-y-6 text-sm">
                        <section>
                            <h4 className="text-white/60 text-xs font-bold uppercase tracking-wider mb-3 border-b border-white/10 pb-1">{t('file_details')}</h4>
                            <div className="space-y-3">
                                <div>
                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('name')}</p>
                                    <p className="font-medium break-all">{currentItem.name}</p>
                                </div>
                                <div>
                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('path')}</p>
                                    <p className="text-white/80 break-all text-xs font-mono">{currentItem.path}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('size')}</p>
                                        <p className="text-white/80">{formatSize(currentItem.size)}</p>
                                    </div>
                                    <div>
                                        <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('type')}</p>
                                        <p className="text-white/80">{currentItem.mediaType.toUpperCase()}</p>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">{t('date_modified')}</p>
                                    <p className="text-white/80">{formatDate(currentItem.lastModified)}</p>
                                </div>
                            </div>
                        </section>

                        {/* EXIF Section：仅图片项显示（视频面板即使打开也不出现相机区块） */}
                        {currentItem.mediaType === 'image' && (
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
    );

    // Task B/D：isOpen 时按 displayMode 调度——浮窗三形态走 PlayerWindow（无遮罩、可拖动、
    // 比例自适应），fullscreen 走 PlayerFullscreen 独占全屏（宿主全屏 effect 在其内部）。
    // 面板调度（图片/视频）随壳层迁入两形态组件；音频不渲染面板（仍由 AudioPlayer 承接）。
    if (displayMode === 'fullscreen') {
        // 调度兜底（hotfix-2）：close 后任何路径都不再渲染全屏空壳（reducer close 已把
        // displayMode 重置为 window，此处防形态状态异常时黑底容器残留锁死用户）；
        // window/mini/fab 的关闭动画走 PlayerWindow 自身 AnimatePresence，不受影响。
        if (!state.isOpen) return null;
        return (
            <PlayerFullscreen
                onToggleFavorite={onToggleFavorite}
                showInfo={showInfo}
                onToggleInfo={() => setShowInfo((v) => !v)}
                infoPanel={infoPanel}
            />
        );
    }
    return (
        <PlayerWindow
            onToggleFavorite={onToggleFavorite}
            showInfo={showInfo}
            onToggleInfo={() => setShowInfo((v) => !v)}
            infoPanel={infoPanel}
        />
    );
};
