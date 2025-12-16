import React from 'react';
import { MediaItem } from '../types';
import { Icons } from './ui/Icon';

interface AudioCardProps {
    item: MediaItem;
    onClick: (item: MediaItem) => void;
    layout: 'grid' | 'masonry';
    isVirtual?: boolean;
}

export const AudioCard: React.FC<AudioCardProps> = ({ item, onClick, layout, isVirtual = false }) => {
    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    return (
        <div
            className={`group relative bg-gradient-to-br from-purple-500/10 to-blue-500/10 dark:from-purple-500/20 dark:to-blue-500/20 rounded-xl overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-xl ${layout === 'grid' ? 'aspect-square' : 'aspect-[4/3]'
                }`}
            onClick={() => onClick(item)}
        >
            {/* Audio Icon Background */}
            <div className="absolute inset-0 flex items-center justify-center">
                <Icons.Music
                    size={layout === 'grid' ? 64 : 80}
                    className="text-purple-500/30 dark:text-purple-400/30"
                />
            </div>

            {/* Play Button Overlay */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black/40 backdrop-blur-sm">
                <div className="w-16 h-16 rounded-full bg-white/90 dark:bg-gray-800/90 flex items-center justify-center shadow-lg">
                    <Icons.Play size={28} className="text-purple-600 dark:text-purple-400 ml-1" />
                </div>
            </div>

            {/* File Info */}
            <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent">
                <p className="text-white text-sm font-medium truncate mb-1">
                    {item.name}
                </p>
                <div className="flex items-center gap-2 text-xs text-white/70">
                    <Icons.Music size={12} />
                    <span>{formatFileSize(item.size)}</span>
                </div>
            </div>

            {/* Favorite Heart */}
            {item.isFavorite && (
                <div className="absolute top-2 right-2 z-10">
                    <Icons.Heart
                        size={20}
                        className="text-red-500 fill-current drop-shadow-lg"
                    />
                </div>
            )}
        </div>
    );
};
