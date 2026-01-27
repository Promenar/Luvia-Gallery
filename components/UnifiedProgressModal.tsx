
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from './ui/Icon';
import { useLanguage } from '../contexts/LanguageContext';

interface UnifiedProgressModalProps {
    isOpen: boolean;
    onClose: () => void;
    // Scan State
    scanStatus: 'idle' | 'scanning' | 'paused' | 'cancelled' | 'max_depth_reached' | 'error' | 'completed';
    scanCount: number;
    scanCurrentPath: string;
    onScanPause: () => void;
    onScanResume: () => void;
    onScanStop: () => void;

    // Thumb State
    thumbStatus: 'idle' | 'scanning' | 'paused' | 'error';
    thumbCount: number;
    thumbTotal: number;
    thumbCurrentPath: string;
    thumbQueue?: Array<{ id: string, name: string, total: number }>;
    smartResults?: { missing: any[], error: any[] } | null; // New
    onThumbPause: () => void;
    onThumbResume: () => void;
    onThumbStop: () => void;
    onThumbCancelTask?: (id: string) => void;
    onStartRepair?: () => void; // New
}

export const UnifiedProgressModal: React.FC<UnifiedProgressModalProps> = ({
    isOpen,
    onClose,
    scanStatus,
    scanCount,
    scanCurrentPath,
    onScanPause,
    onScanResume,
    onScanStop,
    thumbStatus,
    thumbCount,
    thumbTotal,
    thumbCurrentPath,
    thumbQueue = [],
    smartResults,
    onThumbPause,
    onThumbResume,
    onThumbStop,
    onThumbCancelTask,
    onStartRepair
}) => {
    const { t } = useLanguage();
    const [isMinimized, setIsMinimized] = React.useState(false);

    // Dynamic visibility logic
    const isScanActive = scanStatus === 'scanning' || scanStatus === 'paused';
    const isThumbActive = thumbStatus === 'scanning' || thumbStatus === 'paused';

    // Show a task if it's active, OR if both are inactive (to show summary/finished state).
    const showScan = isScanActive || (!isScanActive && !isThumbActive);
    const showThumb = isThumbActive || (!isScanActive && !isThumbActive);
    const showQueue = thumbQueue.length > 0;

    const renderProgressBar = (progress: number) => (
        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden mb-2">
            <motion.div
                className="h-full bg-primary-500"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
            />
        </div>
    );

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Maximized View */}
                    {!isMinimized && (
                        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="bg-surface-secondary backdrop-blur-3xl rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden border border-white/5 max-h-[80vh] flex flex-col"
                            >
                                {/* Header */}
                                <div className="p-4 border-b border-white/5 flex items-center justify-between shrink-0">
                                    <h3 className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                        <Icons.Refresh className={`animate-spin ${!isScanActive && !isThumbActive ? 'hidden' : ''}`} size={18} />
                                        {t('background_tasks')}
                                    </h3>
                                    <div className="flex items-center gap-1">
                                        <button onClick={() => setIsMinimized(true)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors text-gray-500">
                                            <Icons.Minus size={20} />
                                        </button>
                                        {(!isScanActive && !isThumbActive && thumbQueue.length === 0) && (
                                            <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors text-gray-500">
                                                <Icons.Close size={20} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="p-6 space-y-6 overflow-y-auto">
                                    {/* Library Scan Section */}
                                    {showScan && (
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className={`p-2 rounded-lg ${isScanActive ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}`}>
                                                        <Icons.Search size={20} />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('library_scan')}</h4>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                                            {scanStatus === 'idle' || scanStatus === 'completed' ? t('waiting_finished') :
                                                                scanStatus === 'paused' ? t('paused') :
                                                                    `${t('processed')}: ${scanCount}`}
                                                        </p>
                                                    </div>
                                                </div>
                                                {isScanActive && (
                                                    <div className="flex items-center gap-1">
                                                        {scanStatus === 'paused' ? (
                                                            <button onClick={onScanResume} className="p-1.5 hover:bg-green-50 text-green-600 rounded-md" title={t('resume')}>
                                                                <Icons.Play size={16} />
                                                            </button>
                                                        ) : (
                                                            <button onClick={onScanPause} className="p-1.5 hover:bg-yellow-50 text-yellow-600 rounded-md" title={t('pause')}>
                                                                <Icons.Pause size={16} />
                                                            </button>
                                                        )}
                                                        <button onClick={onScanStop} className="p-1.5 hover:bg-red-50 text-red-600 rounded-md" title={t('stop')}>
                                                            <Icons.Stop size={16} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            {isScanActive && (
                                                <div className="bg-gray-50 dark:bg-gray-900/50 p-2 rounded text-xs font-mono text-gray-500 truncate">
                                                    {scanCurrentPath || t('scanning_library')}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Separator - only if both are shown */}
                                    {showScan && (showThumb || showQueue) && (
                                        <div className="h-px bg-white/5" />
                                    )}

                                    {/* Thumbnail Gen Section */}
                                    {showThumb && (
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-2">
                                                    <div className={`p-2 rounded-lg ${isThumbActive ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}`}>
                                                        <Icons.Image size={20} />
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">{t('thumbnails')}</h4>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                                            {thumbStatus === 'idle' ? t('waiting_finished') :
                                                                thumbStatus === 'paused' ? t('paused') :
                                                                    `${thumbCount} / ${thumbTotal} (${Math.round((thumbCount / (thumbTotal || 1)) * 100)}%)`}
                                                        </p>
                                                    </div>
                                                </div>
                                                {isThumbActive && (
                                                    <div className="flex items-center gap-1">
                                                        {thumbStatus === 'paused' ? (
                                                            <button onClick={onThumbResume} className="p-1.5 hover:bg-green-50 text-green-600 rounded-md" title={t('resume')}>
                                                                <Icons.Play size={16} />
                                                            </button>
                                                        ) : (
                                                            <button onClick={onThumbPause} className="p-1.5 hover:bg-yellow-50 text-yellow-600 rounded-md" title={t('pause')}>
                                                                <Icons.Pause size={16} />
                                                            </button>
                                                        )}
                                                        <button onClick={onThumbStop} className="p-1.5 hover:bg-red-50 text-red-600 rounded-md" title={t('stop')}>
                                                            <Icons.Stop size={16} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Smart Scan Results Integration */}
                                            {smartResults && (smartResults.missing.length > 0 || smartResults.error.length > 0) && (
                                                <div className="flex gap-2 mb-2">
                                                    {smartResults.missing.length > 0 && (
                                                        <div className="px-2 py-1 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-[10px] uppercase font-bold rounded border border-amber-100 dark:border-amber-800">
                                                            Missing: {smartResults.missing.length}
                                                        </div>
                                                    )}
                                                    {smartResults.error.length > 0 && (
                                                        <div className="px-2 py-1 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 text-[10px] uppercase font-bold rounded border border-red-100 dark:border-red-800">
                                                            Corrupted: {smartResults.error.length}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {isThumbActive && (
                                                <>
                                                    {renderProgressBar((thumbCount / (thumbTotal || 1)) * 100)}
                                                    <div className="bg-gray-50 dark:bg-gray-900/50 p-2 rounded text-xs font-mono text-gray-500 truncate">
                                                        {thumbCurrentPath || t('processing')}
                                                    </div>
                                                </>
                                            )}

                                            {/* Final Action Guide for Smart Scan */}
                                            {!isThumbActive && thumbStatus === 'idle' && smartResults && (smartResults.missing.length > 0 || smartResults.error.length > 0) && (
                                                <div className="mt-2 p-3 bg-primary-50 dark:bg-primary-900/10 rounded-xl border border-primary-100 dark:border-primary-800/50 flex items-center justify-between">
                                                    <p className="text-xs text-primary-700 dark:text-primary-300">Analysis complete. Issues found.</p>
                                                    {onStartRepair && (
                                                        <button
                                                            onClick={() => {
                                                                if (onStartRepair) onStartRepair();
                                                                onClose(); // Close modal to trigger refresh in parent
                                                            }}
                                                            className="px-3 py-1 bg-primary-600 hover:bg-primary-700 text-white rounded text-xs font-bold transition-all transform hover:scale-105"
                                                        >
                                                            Repair Now
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Pending Queue Section */}
                                    {showQueue && (
                                        <>
                                            <div className="h-px bg-white/5" />
                                            <div className="space-y-3">
                                                <h4 className="text-xs font-semibold uppercase text-gray-500 dark:text-gray-400 tracking-wider">Pending Tasks ({thumbQueue.length})</h4>
                                                <div className="space-y-2">
                                                    {thumbQueue.map((task) => (
                                                        <div key={task.id} className="flex items-center justify-between p-2 rounded-lg bg-black/20 border border-white/5">
                                                            <div className="min-w-0">
                                                                <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{task.name}</p>
                                                                <p className="text-xs text-gray-400">{task.total} files</p>
                                                            </div>
                                                            {onThumbCancelTask && (
                                                                <button
                                                                    onClick={() => onThumbCancelTask(task.id)}
                                                                    className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 rounded-md transition-colors"
                                                                    title="Cancel"
                                                                >
                                                                    <Icons.Close size={14} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>

                                {/* Footer - Close Button if both done */}
                                {(!isScanActive && !isThumbActive && thumbQueue.length === 0) && (
                                    <div className="bg-gray-50 dark:bg-gray-900/50 p-4 flex justify-end border-t border-gray-100 dark:border-gray-700 shrink-0">
                                        <button
                                            onClick={onClose}
                                            className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                                        >
                                            {t('close')}
                                        </button>
                                    </div>
                                )}
                            </motion.div>
                        </div>
                    )}

                    {/* Minimized View */}
                    {isMinimized && (
                        <motion.div
                            initial={{ y: 100, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 100, opacity: 0 }}
                            className="fixed bottom-6 right-6 z-50 bg-surface-secondary backdrop-blur-3xl rounded-xl shadow-2xl border border-white/5 p-4 flex items-center gap-4 max-w-sm"
                        >
                            <div className="relative">
                                {isScanActive ? (
                                    <Icons.Refresh className="text-blue-500 animate-spin" size={20} />
                                ) : isThumbActive ? (
                                    <Icons.Refresh className="text-purple-500 animate-spin" size={20} />
                                ) : (
                                    <Icons.Check className="text-green-500" size={20} />
                                )}
                            </div>

                            <div className="flex-1 min-w-0">
                                <h4 className="font-semibold text-sm text-gray-900 dark:text-gray-100 truncate">
                                    {isScanActive ? t('scanning_library') : (isThumbActive ? t('generating_thumbnails') : t('tasks_completed'))}
                                </h4>
                                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                    {isScanActive
                                        ? `${scanCount} ${t('files_processed')}`
                                        : isThumbActive
                                            ? `${Math.round((thumbCount / (thumbTotal || 1)) * 100)}${t('percent_complete')}`
                                            : t('all_jobs_finished')}
                                </p>
                            </div>

                            <button
                                onClick={() => setIsMinimized(false)}
                                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                                title="Expand"
                            >
                                <Icons.Maximize size={18} className="text-gray-500" />
                            </button>

                            {(!isScanActive && !isThumbActive) && (
                                <button
                                    onClick={onClose}
                                    className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors"
                                    title={t('close')}
                                >
                                    <Icons.Close size={18} className="text-red-500" />
                                </button>
                            )}
                        </motion.div>
                    )}
                </>
            )}
        </AnimatePresence>
    );
};

