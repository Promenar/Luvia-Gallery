import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './kit/dialog';
import { Button } from './kit/button';
import { useLanguage } from '../contexts/LanguageContext';
import { Icons } from './ui/Icon';
import { getAuthHeaders } from '../utils/fileUtils';

interface DirectoryPickerProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (path: string) => void;
    initialPath?: string;
}

export const DirectoryPicker: React.FC<DirectoryPickerProps> = ({
    isOpen,
    onClose,
    onSelect,
    initialPath
}) => {
    const { t } = useLanguage();
    const [currentPath, setCurrentPath] = useState(initialPath || '/');
    const [folders, setFolders] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Load folders when path changes
    useEffect(() => {
        if (!isOpen) return;

        const loadFolders = async () => {
            setLoading(true);
            setError('');
            try {
                // Ensure query param handles root correctly
                const query = (currentPath === '/' || currentPath === '') ? 'root' : currentPath;
                const res = await fetch(`/api/fs/list?path=${encodeURIComponent(query)}`, { headers: getAuthHeaders() });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();

                if (data.dirs) {
                    setFolders(data.dirs);
                } else {
                    setFolders([]);
                }
            } catch (err) {
                console.error("Failed to load folders", err);
                setError(t('load_folders_failed'));
            } finally {
                setLoading(false);
            }
        };

        loadFolders();
    }, [currentPath, isOpen]);

    const handleNavigate = (folderName: string) => {
        // Construct new path based on current path
        let newPath = currentPath;
        if (newPath === '/' || newPath === '') {
            newPath = `/${folderName}`;
        } else if (newPath.endsWith('/') || newPath.endsWith('\\')) {
            newPath = `${newPath}${folderName}`;
        } else {
            newPath = `${newPath}/${folderName}`;
        }
        setCurrentPath(newPath);
    };

    const handleUp = () => {
        if (currentPath === '/' || currentPath === 'root' || currentPath === '') return;

        // Simple string manipulation to go up
        // Handle both forward and backward slashes just in case
        const separator = currentPath.includes('\\') ? '\\' : '/';
        const parts = currentPath.split(separator);
        parts.pop(); // Remove last segment
        const parent = parts.join(separator);

        setCurrentPath(parent || '/');
    };

    const isRoot = currentPath === '/' || currentPath === 'root' || currentPath === '';

    return (
        <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
            <DialogContent className="flex max-h-[80vh] w-[calc(100%-1.5rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
                {/* 标题与当前路径 */}
                <div className="flex items-start gap-3 border-b border-border p-4 pr-12">
                    <div className="rounded-lg bg-accent p-2 text-primary">
                        <Icons.FolderOpen size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <DialogTitle className="text-base font-semibold">{t('select_folder')}</DialogTitle>
                        <DialogDescription className="mt-1 flex items-center gap-2 truncate rounded-md border border-border bg-muted/50 px-2 py-1 font-mono text-xs">
                            <Icons.Database size={12} className="shrink-0" />
                            <span className="truncate" title={currentPath}>{currentPath || '/'}</span>
                        </DialogDescription>
                    </div>
                </div>

                {/* 工具条 */}
                <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                    <Button variant="ghost" size="sm" onClick={handleUp} disabled={isRoot}>
                        <Icons.ArrowUp /> {t('go_up')}
                    </Button>
                    <Button variant={isRoot ? 'secondary' : 'ghost'} size="sm" onClick={() => setCurrentPath('/')}>
                        <Icons.Server /> {t('system_root')}
                    </Button>
                </div>

                {/* 子目录列表 */}
                <div className="min-h-48 flex-1 overflow-y-auto p-4 custom-scrollbar">
                    {loading ? (
                        <div className="flex h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
                            <Icons.Loader size={24} className="animate-spin text-primary" />
                            <span className="text-sm">{t('loading_folders')}…</span>
                        </div>
                    ) : error ? (
                        <div role="alert" className="flex h-48 flex-col items-center justify-center gap-3 text-destructive">
                            <Icons.AlertTriangle size={24} />
                            <span className="text-sm">{error}</span>
                            <Button variant="outline" size="sm" onClick={() => setCurrentPath('/')}>{t('return_to_root')}</Button>
                        </div>
                    ) : folders.length === 0 ? (
                        <div className="flex h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
                            <Icons.FolderOpen size={32} className="opacity-40" />
                            <span className="text-sm">{t('no_subfolders')}</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {folders.map((folder) => (
                                <button
                                    key={folder}
                                    type="button"
                                    onClick={() => handleNavigate(folder)}
                                    className="group flex items-center gap-3 rounded-lg border border-transparent p-2.5 text-left transition-colors outline-none hover:border-border hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
                                >
                                    <Icons.Folder size={18} className="shrink-0 text-primary" />
                                    <span className="min-w-0 flex-1 truncate text-sm">{folder}</span>
                                    <Icons.ChevronRight size={16} className="text-muted-foreground transition-colors group-hover:text-foreground" />
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <DialogFooter className="mx-0 mb-0">
                    <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
                    <Button onClick={() => { onSelect(currentPath); onClose(); }}>{t('select_this_folder')}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
