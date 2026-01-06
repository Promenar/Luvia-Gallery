
import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HomeScreenConfig, MediaItem } from '../types';
import { getAuthUrl } from '../utils/fileUtils';
import { Icons } from './ui/Icon';
import { useLanguage } from '../contexts/LanguageContext';

interface HomeProps {
    title: string;
    items: MediaItem[];
    onEnterLibrary: () => void;
    onJumpToFolder: (item: MediaItem) => void;
    subtitle: string;
    config?: HomeScreenConfig;
}

export const Home: React.FC<HomeProps> = React.memo(({ title, items, onEnterLibrary, onJumpToFolder, subtitle, config }) => {
    const { t } = useLanguage();
    const [currentIndex, setCurrentIndex] = useState(0);
    const [featured, setFeatured] = useState<MediaItem[]>([]);

    useEffect(() => {
        if (items.length === 0) return;

        let filteredItems = items;

        if (config?.mode === 'single' && config.path) {
            // Find specific file. Note: config.path is likely "Folder/file.jpg", item.path is same.
            filteredItems = items.filter(i => i.path === config.path || i.path.endsWith(config.path!));
            // Fallback if not found exactly, try name search
            if (filteredItems.length === 0) {
                filteredItems = items.filter(i => i.name === config.path);
            }
        } else if (config?.mode === 'folder' && config.path) {
            // Include subfolders by prefix to support recursive picks
            filteredItems = items.filter(i => i.folderPath === config.path || i.folderPath.startsWith(config.path));
        } else if (config?.mode === 'favorites') {
            filteredItems = items.filter(i => i.isFavorite);
        }

        if (filteredItems.length > 0) {
            // If single mode, don't shuffle, just take one.
            if (config?.mode === 'single') {
                setFeatured([filteredItems[0]]);
            } else {
                const shuffled = [...filteredItems].sort(() => 0.5 - Math.random());
                setFeatured(shuffled.slice(0, 10)); // Take top 10 random
            }
        } else {
            // Fallback to random if config matches nothing
            const shuffled = [...items].sort(() => 0.5 - Math.random());
            setFeatured(shuffled.slice(0, 10));
        }
    }, [items, config]); // Re-run if items or config changes

    useEffect(() => {
        if (featured.length <= 1) return;
        const interval = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % featured.length);
        }, 5000);
        return () => clearInterval(interval);
    }, [featured]);

    const currentItem = featured[currentIndex];

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
                        {currentItem.mediaType === 'video' ? (
                            <video src={getAuthUrl(currentItem.url)} muted loop autoPlay className="w-full h-full object-cover" />
                        ) : (
                            <img src={getAuthUrl(currentItem.url)} alt="Background" className="w-full h-full object-cover" />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/20" />
                    </motion.div>
                ) : (
                    <div className="absolute inset-0 bg-gray-900 z-0 flex items-center justify-center">
                        <Icons.Image className="text-gray-800 w-64 h-64 opacity-20" />
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

                    {items.length > 0 && (
                        <p className="mt-8 text-white/40 text-sm tracking-widest uppercase">
                            {items.length.toLocaleString()} {t('items_count')}
                        </p>
                    )}
                </motion.div>
            </div>
        </div>
    );
}, (prev, next) => {
    return (
        prev.items.length === next.items.length &&
        prev.title === next.title &&
        prev.subtitle === next.subtitle &&
        prev.config?.mode === next.config?.mode &&
        prev.config?.path === next.config?.path
    );
});
