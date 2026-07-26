import React from 'react';
import { MediaItem } from '../types';
import { ViewportRestoreCommand, ViewportSnapshot } from './gallery/viewport-types';
import { GridViewport } from './gallery/GridViewport';
import { TimelineViewport } from './gallery/TimelineViewport';
import { MasonryViewport } from './gallery/MasonryViewport';
import type { ViewportCaptureHandle } from './gallery/viewport-types';

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
    restoreCommand?: ViewportRestoreCommand;
    onSnapshotChange?: (snapshot: ViewportSnapshot) => void;
    onRestoreComplete?: (token: number) => void;
}

export const VirtualGallery = React.forwardRef<ViewportCaptureHandle, VirtualGalleryProps>((props, ref) => {
    const {
        layout,
        viewKey = layout,
        restoreSnapshot,
        restoreCommand,
        onSnapshotChange,
        onRestoreComplete,
        ...rest
    } = props;

    const commonProps = {
        ...rest,
        viewKey,
        restoreSnapshot,
        restoreCommand,
        onSnapshotChange,
        onRestoreComplete
    };

    if (layout === 'masonry') {
        return <MasonryViewport ref={ref} {...commonProps} />;
    }

    if (layout === 'timeline') {
        return <TimelineViewport ref={ref} {...commonProps} />;
    }

    return <GridViewport ref={ref} {...commonProps} />;
});
