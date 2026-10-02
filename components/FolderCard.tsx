
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FolderNode, MediaItem } from '../types';
import { getAuthUrl } from '../utils/fileUtils';
import { Icons } from './ui/Icon';
import { useLanguage } from '../contexts/LanguageContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './kit/dropdown-menu';

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
    const { t } = useLanguage();
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [imgError, setImgError] = useState(false);

    useEffect(() => {
        setImgError(false);
    }, [folder.coverMedia?.url]);

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
    };

    const handleAction = (action: 'fav' | 'rename' | 'delete') => {
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

    const openFolder = () => { if (!isRenaming) onClick(folder.path); };
    const hasActions = Boolean(onToggleFavorite || onRename || onRegenerate || onDelete);

    // 相册式卡片：封面即主体（小圆角、无毛玻璃与入场动画），名称与数量置于封面下方
    return (
        <div
            role="button"
            tabIndex={0}
            aria-label={folder.name}
            className={`group relative flex cursor-pointer flex-col gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${layout === 'masonry' ? 'h-full' : ''}`}
            onClick={openFolder}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openFolder();
                }
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <div className={`${layout === 'masonry' ? 'min-h-0 flex-1' : 'aspect-4/3'} relative flex w-full items-center justify-center overflow-hidden rounded-md bg-muted`}>
                {folder.coverMedia && !imgError ? (
                    folder.coverMedia.mediaType === 'video' ? (
                        <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
                            {thumbUrl && (
                                <img
                                    src={thumbUrl}
                                    alt={folder.name}
                                    className={`absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-500 ease-darkroom group-hover:scale-[1.03] motion-reduce:group-hover:scale-100 ${isPlaying ? 'opacity-0' : 'opacity-100'}`}
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
                                    className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${isPlaying ? 'opacity-100' : 'opacity-0'}`}
                                    onError={() => { }}
                                />
                            )}
                            <div className={`absolute inset-0 z-10 flex items-center justify-center transition-opacity ${isPlaying ? 'opacity-0' : 'opacity-100'}`}>
                                <div className="flex size-10 items-center justify-center rounded-full bg-black/45 ring-1 ring-white/25">
                                    <Icons.Video className="text-white" size={18} />
                                </div>
                            </div>
                        </div>
                    ) : folder.coverMedia.mediaType === 'audio' ? (
                        <div className="flex h-full w-full items-center justify-center bg-accent">
                            <Icons.Music className="text-primary" size={36} />
                        </div>
                    ) : (
                        <img
                            src={getAuthUrl(thumbUrl || folder.coverMedia.url)}
                            alt={folder.name}
                            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 ease-darkroom group-hover:scale-[1.03] motion-reduce:group-hover:scale-100"
                            onError={() => setImgError(true)}
                        />
                    )
                ) : (
                    <Icons.Folder size={40} strokeWidth={1.25} className="text-muted-foreground" />
                )}

                {isFavorite && (
                    <div className="absolute top-2 right-2 text-red-400 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" aria-hidden="true">
                        <Icons.Heart size={16} fill="currentColor" />
                    </div>
                )}

                {hasActions && (
                    <div className="absolute top-2 left-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 has-[[data-popup-open]]:opacity-100 pointer-coarse:opacity-100" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                            <DropdownMenuTrigger
                                aria-label={t('folder_actions')}
                                className="flex size-7 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-white/20 outline-none hover:bg-black/60 focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <Icons.More size={14} />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="min-w-44">
                                {onToggleFavorite && (
                                    <DropdownMenuItem onClick={() => handleAction('fav')}>
                                        <Icons.Heart className={isFavorite ? 'text-red-400' : ''} fill={isFavorite ? 'currentColor' : 'none'} />
                                        {isFavorite ? t('unfavorite_action') : t('favorite_action')}
                                    </DropdownMenuItem>
                                )}
                                {onRename && (
                                    <DropdownMenuItem onClick={() => handleAction('rename')}>
                                        <Icons.Edit /> {t('rename_action')}
                                    </DropdownMenuItem>
                                )}
                                {onRegenerate && (
                                    <DropdownMenuItem onClick={() => onRegenerate(folder.path)}>
                                        <Icons.Refresh /> {t('regenerate_thumbnails')}
                                    </DropdownMenuItem>
                                )}
                                {onDelete && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem variant="destructive" onClick={() => handleAction('delete')}>
                                            <Icons.Trash /> {t('delete_action')}
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                )}
            </div>

            <div className="min-w-0 px-0.5">
                {isRenaming ? (
                    <form onSubmit={submitRename} onClick={e => e.stopPropagation()}>
                        <input
                            autoFocus
                            aria-label={t('rename_action')}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => submitRename()}
                            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setIsRenaming(false); } }}
                            className="w-full rounded-sm border border-ring bg-background px-1 text-sm font-medium outline-none"
                        />
                    </form>
                ) : (
                    <h3 className="truncate text-sm font-medium leading-tight text-foreground" title={folder.name}>{folder.name}</h3>
                )}
                <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{folder.mediaCount.toLocaleString()} {t('items_count')}</p>
            </div>
        </div>
    );
}, (prev, next) => {
    return (
        prev.folder.path === next.folder.path &&
        prev.folder.name === next.folder.name &&
        prev.folder.mediaCount === next.folder.mediaCount &&
        prev.isFavorite === next.isFavorite &&
        prev.folder.coverMedia?.id === next.folder.coverMedia?.id &&
        prev.folder.coverMedia?.url === next.folder.coverMedia?.url &&
        prev.folder.coverMedia?.type === next.folder.coverMedia?.type &&
        prev.folder.coverMedia?.mediaType === next.folder.coverMedia?.mediaType &&
        prev.layout === next.layout
    );
});
