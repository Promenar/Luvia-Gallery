
import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HomeScreenConfig, MediaItem } from '../types';
import { getAuthUrl, seededShuffle } from '../utils/fileUtils';
import { Icons } from './ui/Icon';
import { useLanguage } from '../contexts/LanguageContext';

interface HomeProps {
    title: string;
    items: MediaItem[];
    /** 媒体库总数；为 0 时不显示计数 */
    totalCount?: number;
    onEnterLibrary: () => void;
    onJumpToFolder: (item: MediaItem) => void;
    subtitle: string;
    config?: HomeScreenConfig;
}

const FEATURED_LIMIT = 10;

/** 按首页配置从候选中挑选轮播素材；随机部分按会话种子确定性洗牌。 */
export const selectHomeFeaturedItems = (
    items: MediaItem[],
    config: HomeScreenConfig | undefined,
    seed: number,
): MediaItem[] => {
    const visualItems = items.filter(item => item.mediaType === 'image' || item.mediaType === 'video');
    if (visualItems.length === 0) return [];

    if (config?.mode === 'single' && config.path) {
        const exact = visualItems.find(item => item.path === config.path)
            || visualItems.find(item => item.path.endsWith(config.path!))
            || visualItems.find(item => item.name === config.path);
        return exact ? [exact] : seededShuffle(visualItems, seed).slice(0, FEATURED_LIMIT);
    }

    let candidates = visualItems;
    if (config?.mode === 'folder' && config.path) {
        const folder = config.path.replace(/\/+$/, '');
        candidates = visualItems.filter(item => item.folderPath === folder || item.folderPath.startsWith(`${folder}/`));
    } else if (config?.mode === 'favorites') {
        candidates = visualItems.filter(item => item.isFavorite);
        // 收藏模式没有收藏时保持空结果，不回退到全库
        if (candidates.length === 0) return [];
    }

    return seededShuffle(candidates.length > 0 ? candidates : visualItems, seed).slice(0, FEATURED_LIMIT);
};

/** 先显示已缓存的小缩略图，原图解码完成后再淡入，避免全屏背景长时间空白。 */
const HomeBackdrop: React.FC<{ item: MediaItem }> = ({ item }) => {
    const thumbnailSrc = item.thumbnailUrl ? getAuthUrl(item.thumbnailUrl) : '';
    const fullSrc = item.mediaType === 'image' ? getAuthUrl(item.url) : '';
    const [isFullLoaded, setIsFullLoaded] = useState(false);

    useEffect(() => {
        setIsFullLoaded(false);
        if (!fullSrc) return;
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => setIsFullLoaded(true);
        image.src = fullSrc;
        return () => { image.onload = null; };
    }, [fullSrc]);

    return (
        <>
            {thumbnailSrc && (
                <img src={thumbnailSrc} alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover blur-xl scale-110" />
            )}
            {item.mediaType === 'video' && !thumbnailSrc && (
                // 本地导入模式没有服务端缩略图，视频直接以静音循环作为背景
                <video src={getAuthUrl(item.url)} muted loop autoPlay playsInline className="absolute inset-0 w-full h-full object-cover" />
            )}
            {fullSrc && (
                <img
                    src={fullSrc}
                    alt=""
                    aria-hidden="true"
                    className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${isFullLoaded ? 'opacity-100' : 'opacity-0'}`}
                />
            )}
        </>
    );
};

export const Home: React.FC<HomeProps> = React.memo(({ title, items, totalCount = 0, onEnterLibrary, onJumpToFolder, subtitle, config }) => {
    const { t } = useLanguage();
    const [currentIndex, setCurrentIndex] = useState(0);
    // 每次进入首页生成一次会话种子：同一会话内顺序稳定，下次进入换一组
    const [sessionSeed] = useState(() => Math.floor(Math.random() * 2_147_483_647));

    const featured = useMemo(
        () => selectHomeFeaturedItems(items, config, sessionSeed),
        [items, config?.mode, config?.path, sessionSeed],
    );

    useEffect(() => {
        setCurrentIndex(0);
    }, [featured]);

    useEffect(() => {
        if (featured.length <= 1) return;
        const interval = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % featured.length);
        }, 5000);
        return () => clearInterval(interval);
    }, [featured]);

    const currentItem = featured[currentIndex % Math.max(1, featured.length)];

    return (
        <div className="relative w-full h-full bg-black overflow-hidden flex items-center justify-center">
            {/* Background Slideshow */}
            <AnimatePresence mode="wait">
                {currentItem ? (
                    <motion.div
                        key={currentItem.id}
                        initial={{ opacity: 0, scale: 1.1 }}
                        animate={{ opacity: 0.6, scale: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.5 }}
                        className="absolute inset-0 z-0"
                    >
                        <HomeBackdrop item={currentItem} />
                        <div className="absolute inset-0 bg-linear-to-t from-black via-black/40 to-black/20" />
                    </motion.div>
                ) : (
                    <div className="absolute inset-0 bg-surface-primary z-0 flex items-center justify-center">
                        <Icons.Image className="text-white/5 w-64 h-64" />
                    </div>
                )}
            </AnimatePresence>

            {/* Content */}
            <div className="relative z-10 text-center max-w-4xl px-4">
                <motion.div
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.5 }}
                >
                    <h1 className="text-5xl md:text-7xl font-bold text-white mb-6 tracking-tight drop-shadow-2xl">
                        {title || 'Luvia Gallery'}
                    </h1>
                    <p className="text-lg md:text-xl text-gray-200 mb-6 max-w-2xl mx-auto font-light drop-shadow-md">
                        {subtitle}
                    </p>

                    {currentItem && (
                        <div className="mb-8 flex flex-col items-center gap-2">
                            <div className="bg-black/40 backdrop-blur-md px-3 py-1 rounded-full text-xs text-white/70 font-mono border border-white/10 flex items-center gap-2">
                                <Icons.Image size={10} />
                                {currentItem.name}
                            </div>
                            <button onClick={() => onJumpToFolder(currentItem)} className="text-xs text-primary-300 hover:text-white flex items-center gap-1 hover:underline">
                                <Icons.Folder size={12} />
                                <span>{t('view_in')} {currentItem.folderPath || 'Root'}</span>
                            </button>
                        </div>
                    )}

                    <button
                        onClick={onEnterLibrary}
                        className="group relative px-8 py-4 bg-white/10 hover:bg-white/20 backdrop-blur-md border border-white/30 rounded-full text-white font-medium text-lg transition-all hover:scale-105 active:scale-95 flex items-center gap-3 mx-auto"
                    >
                        <span>{t('enter_library')}</span>
                        <div className="bg-white text-black rounded-full p-1 group-hover:translate-x-1 transition-transform">
                            <Icons.ChevronRight size={20} />
                        </div>
                    </button>

                    {totalCount > 0 && (
                        <p className="mt-8 text-white/40 text-sm tracking-widest uppercase">
                            {totalCount.toLocaleString()} {t('items_count')}
                        </p>
                    )}
                </motion.div>
            </div>
        </div>
    );
});
