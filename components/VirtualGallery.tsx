import React from 'react';
import { MediaItem } from '../types';
import { ViewportSnapshot } from './gallery/viewport-types';
import { GridViewport } from './gallery/GridViewport';
import { TimelineViewport } from './gallery/TimelineViewport';
import { MasonryViewport } from './gallery/MasonryViewport';

export interface VirtualGalleryProps {
    items: MediaItem[];
    onItemClick: (item: MediaItem) => void;
    // Infinite scroll props
    hasNextPage: boolean;
    isNextPageLoading: boolean;
    loadNextPage: (startIndex: number, stopIndex: number) => Promise<void> | void;
    itemCount: number; // Total count if known, or items.length
    layout: 'grid' | 'masonry' | 'timeline';
    // Folder Actions
    onToggleFavorite?: (path: string, type: 'file' | 'folder') => void;
    onRename?: (path: string, newName: string) => void;
    onDelete?: (path: string) => void;
    onRegenerate?: (path: string) => void;

    // 可捕获、可恢复位置协议属性
    viewKey?: string;
    restoreSnapshot?: ViewportSnapshot;
    onSnapshotChange?: (snapshot: ViewportSnapshot) => void;
    onRestoreComplete?: () => void;
}

export const VirtualGallery: React.FC<VirtualGalleryProps> = (props) => {
    const {
        layout,
        viewKey = layout,
        restoreSnapshot,
        onSnapshotChange,
        onRestoreComplete,
        ...rest
    } = props;

    const commonProps = {
        ...rest,
        viewKey,
        restoreSnapshot,
        onSnapshotChange,
        onRestoreComplete
    };

    if (layout === 'masonry') {
        return <MasonryViewport {...commonProps} />;
    }

    if (layout === 'timeline') {
        return <TimelineViewport {...commonProps} />;
    }

    return <GridViewport {...commonProps} />;
};
