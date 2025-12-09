import React from 'react';
import { FixedSizeGrid as Grid } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import InfiniteLoader from 'react-window-infinite-loader';
import { MediaItem } from '../types';
import { MediaCard } from './PhotoCard';
import { Icons } from './ui/Icon';

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
  
  // -- MASONRY LAYOUT (Standard CSS Columns with content-visibility for performance) --
  // This is better for "Client Mode" or smaller sets where aesthetic aspect ratios matter.
  // We use content-visibility: auto to prevent rendering offscreen items.
  if (layout === 'masonry') {
      return (
          <div className="w-full h-full pb-20">
              <div style={{ contentVisibility: 'auto', containIntrinsicSize: '1000px' }} className="columns-2 md:columns-3 lg:columns-4 xl:columns-5 gap-4 space-y-4 p-1">
                  {items.map((item) => (
                      <div key={item.id} className="break-inside-avoid mb-4" style={{ willChange: 'transform' }}>
                          <MediaCard 
                              item={item} 
                              onClick={onItemClick} 
                              layout="masonry"
                              isVirtual={false} 
                          />
                      </div>
                  ))}
                  {/* Load More Sentinel */}
                  {hasNextPage && (
                      <div className="w-full py-8 flex justify-center items-center break-inside-avoid">
                         <button 
                             onClick={() => loadNextPage(items.length, items.length + 50)} 
                             className="px-6 py-2 bg-gray-100 dark:bg-gray-800 rounded-full text-sm font-medium text-gray-500"
                             disabled={isNextPageLoading}
                         >
                             {isNextPageLoading ? 'Loading more...' : 'Load More'}
                         </button>
                      </div>
                  )}
              </div>
          </div>
      );
  }

  // -- VIRTUAL GRID LAYOUT (React-Window) --
  // Best for "Server Mode" with 100k+ items. 
  // Forces strict squares but extremely fast.

  const GUTTER_SIZE = 16;
  const COLUMN_WIDTH = 250; // Minimum width, will scale

  // Infinite Loader Logic
  // InfiniteLoader works with lists. We need to map grid indices to list indices.
  const loadMoreItems = isNextPageLoading ? () => {} : loadNextPage;
  
  // If there are more items to load, we add a placeholder row count
  const totalItems = hasNextPage ? itemCount + 100 : itemCount;
  
  const isItemLoaded = (index: number) => !hasNextPage || index < items.length;

  return (
    <div className="flex-1 w-full h-full">
      <AutoSizer>
        {({ height, width }) => {
          // Calculate columns based on width
          const columnCount = Math.floor((width + GUTTER_SIZE) / (COLUMN_WIDTH + GUTTER_SIZE));
          const safeColumnCount = Math.max(1, columnCount);
          const rowCount = Math.ceil(totalItems / safeColumnCount);
          
          // Responsive cell width
          const cellWidth = (width - (safeColumnCount - 1) * GUTTER_SIZE) / safeColumnCount;
          const cellHeight = cellWidth; // Square aspect ratio for performance

          return (
            <InfiniteLoader
                isItemLoaded={isItemLoaded}
                itemCount={totalItems}
                loadMoreItems={loadMoreItems}
                threshold={4} // Increased threshold for smoother scrolling
            >
                {({ onItemsRendered, ref }) => (
                     <Grid
                        className="no-scrollbar"
                        columnCount={safeColumnCount}
                        columnWidth={cellWidth + GUTTER_SIZE}
                        height={height}
                        rowCount={rowCount}
                        rowHeight={cellHeight + GUTTER_SIZE}
                        width={width}
                        ref={ref}
                        overscanRowCount={5} // Keep more rows rendered to prevent white flickering
                        onItemsRendered={({ visibleRowStartIndex, visibleRowStopIndex, visibleColumnStartIndex, visibleColumnStopIndex }) => {
                            // Convert grid range to list range for infinite loader
                            const visibleStartIndex = visibleRowStartIndex * safeColumnCount + visibleColumnStartIndex;
                            const visibleStopIndex = visibleRowStopIndex * safeColumnCount + visibleColumnStopIndex;
                            onItemsRendered({
                                visibleStartIndex,
                                visibleStopIndex
                            });
                        }}
                    >
                        {({ columnIndex, rowIndex, style }) => {
                            const index = rowIndex * safeColumnCount + columnIndex;
                            
                            // Adjust style for gutter
                            const itemStyle = {
                                ...style,
                                width: cellWidth,
                                height: cellHeight,
                                left: Number(style.left),
                                top: Number(style.top),
                            };

                            if (index >= totalItems) return null;
                            
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
                    </Grid>
                )}
            </InfiniteLoader>
          );
        }}
      </AutoSizer>
    </div>
  );
};