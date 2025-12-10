import React, { useMemo } from 'react';
import * as ReactWindow from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { MediaItem } from '../types';
import { MediaCard } from './PhotoCard';
import { Icons } from './ui/Icon';

// Workaround for potential type definition mismatch or missing types for named export
const FixedSizeGrid = (ReactWindow as any).FixedSizeGrid;

interface VirtualGalleryProps {
  items: MediaItem[];
  onItemClick: (item: MediaItem) => void;
  // Infinite scroll props
  hasNextPage: boolean;
  isNextPageLoading: boolean;
  loadNextPage: (startIndex: number, stopIndex: number) => Promise<void> | void;
  itemCount: number; // Total count if known, or items.length
  layout: 'grid' | 'masonry';
}

export const VirtualGallery: React.FC<VirtualGalleryProps> = ({ 
  items, 
  onItemClick,
  hasNextPage,
  isNextPageLoading,
  loadNextPage,
  itemCount,
  layout
}) => {
  
  // -- MASONRY LAYOUT (Deterministic JS Columns) --
  // We distribute items into columns in JS. This ensures that new items (appended to 'items')
  // fall into the bottom of columns and do not cause the top items to reshuffle (reflow),
  // which happens with CSS columns when height changes.
  
  // Memoize column distribution to avoid recalculation on every render unless items change
  const columns = useMemo(() => {
    if (layout !== 'masonry') return [];
    
    // Determine column count based on window width (approximation for SSR/Initial)
    // In a real app we might use a resize observer hook, but media queries match tailwind breakpoints.
    const width = typeof window !== 'undefined' ? window.innerWidth : 1200;
    let numCols = 2;
    if (width >= 768) numCols = 3;
    if (width >= 1024) numCols = 4;
    if (width >= 1280) numCols = 5;

    const cols: MediaItem[][] = Array.from({ length: numCols }, () => []);
    
    // Simple round-robin distribution. 
    // For a true "shortest column" masonry, we'd need aspect ratios known ahead of time.
    // Round-robin is stable and O(n).
    items.forEach((item, i) => {
        cols[i % numCols].push(item);
    });
    
    return cols;
  }, [items, layout]);


  if (layout === 'masonry') {
      return (
          <div className="w-full h-full pb-20">
              <div className="flex gap-4 p-1 items-start">
                  {columns.map((colItems, colIndex) => (
                      <div key={colIndex} className="flex-1 flex flex-col gap-4">
                          {colItems.map((item) => (
                              <MediaCard 
                                  key={item.id}
                                  item={item} 
                                  onClick={onItemClick} 
                                  layout="masonry"
                                  isVirtual={false} 
                              />
                          ))}
                      </div>
                  ))}
              </div>
              
              {/* Load More Sentinel */}
              {hasNextPage && (
                  <div className="w-full py-8 flex justify-center items-center">
                     <button 
                         onClick={() => loadNextPage(items.length, items.length + 50)} 
                         className="px-6 py-2 bg-gray-100 dark:bg-gray-800 rounded-full text-sm font-medium text-gray-500 flex items-center gap-2"
                         disabled={isNextPageLoading}
                     >
                         {isNextPageLoading && <Icons.Loader className="animate-spin" size={14} />}
                         {isNextPageLoading ? 'Loading more...' : 'Load More'}
                     </button>
                  </div>
              )}
          </div>
      );
  }

  // -- VIRTUAL GRID LAYOUT (React-Window) --
  // Best for "Server Mode" with 100k+ items. 
  // Forces strict squares but extremely fast.

  const GUTTER_SIZE = 16;
  const COLUMN_WIDTH = 250; // Minimum width, will scale

  // Helper to determine if a given index has been loaded
  const isItemLoaded = (index: number) => {
      // If there's no further pages, everything up to items.length is loaded.
      // When using infinite loading, items may be shorter than the reported itemCount.
      return !hasNextPage || index < items.length;
  };

  return (
    <div className="flex-1 w-full h-full">
      <AutoSizer>
        {({ height, width }: { height: number, width: number }) => {
          // Calculate columns based on width
          const columnCount = Math.floor((width + GUTTER_SIZE) / (COLUMN_WIDTH + GUTTER_SIZE));
          const safeColumnCount = Math.max(1, columnCount);
          const rowCount = Math.ceil(itemCount / safeColumnCount);
          
          // Responsive cell width
          const cellWidth = (width - (safeColumnCount - 1) * GUTTER_SIZE) / safeColumnCount;
          const cellHeight = cellWidth; // Square aspect ratio for performance

          return (
             <FixedSizeGrid
                className="no-scrollbar"
                columnCount={safeColumnCount}
                columnWidth={cellWidth + GUTTER_SIZE}
                height={height}
                rowCount={rowCount}
                rowHeight={cellHeight + GUTTER_SIZE}
                width={width}
                overscanRowCount={5} // Keep more rows rendered to prevent white flickering
                onItemsRendered={({ visibleRowStopIndex }: { visibleRowStopIndex: number }) => {
                     // Check if we need to load more
                     if (hasNextPage && !isNextPageLoading) {
                         const visibleEndIndex = (visibleRowStopIndex + 1) * safeColumnCount;
                         if (visibleEndIndex >= items.length) {
                             loadNextPage(items.length, items.length + 50);
                         }
                     }
                }}
            >
                {({ columnIndex, rowIndex, style }: { columnIndex: number, rowIndex: number, style: React.CSSProperties }) => {
                    const index = rowIndex * safeColumnCount + columnIndex;
                    
                    // Adjust style for gutter
                    const itemStyle = {
                        ...style,
                        width: cellWidth,
                        height: cellHeight,
                        left: Number(style.left),
                        top: Number(style.top),
                    };

                    if (index >= itemCount) return null;
                    
                    if (!isItemLoaded(index)) {
                        return (
                            <div style={itemStyle} className="bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse flex items-center justify-center">
                                <Icons.Image className="text-gray-300 dark:text-gray-700" />
                            </div>
                        );
                    }
                    
                    const item = items[index];
                    if (!item) return null; // Safety

                    return (
                        <div style={itemStyle}>
                            <MediaCard 
                                item={item} 
                                onClick={onItemClick} 
                                layout="grid" 
                                isVirtual={true}
                            />
                        </div>
                    );
                }}
            </FixedSizeGrid>
          );
        }}
      </AutoSizer>
    </div>
  );
};