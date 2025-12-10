import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
// @ts-ignore - exifr is loaded via importmap
import exifr from 'exifr';
import { MediaItem, ExifData } from '../types';
import { Icons } from './ui/Icon';

interface ImageViewerProps {
  item: MediaItem | null;
  onClose: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onDelete?: (item: MediaItem) => void;
  onRename?: (item: MediaItem, newName: string) => void;
  onJumpToFolder?: (item: MediaItem) => void;
}

interface TransformState {
  scale: number;
  x: number;
  y: number;
}

export const ImageViewer: React.FC<ImageViewerProps> = ({ item, onClose, onNext, onPrev, onDelete, onRename, onJumpToFolder }) => {
  const [transform, setTransform] = useState<TransformState>({ scale: 1, x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dragConstraints, setDragConstraints] = useState<{ left: number, right: number, top: number, bottom: number } | null>(null);
  
  // Slideshow State
  const [isPlaying, setIsPlaying] = useState(false);
  const slideshowIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Video Controls
  const [playbackRate, setPlaybackRate] = useState(1.0);

  // Info Panel
  const [showInfo, setShowInfo] = useState(false);
  const [exifData, setExifData] = useState<ExifData | null>(null);
  const [isExifLoading, setIsExifLoading] = useState(false);

  // Pinch zoom state
  const lastDist = useRef<number | null>(null);

  // Rename State
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  // Reset state when item changes
  useEffect(() => {
    setTransform({ scale: 1, x: 0, y: 0 });
    setDragConstraints(null);
    lastDist.current = null;
    setIsRenaming(false);
    setPlaybackRate(1.0);
    // Don't reset showInfo preferably, but user might want it closed on next
    // Clear EXIF
    setExifData(null);
  }, [item?.id]);

  // Handle Video Speed Change
  useEffect(() => {
    if (videoRef.current) {
        videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, item]);

  // EXIF Parsing Logic
  useEffect(() => {
      if (showInfo && item && item.mediaType === 'image') {
          const fetchExif = async () => {
              setIsExifLoading(true);
              try {
                  // exifr can parse File object (Client Mode) or URL (Server Mode)
                  // It uses Range requests for URLs to be efficient
                  const input = item.file || item.url;
                  const output = await exifr.parse(input, {
                      // Only fetch fields we care about to save bandwidth/time
                      pick: ['Make', 'Model', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'LensModel', 'DateTimeOriginal', 'ExifImageWidth', 'ExifImageHeight'],
                      tiff: true,
                      exif: true,
                  });
                  setExifData(output);
              } catch (e) {
                  console.warn("Failed to parse EXIF", e);
                  setExifData(null);
              } finally {
                  setIsExifLoading(false);
              }
          };
          fetchExif();
      }
  }, [showInfo, item]);


  // Slideshow Logic
  useEffect(() => {
    if (isPlaying) {
      slideshowIntervalRef.current = setInterval(() => {
        if (onNext) onNext();
      }, 4000); // 4 seconds per slide
    } else {
      if (slideshowIntervalRef.current) clearInterval(slideshowIntervalRef.current);
    }
    return () => {
      if (slideshowIntervalRef.current) clearInterval(slideshowIntervalRef.current);
    };
  }, [isPlaying, onNext]);

  // Stop playing if closed or zoomed
  useEffect(() => {
      if (transform.scale > 1) setIsPlaying(false);
  }, [transform.scale]);

  // Update drag constraints when scale changes
  useEffect(() => {
    if (transform.scale === 1) {
      setDragConstraints(null);
      return;
    }

    const updateConstraints = () => {
      if (!containerRef.current) return;
      // Calculate allowed drag range based on viewport size and scale
      const { width, height } = containerRef.current.getBoundingClientRect();
      const xLimit = (width * transform.scale - width) / 2;
      const yLimit = (height * transform.scale - height) / 2;
      
      setDragConstraints({
        left: -xLimit,
        right: xLimit,
        top: -yLimit,
        bottom: yLimit
      });
    };

    updateConstraints();
    window.addEventListener('resize', updateConstraints);
    return () => window.removeEventListener('resize', updateConstraints);
  }, [transform.scale]);

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!item) return;
      if (isRenaming) return; // Don't handle nav keys while typing
      
      if (e.key === 'Escape') onClose();
      // Only allow navigation if not zoomed in
      if (transform.scale === 1) {
          if (e.key === 'ArrowRight' && onNext) {
            setIsPlaying(false); // Stop autoplay on manual nav
            onNext();
          }
          if (e.key === 'ArrowLeft' && onPrev) {
            setIsPlaying(false);
            onPrev();
          }
          if (e.key === ' ' || e.key === 'Spacebar') {
             e.preventDefault();
             if (item.mediaType === 'video' && videoRef.current) {
                 if (videoRef.current.paused) videoRef.current.play();
                 else videoRef.current.pause();
             } else {
                 setIsPlaying(prev => !prev);
             }
          }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [item, onClose, onNext, onPrev, transform.scale, isRenaming]);

  if (!item) return null;

  const handleWheel = (e: React.WheelEvent) => {
    if (item.mediaType === 'video' || item.mediaType === 'audio') return;
    
    // Check if we are zooming
    if (e.ctrlKey || Math.abs(e.deltaY) > 0) {
        setIsPlaying(false);
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        // Mouse position relative to center of the container
        const pointerX = e.clientX - rect.left - rect.width / 2;
        const pointerY = e.clientY - rect.top - rect.height / 2;

        const delta = -e.deltaY * 0.002;
        const targetScale = Math.min(Math.max(1, transform.scale + delta), 5);
        
        const ratio = targetScale / transform.scale;
        
        let newX = pointerX - (pointerX - transform.x) * ratio;
        let newY = pointerY - (pointerY - transform.y) * ratio;

        const xLimit = (rect.width * targetScale - rect.width) / 2;
        const yLimit = (rect.height * targetScale - rect.height) / 2;
        
        if (targetScale === 1) {
            newX = 0;
            newY = 0;
        } else {
            if (newX > xLimit) newX = xLimit;
            if (newX < -xLimit) newX = -xLimit;
            if (newY > yLimit) newY = yLimit;
            if (newY < -yLimit) newY = -yLimit;
        }

        setTransform({
            scale: targetScale,
            x: newX,
            y: newY
        });
    }
  };

  const handleDrag = (event: any, info: PanInfo) => {
      setTransform(prev => ({
          ...prev,
          x: prev.x + info.delta.x,
          y: prev.y + info.delta.y
      }));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      lastDist.current = dist;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastDist.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const delta = dist - lastDist.current;
      const sensitivity = 0.01;
      const newScale = Math.min(Math.max(1, transform.scale + delta * sensitivity), 5);
      
      setTransform(prev => ({
          ...prev,
          scale: newScale,
          x: newScale === 1 ? 0 : prev.x,
          y: newScale === 1 ? 0 : prev.y
      }));
      lastDist.current = dist;
    }
  };

  const handleTouchEnd = () => {
    lastDist.current = null;
  };

  const toggleZoom = (e: React.MouseEvent) => {
      e.stopPropagation();
      setIsPlaying(false);
      if (transform.scale > 1) {
          setTransform({ scale: 1, x: 0, y: 0 });
      } else {
          // Zoom to 2.5x at the clicked position
          const container = containerRef.current;
          if (container) {
              const rect = container.getBoundingClientRect();
              const pointerX = e.clientX - rect.left - rect.width / 2;
              const pointerY = e.clientY - rect.top - rect.height / 2;
              
              const targetScale = 2.5;
              const ratio = targetScale / 1;
              
              const newX = pointerX - (pointerX - 0) * ratio;
              const newY = pointerY - (pointerY - 0) * ratio;

              setTransform({ scale: targetScale, x: newX, y: newY });
          } else {
              setTransform({ scale: 2.5, x: 0, y: 0 });
          }
      }
  };

  const handleStartRename = (e: React.MouseEvent) => {
      e.stopPropagation();
      setRenameValue(item.name);
      setIsRenaming(true);
  };

  const submitRename = () => {
      if (onRename && renameValue.trim() && renameValue !== item.name) {
          onRename(item, renameValue.trim());
      }
      setIsRenaming(false);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onDelete && window.confirm(`Are you sure you want to delete ${item.name}?`)) {
          onDelete(item);
      }
  };

  const handleJumpClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onJumpToFolder) {
          onJumpToFolder(item);
          onClose();
      }
  };

  const formatDate = (ts: number | Date | undefined) => {
      if (!ts) return '-';
      return new Date(ts).toLocaleString();
  };

  const formatSize = (bytes: number) => {
      const mb = bytes / 1024 / 1024;
      return mb < 1 ? `${(bytes / 1024).toFixed(1)} KB` : `${mb.toFixed(1)} MB`;
  };

  const formatExposure = (t: number | undefined) => {
      if (!t) return '-';
      if (t >= 1) return t + 's';
      return '1/' + Math.round(1/t);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/95 backdrop-blur-sm flex items-center justify-center overflow-hidden"
        onClick={onClose}
        onWheel={handleWheel}
      >
        {/* Controls Overlay */}
        <div className="absolute top-0 left-0 right-0 p-4 flex justify-between items-center text-white/80 z-50 pointer-events-none bg-gradient-to-b from-black/70 to-transparent">
          <div className="flex flex-col max-w-[50%] pointer-events-auto">
            {isRenaming ? (
                 <input 
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => { if(e.key === 'Enter') submitRename(); if(e.key === 'Escape') setIsRenaming(false); }}
                    onBlur={submitRename}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-white/10 text-white border-b border-white outline-none p-1 rounded"
                 />
            ) : (
                 <span className="font-medium text-lg truncate flex items-center gap-2">
                     {item.name}
                     {onRename && <button onClick={handleStartRename} className="p-1 hover:bg-white/20 rounded opacity-50 hover:opacity-100"><Icons.Edit size={14}/></button>}
                 </span>
            )}
            <span className="text-xs opacity-60 truncate">{item.folderPath || 'Root'}</span>
          </div>
          <div className="flex items-center gap-2 pointer-events-auto">
             {/* Info Button */}
             <button
                onClick={(e) => { e.stopPropagation(); setShowInfo(!showInfo); }}
                className={`p-2 rounded-full transition-colors ${showInfo ? 'bg-white/20' : 'hover:bg-white/10'}`}
                title="File Info"
             >
                 <Icons.Info size={20} />
             </button>

             {onJumpToFolder && (
                 <button 
                    onClick={handleJumpClick}
                    className="p-2 hover:bg-white/10 rounded-full transition-colors block"
                    title="Jump to Folder"
                 >
                     <Icons.Jump size={20} />
                 </button>
             )}
             {onDelete && (
                 <button 
                    onClick={handleDeleteClick}
                    className="p-2 hover:bg-red-900/50 hover:text-red-400 rounded-full transition-colors mr-2"
                    title="Delete File"
                 >
                     <Icons.Trash size={20} />
                 </button>
             )}
             {onNext && item.mediaType === 'image' && (
                 <button 
                    onClick={(e) => { e.stopPropagation(); setIsPlaying(!isPlaying); }}
                    className={`p-2 rounded-full transition-colors ${isPlaying ? 'bg-primary-600 text-white' : 'hover:bg-white/10'}`}
                    title={isPlaying ? "Pause Slideshow" : "Play Slideshow"}
                 >
                     {isPlaying ? <Icons.Pause size={24} /> : <Icons.Play size={24} />}
                 </button>
             )}
            {item.mediaType === 'image' && (
                <button 
                  onClick={(e) => { 
                      e.stopPropagation(); 
                      setTransform(prev => prev.scale > 1 ? { scale: 1, x: 0, y: 0 } : { scale: 2.5, x: 0, y: 0 }); 
                  }}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors hidden md:block"
                  title={transform.scale > 1 ? "Zoom Out" : "Zoom In"}
                >
                  {transform.scale > 1 ? <Icons.ZoomOut size={24} /> : <Icons.ZoomIn size={24} />}
                </button>
            )}
            <button 
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <Icons.Close size={24} />
            </button>
          </div>
        </div>
        
        {/* Info Panel Overlay */}
        <AnimatePresence>
            {showInfo && (
                <motion.div
                    initial={{ x: '100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '100%' }}
                    className="absolute top-0 right-0 bottom-0 w-80 bg-black/80 backdrop-blur-md z-40 p-6 pt-20 border-l border-white/10 text-white overflow-y-auto"
                    onClick={(e) => e.stopPropagation()}
                >
                    <h3 className="text-xl font-bold mb-6 flex items-center gap-2"><Icons.Info size={20}/> Info</h3>
                    <div className="space-y-6 text-sm">
                        <section>
                            <h4 className="text-white/60 text-xs font-bold uppercase tracking-wider mb-3 border-b border-white/10 pb-1">File Details</h4>
                            <div className="space-y-3">
                                <div>
                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">Name</p>
                                    <p className="font-medium break-all">{item.name}</p>
                                </div>
                                <div>
                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">Path</p>
                                    <p className="text-white/80 break-all text-xs font-mono">{item.path}</p>
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">Size</p>
                                        <p className="text-white/80">{formatSize(item.size)}</p>
                                    </div>
                                    <div>
                                        <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">Type</p>
                                        <p className="text-white/80">{item.mediaType.toUpperCase()}</p>
                                    </div>
                                </div>
                                <div>
                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">Date Modified</p>
                                    <p className="text-white/80">{formatDate(item.lastModified)}</p>
                                </div>
                            </div>
                        </section>

                        {/* EXIF Section */}
                        {item.mediaType === 'image' && (
                             <section>
                                <h4 className="text-white/60 text-xs font-bold uppercase tracking-wider mb-3 border-b border-white/10 pb-1 mt-6">Camera Details</h4>
                                {isExifLoading ? (
                                    <div className="flex items-center gap-2 text-white/50 text-xs">
                                        <Icons.Loader size={12} className="animate-spin" /> Loading metadata...
                                    </div>
                                ) : exifData ? (
                                    <div className="space-y-3">
                                        {(exifData.Make || exifData.Model) && (
                                            <div>
                                                <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">Camera</p>
                                                <p className="text-white/80">{exifData.Make} {exifData.Model}</p>
                                            </div>
                                        )}
                                        {exifData.LensModel && (
                                            <div>
                                                <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">Lens</p>
                                                <p className="text-white/80">{exifData.LensModel}</p>
                                            </div>
                                        )}
                                        <div className="grid grid-cols-2 gap-4">
                                            {exifData.FNumber && (
                                                <div>
                                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">Aperture</p>
                                                    <p className="text-white/80">f/{exifData.FNumber}</p>
                                                </div>
                                            )}
                                            {exifData.ExposureTime && (
                                                <div>
                                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">Shutter</p>
                                                    <p className="text-white/80">{formatExposure(exifData.ExposureTime)}</p>
                                                </div>
                                            )}
                                            {exifData.ISO && (
                                                <div>
                                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">ISO</p>
                                                    <p className="text-white/80">{exifData.ISO}</p>
                                                </div>
                                            )}
                                            {exifData.FocalLength && (
                                                <div>
                                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">Focal Length</p>
                                                    <p className="text-white/80">{exifData.FocalLength}mm</p>
                                                </div>
                                            )}
                                             {(exifData.width || exifData.height) && (
                                                <div>
                                                    <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">Dimensions</p>
                                                    <p className="text-white/80">{exifData.width || '?'} x {exifData.height || '?'}</p>
                                                </div>
                                            )}
                                        </div>
                                         {exifData.DateTimeOriginal && (
                                            <div>
                                                <p className="text-white/40 uppercase text-[10px] tracking-wider mb-0.5">Date Taken</p>
                                                <p className="text-white/80">{formatDate(exifData.DateTimeOriginal)}</p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-xs text-white/40 italic">No EXIF data found.</p>
                                )}
                             </section>
                        )}
                    </div>
                </motion.div>
            )}
        </AnimatePresence>

        {/* Content Container */}
        <div 
          ref={containerRef}
          className={`relative w-full h-full flex items-center justify-center transition-all duration-300 ${transform.scale === 1 ? 'p-4 md:p-10' : 'p-0'}`}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {item.mediaType === 'video' ? (
            <div className="w-full h-full flex flex-col items-center justify-center relative group" onClick={(e) => e.stopPropagation()}>
                <video 
                  ref={videoRef}
                  src={item.url}
                  controls
                  autoPlay
                  onEnded={() => { if(isPlaying && onNext) onNext(); }}
                  className="max-w-full max-h-full shadow-2xl rounded-sm focus:outline-none"
                />
                {/* Custom Video Controls overlay for Speed */}
                <div className="absolute top-1/2 right-4 -translate-y-1/2 bg-black/60 rounded-lg backdrop-blur px-2 py-3 flex flex-col items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Icons.Clock size={16} className="text-white/70 mb-1" />
                    {[0.5, 1.0, 1.5, 2.0].map(speed => (
                        <button 
                            key={speed}
                            onClick={() => setPlaybackRate(speed)}
                            className={`text-xs font-bold w-full text-center hover:text-primary-400 ${playbackRate === speed ? 'text-primary-400' : 'text-white/60'}`}
                        >
                            {speed}x
                        </button>
                    ))}
                </div>
            </div>
          ) : item.mediaType === 'audio' ? (
             <div className="w-full max-w-md bg-white/10 backdrop-blur-md p-8 rounded-3xl flex flex-col items-center gap-6" onClick={(e) => e.stopPropagation()}>
                 <div className="w-48 h-48 bg-gradient-to-br from-pink-500 to-orange-400 rounded-2xl flex items-center justify-center shadow-2xl">
                     <Icons.Music size={80} className="text-white" />
                 </div>
                 <div className="text-center w-full">
                     <h3 className="text-white text-xl font-bold truncate mb-1">{item.name}</h3>
                     <p className="text-white/60 text-sm">{item.folderPath}</p>
                 </div>
                 <audio 
                    src={item.url}
                    controls
                    autoPlay
                    onEnded={() => { if(isPlaying && onNext) onNext(); }}
                    className="w-full"
                 />
             </div>
          ) : (
            <motion.img
              src={item.url}
              alt={item.name}
              className="max-w-full max-h-full object-contain shadow-2xl rounded-sm"
              style={{ cursor: transform.scale > 1 ? 'grab' : 'zoom-in' }}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={toggleZoom}
              
              // Smooth Zoom Animation
              animate={{ 
                  scale: transform.scale,
                  x: transform.x,
                  y: transform.y 
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}

              // Pan Dragging
              drag={transform.scale > 1}
              dragConstraints={dragConstraints || undefined}
              dragElastic={0.05}
              dragMomentum={false} // Disable momentum to prevent conflict with state sync
              onDrag={handleDrag}
              whileDrag={{ cursor: 'grabbing' }}
            />
          )}
        </div>

        {/* Navigation Overlays (Hidden when zoomed) */}
        {transform.scale === 1 && onPrev && (
           <button
             className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-all opacity-0 hover:opacity-100 md:opacity-100 z-50 pointer-events-auto"
             onClick={(e) => { e.stopPropagation(); setIsPlaying(false); onPrev(); }}
           >
             <Icons.Back size={24} />
           </button>
        )}
        
        {transform.scale === 1 && onNext && (
           <button
             className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full backdrop-blur-md transition-all opacity-0 hover:opacity-100 md:opacity-100 rotate-180 z-50 pointer-events-auto"
             onClick={(e) => { e.stopPropagation(); setIsPlaying(false); onNext(); }}
           >
             <Icons.Back size={24} />
           </button>
        )}
      </motion.div>
    </AnimatePresence>
  );
};