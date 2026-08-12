import React from 'react';
import { MediaItem } from '../types';
import { Icons } from './ui/Icon';

export interface AudioCardProps {
    item: MediaItem;
    onClick: (item: MediaItem) => void;
    layout: 'grid' | 'masonry';
    isVirtual?: boolean;
    mediaHoverZoomEnabled?: boolean;
}

export const areAudioCardPropsEqual = (prev: AudioCardProps, next: AudioCardProps): boolean =>
    prev.item.id === next.item.id
    && prev.item.file === next.item.file
    && prev.item.url === next.item.url
    && prev.item.thumbnailUrl === next.item.thumbnailUrl
    && prev.item.name === next.item.name
    && prev.item.path === next.item.path
    && prev.item.folderPath === next.item.folderPath
    && prev.item.size === next.item.size
    && prev.item.type === next.item.type
    && prev.item.lastModified === next.item.lastModified
    && prev.item.mediaType === next.item.mediaType
    && prev.item.sourceId === next.item.sourceId
    && prev.item.isFavorite === next.item.isFavorite
    && prev.item.width === next.item.width
    && prev.item.height === next.item.height
    && prev.item.aspectRatio === next.item.aspectRatio
    && prev.item.mediaCount === next.item.mediaCount
    && prev.item.coverMedia === next.item.coverMedia
    && prev.item.children === next.item.children
    && prev.onClick === next.onClick
    && prev.layout === next.layout
    && prev.isVirtual === next.isVirtual
    && prev.mediaHoverZoomEnabled === next.mediaHoverZoomEnabled;

export const getAudioCardClasses = (
    layout: 'grid' | 'masonry',
    mediaHoverZoomEnabled: boolean,
): string =>
    `group relative bg-gradient-to-br from-purple-500/10 to-blue-500/10 dark:from-purple-500/20 dark:to-blue-500/20 rounded-xl overflow-hidden cursor-pointer transition-all duration-200 ${mediaHoverZoomEnabled ? 'hover:scale-[1.02] ' : ''}hover:shadow-xl ${layout === 'grid' ? 'aspect-square' : 'aspect-[4/3]'} will-change-transform`;

export const AudioCard: React.FC<AudioCardProps> = React.memo(({
    item,
    onClick,
    layout,
    isVirtual = false,
    mediaHoverZoomEnabled = true,
}) => {
    const formatFileSize = (bytes: number): string => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    return (
        <div
            className={getAudioCardClasses(layout, mediaHoverZoomEnabled)}
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
                <div className="w-16 h-16 rounded-full bg-surface-secondary backdrop-blur-md flex items-center justify-center shadow-lg border border-white/5">
                    <Icons.Play size={28} className="text-purple-600 dark:text-accent-500 ml-1" />
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
}, areAudioCardPropsEqual);
