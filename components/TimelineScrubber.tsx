import React, { useState, useRef, useEffect, useMemo } from 'react';

interface TimelineScrubberProps {
  groups: string[]; // ['2023-10', '2023-09', ...]
  onScrollTo: (groupIndex: number) => void;
  height?: number; 
  className?: string;
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({ groups, onScrollTo }) => {
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [bubbleY, setBubbleY] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Extract unique years for visual markers
  // Memoized to prevent recalculation on every render
  const years = useMemo(() => {
    return groups.reduce((acc, g) => {
        const year = g.split('-')[0];
        if (!acc.includes(year)) acc.push(year);
        return acc;
    }, [] as string[]);
  }, [groups]);

  const handleInteraction = (clientY: number) => {
      if (!containerRef.current) return;
      
      const rect = containerRef.current.getBoundingClientRect();
      const relativeY = clientY - rect.top;
      
      // Clamp relativeY to container bounds for visual bubble position
      const clampedY = Math.max(0, Math.min(rect.height, relativeY));
      setBubbleY(clampedY);

      const ratio = clampedY / rect.height;
      const targetIndex = Math.floor(ratio * groups.length);
      const safeIndex = Math.min(groups.length - 1, Math.max(0, targetIndex));
      
      const group = groups[safeIndex];
      if (group) {
        const date = new Date(group + '-01');
        const label = date.toLocaleDateString('default', { month: 'short', year: 'numeric' });
        setActiveLabel(label);
        onScrollTo(safeIndex);
      }
  };

  const onStart = (e: React.MouseEvent | React.TouchEvent) => {
      setIsInteracting(true);
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      handleInteraction(clientY);
  };

  const onMove = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isInteracting) return;
      if (e.cancelable && 'touches' in e) e.preventDefault(); // Prevent page scroll
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      handleInteraction(clientY);
  };

  const onEnd = () => {
      setIsInteracting(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
          setActiveLabel(null);
      }, 500);
  };

  // Global listeners ensure dragging continues even if finger/mouse leaves the narrow element
  useEffect(() => {
      if (isInteracting) {
          const handleMove = (e: Event) => onMove(e as unknown as React.MouseEvent);
          const handleEnd = () => onEnd();

          window.addEventListener('mousemove', handleMove);
          window.addEventListener('mouseup', handleEnd);
          window.addEventListener('touchmove', handleMove, { passive: false });
          window.addEventListener('touchend', handleEnd);
          
          return () => {
              window.removeEventListener('mousemove', handleMove);
              window.removeEventListener('mouseup', handleEnd);
              window.removeEventListener('touchmove', handleMove);
              window.removeEventListener('touchend', handleEnd);
          };
      }
  }, [isInteracting, groups]);

  if (groups.length === 0) return null;

  return (
    <>
        <div 
            ref={containerRef}
            className="absolute top-8 bottom-4 right-0 w-8 z-40 flex flex-col items-center justify-between py-2 select-none touch-none"
            onMouseDown={onStart}
            onTouchStart={onStart}
        >
            {/* Invisible expanded hit area for easier grabbing */}
            <div className="absolute inset-0 w-12 -right-2 z-10" />

            {/* Year Markers (Visual Only) */}
            <div className="flex flex-col justify-between h-full w-full items-center pointer-events-none opacity-50">
                {years.map((year, i) => (
                    <div key={year} className="text-[10px] font-bold text-gray-400 dark:text-gray-600">
                        {year}
                    </div>
                ))}
            </div>
        </div>

        {/* Pop-out Date Bubble */}
        {activeLabel && (
             <div 
                className="absolute right-10 z-50 pointer-events-none transition-all duration-75 ease-out"
                style={{ top: bubbleY + 32 }} // Add top offset to match container start
             >
                 <div className="bg-white dark:bg-gray-800 text-primary-600 dark:text-primary-400 shadow-xl rounded-full px-4 py-2 font-bold text-sm border border-gray-100 dark:border-gray-700 flex items-center gap-2 whitespace-nowrap -translate-y-1/2 animate-in fade-in slide-in-from-right-4 duration-200">
                     {activeLabel}
                     {/* Triangle pointer */}
                     <div className="absolute right-[-5px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white dark:bg-gray-800 border-r border-t border-gray-100 dark:border-gray-700 transform rotate-45 rounded-sm" />
                 </div>
             </div>
        )}
    </>
  );
};