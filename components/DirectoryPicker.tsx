import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '../contexts/LanguageContext';
import { Icons } from './ui/Icon';

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
                const res = await fetch(`/api/fs/list?path=${encodeURIComponent(query)}`);
                const data = await res.json();

                if (data.dirs) {
                    setFolders(data.dirs);
                } else {
                    setFolders([]);
                }
            } catch (err) {
                console.error("Failed to load folders", err);
                setError('Failed to load directory listing');
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
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 20 }}
                        transition={{ duration: 0.2 }}
                        className="glass-3 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh] transform translate-z-0 border border-white/5"
                    >
                        {/* Header */}
                        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3 bg-gray-50/50 dark:bg-gray-900/50">
                            <div className="p-2 bg-primary-100 dark:bg-primary-900/30 rounded-full text-primary-600 dark:text-primary-400">
                                <Icons.FolderOpen size={20} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="font-bold text-lg text-gray-900 dark:text-gray-100">{t('select_folder')}</h3>
                                <div className="text-xs text-gray-500 dark:text-gray-400 font-mono truncate bg-black/20 px-2 py-1.5 rounded-lg border border-white/5 mt-1 flex items-center gap-2">
                                    <Icons.Database size={12} />
                                    <span className="truncate" title={currentPath}>{currentPath || '/'}</span>
                                </div>
                            </div>
                            <button onClick={onClose} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full transition-colors text-gray-500">
                                <Icons.Close size={20} />
                            </button>
                        </div>

                        {/* Toolbar */}
                        <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2 bg-transparent">
                            <button
                                onClick={handleUp}
                                disabled={isRoot}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${isRoot
                                    ? 'text-gray-400 dark:text-gray-600 cursor-not-allowed bg-white/5'
                                    : 'text-text-primary hover:bg-white/10 shadow-sm border border-white/5'
                                    }`}
                            >
                                <Icons.ArrowUp size={16} />
                                {t('go_up')}
                            </button>
                            <div className="w-px h-6 bg-white/5 mx-1" />
                            <button
                                onClick={() => setCurrentPath('/')}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${isRoot
                                    ? 'text-accent-500 bg-accent-500/10 border border-accent-500/20'
                                    : 'text-text-secondary hover:bg-white/10'
                                    }`}
                            >
                                <Icons.Server size={14} />
                                System Root
                            </button>
                        </div>

                        {/* Folder List */}
                        <div className="flex-1 overflow-y-auto p-4 bg-gray-50/30 dark:bg-black/20 custom-scrollbar">
                            {loading ? (
                                <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-3">
                                    <Icons.Loader size={32} className="animate-spin text-primary-500" />
                                    <span className="text-sm font-medium">{t('loading_folders')}...</span>
                                </div>
                            ) : error ? (
                                <div className="flex flex-col items-center justify-center h-48 text-red-400 gap-3">
                                    <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-full">
                                        <Icons.AlertTriangle size={32} />
                                    </div>
                                    <span className="text-sm font-medium">{error}</span>
                                    <button
                                        onClick={() => setCurrentPath('/')}
                                        className="text-xs px-3 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-sm hover:shadow-md transition-all"
                                    >
                                        Return to Root
                                    </button>
                                </div>
                            ) : folders.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-3">
                                    <Icons.FolderOpen size={40} className="opacity-20" />
                                    <span className="text-sm">{t('no_subfolders')}</span>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    {folders.map((folder) => (
                                        <button
                                            key={folder}
                                            onClick={() => handleNavigate(folder)}
                                            className="flex items-center gap-3 p-3 bg-white/3 hover:bg-accent-500/10 rounded-xl text-left transition-all duration-300 group border border-transparent hover:border-accent-500/20"
                                        >
                                            <div className="p-2 bg-accent-500/10 text-accent-500 rounded-lg group-hover:scale-110 transition-transform duration-300">
                                                <Icons.Folder size={20} fill="currentColor" className="opacity-90" />
                                            </div>
                                            <span className="font-medium text-text-primary truncate flex-1 text-sm">{folder}</span>
                                            <Icons.ChevronRight size={16} className="text-text-muted group-hover:text-accent-400 transition-colors" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-white/5 bg-transparent flex justify-end gap-3 rounded-b-2xl">
                            <button
                                onClick={onClose}
                                className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-transparent rounded-xl text-sm font-medium transition-all text-text-secondary"
                            >
                                {t('cancel')}
                            </button>
                            <button
                                onClick={() => { onSelect(currentPath); onClose(); }}
                                className="px-6 py-2.5 bg-accent-600 hover:bg-accent-500 text-white rounded-xl text-sm font-bold shadow-glow transition-all active:scale-95 hover:-translate-y-0.5"
                            >
                                {t('select_this_folder')}
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
