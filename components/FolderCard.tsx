
import React, { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderNode, MediaItem } from '../types';
import { getAuthUrl } from '../utils/fileUtils';
import { Icons } from './ui/Icon';
import { Card } from './ui/Card';

interface FolderCardProps {
    folder: {
        name: string;
        path: string;
        children: Record<string, FolderNode>;
        mediaCount: number;
        coverMedia?: MediaItem;
    };
    onClick: (path: string) => void;
    isFavorite?: boolean;
    onToggleFavorite?: (path: string) => void;
    onRename?: (oldPath: string, newPath: string) => void;
    onDelete?: (path: string) => void;
    onRegenerate?: (path: string) => void;
    layout?: 'grid' | 'masonry';
    animate?: boolean;
}

export const FolderCard: React.FC<FolderCardProps> = React.memo(({ folder, onClick, isFavorite, onToggleFavorite, onRename, onDelete, onRegenerate, animate = true, layout = 'grid' }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [showMenu, setShowMenu] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [imgError, setImgError] = useState(false);

    // Resolve thumbnail URL for cover
    const thumbUrl = useMemo(() => {
        if (!folder.coverMedia || !folder.coverMedia.url) return null;
        if (folder.coverMedia.thumbnailUrl) {
            return getAuthUrl(folder.coverMedia.thumbnailUrl);
        }
        if (folder.coverMedia.url.startsWith('/media-stream/')) {
            const pathPart = folder.coverMedia.url.split('/media-stream/')[1];
            return getAuthUrl(`/api/thumbnail?path=${pathPart}`);
        }
        if (folder.coverMedia.mediaType === 'image' || folder.coverMedia.mediaType === 'video') {
            return getAuthUrl(folder.coverMedia.url);
        }
        return null;
    }, [folder.coverMedia]);

    const handleMouseEnter = () => {
        if (folder.coverMedia?.mediaType === 'video' && videoRef.current && !imgError) {
            videoRef.current.play().catch(() => { });
            setIsPlaying(true);
        }
    };

    const handleMouseLeave = () => {
        if (folder.coverMedia?.mediaType === 'video' && videoRef.current) {
            videoRef.current.pause();
            setIsPlaying(false);
        }
        setShowMenu(false);
    };

    const handleMenuClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowMenu(!showMenu);
    };

    const handleAction = (action: 'fav' | 'rename' | 'delete', e: React.MouseEvent) => {
        e.stopPropagation();
        setShowMenu(false);

        if (action === 'fav' && onToggleFavorite) {
            onToggleFavorite(folder.path);
        }
        if (action === 'rename') {
            setRenameValue(folder.name);
            setIsRenaming(true);
        }
        if (action === 'delete' && onDelete) {
            onDelete(folder.path);
        }
    };

    const submitRename = (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (onRename && renameValue.trim() && renameValue !== folder.name) {
            onRename(folder.path, renameValue.trim());
        }
        setIsRenaming(false);
    };

    return (
        <motion.div
            initial={animate ? { opacity: 0, scale: 0.95 } : { opacity: 1, scale: 1 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.98 }}
            className={`relative group cursor-pointer ${layout === 'masonry' ? 'h-full' : ''} will-change-transform`}
            onClick={() => !isRenaming && onClick(folder.path)}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* Stack Effect */}
            <div className="absolute top-1 left-1 w-full h-full bg-surface-tertiary rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 transform translate-y-1" />
            <div className="absolute top-2 left-2 w-full h-full bg-surface-secondary rounded-xl opacity-0 group-hover:opacity-60 transition-opacity duration-300 transform translate-y-2" />

            {/* Main Card */}
            <Card
                className={`relative flex flex-col z-10 ${layout === 'masonry' ? 'h-full' : ''}`}
                hover={true}
                interactive={true}
            >
                <div className={`${layout === 'masonry' ? 'flex-1 min-h-0' : 'aspect-[4/3]'} bg-surface-secondary relative overflow-hidden flex items-center justify-center w-full`}>
                    {folder.coverMedia && !imgError ? (
                        folder.coverMedia.mediaType === 'video' ? (
                            <div className="w-full h-full bg-gray-900 flex items-center justify-center group-hover:scale-105 transition-transform duration-700 relative overflow-hidden">
                                <div className="absolute inset-0 bg-gradient-to-tr from-gray-900 to-gray-700 opacity-100" />
                                {thumbUrl && (
                                    <img
                                        src={thumbUrl}
                                        alt={folder.name}
                                        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${isPlaying ? 'opacity-0' : 'opacity-100'}`}
                                        onError={() => setImgError(true)}
                                    />
                                )}
                                {!folder.coverMedia.url.includes('/api/thumb/') && (
                                    <video
                                        ref={videoRef}
                                        src={getAuthUrl(folder.coverMedia.url)}
                                        muted
                                        loop
                                        playsInline
                                        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${isPlaying ? 'opacity-100' : 'opacity-0'}`}
                                        onError={() => { }}
                                        style={{ objectFit: 'cover' }}
                                    />
                                )}
                                <div className={`absolute inset-0 flex items-center justify-center z-10 transition-opacity ${isPlaying ? 'opacity-0' : 'opacity-100'}`}>
                                    <div className="w-12 h-12 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center border border-white/20">
                                        <Icons.Video className="text-white/90" size={24} />
                                    </div>
                                </div>
                            </div>
                        ) : folder.coverMedia.mediaType === 'audio' ? (
                            <div className="w-full h-full bg-gradient-to-br from-pink-500 to-orange-400 flex items-center justify-center">
                                <Icons.Music className="text-white" size={48} />
                            </div>
                        ) : (
                            <img
                                src={getAuthUrl(thumbUrl || folder.coverMedia.url)}
                                alt={folder.name}
                                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                                onError={() => setImgError(true)}
                                style={{ objectFit: 'cover' }}
                            />
                        )
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-text-tertiary">
                            <Icons.Folder size={48} strokeWidth={1.5} />
                        </div>
                    )}

                    {/* Overlay Gradient */}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-60" />

                    {/* Count Badge */}
                    <div className="absolute bottom-2 right-2 bg-black/40 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border border-white/10">
                        <Icons.Image size={10} />
                        {folder.mediaCount}
                    </div>

                    {/* Favorite Indicator */}
                    {isFavorite && (
                        <div className="absolute top-2 right-2 text-red-500 drop-shadow-md text-nowrap">
                            <Icons.Heart size={18} fill="currentColor" />
                        </div>
                    )}

                    {/* Menu Button */}
                    <button
                        onClick={handleMenuClick}
                        className={`absolute top-2 left-2 p-1.5 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white opacity-0 group-hover:opacity-100 transition-opacity ${showMenu ? 'opacity-100' : ''}`}
                    >
                        <Icons.More size={16} />
                    </button>

                    {/* Dropdown Menu */}
                    <AnimatePresence>
                        {showMenu && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.9, x: -10, y: -10 }}
                                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                                exit={{ opacity: 0, scale: 0.9 }}
                                className="absolute top-10 left-2 bg-surface-primary rounded-lg shadow-xl border border-border-default py-1 min-w-[120px] z-50 overflow-hidden"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <button onClick={(e) => handleAction('fav', e)} className="w-full text-left px-3 py-2 text-xs hover:bg-surface-secondary text-text-primary flex items-center gap-2">
                                    <Icons.Heart size={12} className={isFavorite ? 'text-red-500' : ''} fill={isFavorite ? 'currentColor' : 'none'} /> {isFavorite ? 'Unfavorite' : 'Favorite'}
                                </button>
                                {onRename && (
                                    <button onClick={(e) => handleAction('rename', e)} className="w-full text-left px-3 py-2 text-xs hover:bg-surface-secondary text-text-primary flex items-center gap-2">
                                        <Icons.Edit size={12} /> Rename
                                    </button>
                                )}
                                {onRegenerate && (
                                    <button onClick={(e) => {
                                        e.stopPropagation();
                                        setShowMenu(false);
                                        onRegenerate(folder.path);
                                    }} className="w-full text-left px-3 py-2 text-xs hover:bg-surface-secondary text-text-primary flex items-center gap-2">
                                        <Icons.Refresh size={12} /> Regenerate
                                    </button>
                                )}
                                {onDelete && (
                                    <button onClick={(e) => handleAction('delete', e)} className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center gap-2">
                                        <Icons.Trash size={12} /> Delete
                                    </button>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className="p-3 flex items-start gap-3 bg-surface-primary transition-colors">
                    <div className="bg-primary-50 dark:bg-primary-900/30 p-1.5 rounded-lg text-primary-600 dark:text-primary-400 mt-0.5 transition-colors">
                        <Icons.Folder size={18} />
                    </div>
                    <div className="flex-1 min-w-0">
                        {isRenaming ? (
                            <form onSubmit={submitRename} onClick={e => e.stopPropagation()}>
                                <input
                                    autoFocus
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onBlur={() => submitRename()}
                                    className="w-full text-sm font-semibold text-text-primary bg-surface-secondary rounded px-1 outline-none border border-primary-500"
                                />
                            </form>
                        ) : (
                            <h3 className="text-sm font-semibold text-text-primary truncate leading-tight" title={folder.name}>{folder.name}</h3>
                        )}
                        <p className="text-[10px] text-text-secondary mt-0.5">{folder.mediaCount} items</p>
                    </div>
                </div>
            </Card>
        </motion.div>
    );
}, (prev, next) => {
    return (
        prev.folder.path === next.folder.path &&
        prev.folder.name === next.folder.name &&
        prev.folder.mediaCount === next.folder.mediaCount &&
        prev.isFavorite === next.isFavorite &&
        prev.folder.coverMedia?.id === next.folder.coverMedia?.id &&
        prev.layout === next.layout
    );
});
