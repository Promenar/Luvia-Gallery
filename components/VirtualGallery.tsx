
import React, { useMemo, useRef, useEffect, useState } from 'react';
import * as ReactWindow from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { MediaItem } from '../types';
import { MediaCard } from './PhotoCard';
import { Icons } from './ui/Icon';
import { groupMediaByDate } from '../utils/fileUtils';
import { TimelineScrubber } from './TimelineScrubber';

// Workaround for potential type definition mismatch or missing types for named export
const FixedSizeGrid = (ReactWindow as any).FixedSizeGrid;
const VariableSizeList = (ReactWindow as any).VariableSizeList;

interface VirtualGalleryProps {
  items: MediaItem[];
  onItemClick: (item: MediaItem) => void;
  // Infinite scroll props
  hasNextPage: boolean;
  isNextPageLoading: boolean;
  loadNextPage: (startIndex: number, stopIndex: number) => Promise<void> | void;
  itemCount: number; // Total count if known, or items.length
  layout: 'grid' | 'masonry' | 'timeline';
}

interface VisualRow {
  type: 'header' | 'media';
  date?: string; // For header
  items?: MediaItem[]; // For media
  height?: number; // Pre-calculated height if needed
}

// Inner component for Timeline to handle width-dependent memoization
const InnerTimeline: React.FC<{
  width: number;
  height: number;
  items: MediaItem[];
  onItemClick: (item: MediaItem) => void;
  hasNextPage: boolean;
  isNextPageLoading: boolean;
  loadNextPage: (start: number, stop: number) => void;
}> = ({ width, height, items, onItemClick, hasNextPage, isNextPageLoading, loadNextPage }) => {
  const listRef = useRef<any>(null);

  // Critical Fix: Reset cached row measurements when width changes.
  // Without this, resizing (or mobile orientation change) keeps old row heights/offsets,
  // causing content to overlap or gap significantly.
  useEffect(() => {
    if (listRef.current) {
      listRef.current.resetAfterIndex(0);
    }
  }, [width, items.length]);

  // Constants
  const GUTTER_SIZE = 2; // Tighter gap for mobile
  // Dynamic column sizing
  const MIN_COL_WIDTH = width < 640 ? 90 : 150; 
  // Overlay mode: don't deduct scrubber width from calculation, just pad the container
  const SCRUBBER_WIDTH = 0; 
  const availWidth = width - SCRUBBER_WIDTH; 
  
  const columnCount = Math.floor((availWidth + GUTTER_SIZE) / (MIN_COL_WIDTH + GUTTER_SIZE)) || 1;
  const safeCols = Math.max(3, columnCount); // Ensure at least 3 columns for density on mobile
  
  const cellWidth = (availWidth - (safeCols - 1) * GUTTER_SIZE) / safeCols;
  const cellHeight = cellWidth; // Square aspect ratio

  // 1. Group Data (Memoized on items only)
  const { groups, groupKeys } = useMemo(() => {
      const g = groupMediaByDate(items);
      return { groups: g, groupKeys: Object.keys(g) };
  }, [items]);

  // 2. Build Visual Rows (Memoized on items AND width/columns)
  const { visualRows, groupIndices } = useMemo(() => {
      const rows: VisualRow[] = [];
      const indices: Record<number, number> = {};

      groupKeys.forEach((key, gIdx) => {
          indices[gIdx] = rows.length;
          rows.push({ type: 'header', date: key });
          
          const groupItems = groups[key];
          for (let i = 0; i < groupItems.length; i += safeCols) {
             const chunk = groupItems.slice(i, i + safeCols);
             rows.push({ type: 'media', items: chunk });
          }
      });
      return { visualRows: rows, groupIndices: indices };
  }, [groups, groupKeys, safeCols]); 

  const getItemSize = (index: number) => {
      const row = visualRows[index];
      return row?.type === 'header' ? 50 : cellHeight + GUTTER_SIZE;
  };

  if (width === 0) return null;

  return (
    <>
      <VariableSizeList
          ref={listRef}
          className="no-scrollbar pl-1 pr-6 md:pr-8" // Right padding ensures content doesn't go under the scrubber
          height={height}
          width={width}
          itemCount={visualRows.length}
          itemSize={getItemSize}
          overscanCount={5}
          onItemsRendered={({ visibleStopIndex }: { visibleStopIndex: number }) => {
              if (hasNextPage && !isNextPageLoading) {
                  if (visibleStopIndex >= visualRows.length - 10) {
                      loadNextPage(items.length, items.length + 50);
                  }
              }
          }}
      >
          {({ index, style }: { index: number, style: React.CSSProperties }) => {
              const row = visualRows[index];
              if (!row) return null;

              // Adjust width in style to account for padding manually if needed, 
              // but standard block flow usually handles it. 
              // We explicitly set width to avoid overflow if scrollbar logic interferes.
              const rowStyle = {
                  ...style,
                  width: width - (width < 640 ? 24 : 32) // manual padding adjustment for inner content
              };

              if (row.type === 'header') {
                  const date = new Date(row.date + '-01');
                  const monthName = date.toLocaleDateString('default', { month: 'long' });
                  const year = date.getFullYear();
                  
                  return (
                      <div style={rowStyle} className="flex items-end pb-2 pt-4 px-1 z-10 pointer-events-none">
                          <div className="font-medium text-sm text-gray-500 dark:text-gray-400 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm px-3 py-1 rounded-full shadow-sm border border-gray-100 dark:border-gray-800">
                              <span className="text-gray-900 dark:text-white font-bold mr-1">{monthName}</span>
                              <span>{year}</span>
                          </div>
                      </div>
                  );
              } else {
                  return (
                      <div style={rowStyle} className="flex gap-[2px]">
                          {row.items?.map(item => (
                              <div key={item.id} style={{ width: cellWidth, height: cellHeight }}>
                                  <MediaCard 
                                      item={item} 
                                      onClick={onItemClick} 
                                      layout="grid" 
                                      isVirtual={true}
                                  />
                              </div>
                          ))}
                      </div>
                  );
              }
          }}
      </VariableSizeList>

      {/* Scrubber Overlay */}
      <TimelineScrubber 
          groups={groupKeys} 
          height={height}
          onScrollTo={(gIndex) => {
              const rowIndex = groupIndices[gIndex];
              if (listRef.current && rowIndex !== undefined) {
                  listRef.current.scrollToItem(rowIndex, 'start');
              }
          }} 
      />
    </>
  );
};

export const VirtualGallery: React.FC<VirtualGalleryProps> = ({ 
  items, 
  onItemClick,
  hasNextPage,
  isNextPageLoading,
  loadNextPage,
  itemCount,
  layout
}) => {
  
  // -- MASONRY LAYOUT --
  const columns = useMemo(() => {
    if (layout !== 'masonry') return [];
    
    const width = typeof window !== 'undefined' ? window.innerWidth : 1200;
    let numCols = 2;
    if (width >= 640) numCols = 3;
    if (width >= 1024) numCols = 4;
    if (width >= 1280) numCols = 5;

    const cols: MediaItem[][] = Array.from({ length: numCols }, () => []);
    items.forEach((item, i) => {
        cols[i % numCols].push(item);
    });
    
    return cols;
  }, [items, layout]);

  if (layout === 'masonry') {
      return (
          <div className="w-full h-full overflow-y-auto pb-20 no-scrollbar">
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

  // -- TIMELINE LAYOUT --
  if (layout === 'timeline') {
    return (
      <div className="w-full h-full relative">
        <AutoSizer>
          {({ height, width }: { height: number, width: number }) => (
             <InnerTimeline 
                width={width} 
                height={height} 
                items={items} 
                onItemClick={onItemClick} 
                hasNextPage={hasNextPage} 
                isNextPageLoading={isNextPageLoading} 
                loadNextPage={loadNextPage} 
             />
          )}
        </AutoSizer>
      </div>
    );
  }

  // -- GRID LAYOUT --
  // Standard grid fallback
  const GUTTER_SIZE = 16;
  const COLUMN_WIDTH = 200;

  const isItemLoaded = (index: number) => !hasNextPage || index < items.length;

  return (
    <div className="flex-1 w-full h-full">
      <AutoSizer>
        {({ height, width }: { height: number, width: number }) => {
          const columnCount = Math.floor((width + GUTTER_SIZE) / (COLUMN_WIDTH + GUTTER_SIZE));
          const safeColumnCount = Math.max(1, columnCount);
          const rowCount = Math.ceil(itemCount / safeColumnCount);
          const cellWidth = (width - (safeColumnCount - 1) * GUTTER_SIZE) / safeColumnCount;
          const cellHeight = cellWidth;

          return (
             <FixedSizeGrid
                className="no-scrollbar"
                columnCount={safeColumnCount}
                columnWidth={cellWidth + GUTTER_SIZE}
                height={height}
                rowCount={rowCount}
                rowHeight={cellHeight + GUTTER_SIZE}
                width={width}
                overscanRowCount={5}
                onItemsRendered={({ visibleRowStopIndex }: { visibleRowStopIndex: number }) => {
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
                    const itemStyle = { ...style, width: cellWidth, height: cellHeight, left: Number(style.left), top: Number(style.top) };

                    if (index >= itemCount) return null;
                    if (!isItemLoaded(index)) {
                        return (
                            <div style={itemStyle} className="bg-gray-200 dark:bg-gray-800 rounded-xl animate-pulse flex items-center justify-center">
                                <Icons.Image className="text-gray-300 dark:text-gray-700" />
                            </div>
                        );
                    }
                    return (
                        <div style={itemStyle}>
                            <MediaCard item={items[index]} onClick={onItemClick} layout="grid" isVirtual={true} />
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
