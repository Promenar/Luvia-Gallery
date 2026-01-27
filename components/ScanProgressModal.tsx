
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from './ui/Icon';
import { useLanguage } from '../contexts/LanguageContext';

export type ScanStatus = 'idle' | 'scanning' | 'paused' | 'completed' | 'error' | 'cancelled';

interface ScanProgressModalProps {
    isOpen: boolean;
    status: ScanStatus;
    count: number;
    currentPath: string;
    onPause: () => void;
    onResume: () => void;
    onCancel: () => void;
    onClose: () => void;
    title?: string; // e.g. "Scanning Library" or "Generating Thumbnails"
    type?: 'scan' | 'thumb';
}

export const ScanProgressModal: React.FC<ScanProgressModalProps> = ({
    isOpen,
    status = 'idle',
    count,
    currentPath,
    onPause,
    onResume,
    onCancel,
    onClose,
    title = "Scanning Library",
    type = 'scan'
}) => {
    const { t } = useLanguage();
    const [isMinimized, setIsMinimized] = useState(false);

    if (!isOpen) return null;

    const isThumb = type === 'thumb';

    const getStatusText = (s: string) => {
        switch (s) {
            case 'scanning': return t('processing');
            case 'paused': return t('paused');
            case 'completed': return t('complete');
            case 'cancelled': return t('stopped');
            case 'idle': return t('stopped');
            case 'error': return 'Error';
            default: return s;
        }
    };

    return (
        <AnimatePresence>
            {isMinimized ? (
                <motion.div
                    key="minimized"
                    initial={{ y: 100, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: 100, opacity: 0 }}
                    className="fixed bottom-6 right-6 z-[60] bg-surface-secondary backdrop-blur-3xl rounded-xl shadow-2xl border border-white/5 p-4 w-72 flex flex-col gap-3"
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Icons.Loader size={16} className={status === 'scanning' ? 'animate-spin text-primary-600' : 'text-gray-400'} />
                            <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">
                                {getStatusText(status)}
                            </span>
                        </div>
                        <div className="flex items-center gap-1">
                            <button onClick={() => setIsMinimized(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"><Icons.Maximize size={14} /></button>
                            {(status === 'completed' || status === 'cancelled' || status === 'error') && (
                                <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"><Icons.Close size={14} /></button>
                            )}
                        </div>
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between text-xs text-gray-500">
                            <span>{isThumb ? t('processed') : t('found')}</span>
                            <span>{count}</span>
                        </div>
                        <div className="h-1 w-full bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                            {status === 'scanning' && <motion.div className="h-full bg-primary-500" initial={{ x: '-100%' }} animate={{ x: '100%' }} transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }} />}
                        </div>
                        <p className="text-[10px] text-gray-400 truncate font-mono">{currentPath}</p>
                    </div>
                </motion.div>
            ) : (
                <motion.div
                    key="modal"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
                >
                    <motion.div
                        initial={{ scale: 0.9, y: 20 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.9, y: 20 }}
                        className="bg-surface-secondary backdrop-blur-3xl rounded-2xl w-full max-w-md shadow-2xl overflow-hidden border border-white/5 relative"
                    >
                        <div className="absolute top-4 right-4 flex items-center gap-2">
                            <button onClick={() => setIsMinimized(true)} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors" title="Minimize to background">
                                <Icons.Minus size={20} />
                            </button>
                        </div>

                        <div className="p-6">
                            <div className="flex items-center gap-3 mb-4">
                                <div className={`p-3 rounded-full ${status === 'scanning' ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                                    {status === 'scanning' ? (
                                        <Icons.Loader size={24} className="animate-spin" />
                                    ) : status === 'paused' ? (
                                        <Icons.Pause size={24} />
                                    ) : (
                                        <Icons.Check size={24} />
                                    )}
                                </div>
                                <div>
                                    <h3 className="font-bold text-lg text-gray-900 dark:text-white">
                                        {status === 'scanning' ? title : getStatusText(status)}
                                    </h3>
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        {(status === 'completed' || status === 'cancelled' || status === 'idle') ? t('operation_finished') : t('processing_bg')}
                                    </p>
                                </div>
                            </div>

                            <div className="bg-black/20 rounded-xl p-4 mb-6 border border-white/5">
                                <div className="flex justify-between items-end mb-2">
                                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{isThumb ? t('processed') : t('found')}</span>
                                    <span className="text-2xl font-bold text-primary-600 dark:text-primary-400">{count}</span>
                                </div>
                                <div className="h-1.5 w-full bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                    {status === 'scanning' && (
                                        <motion.div
                                            className="h-full bg-primary-500"
                                            initial={{ x: '-100%' }}
                                            animate={{ x: '100%' }}
                                            transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                                        />
                                    )}
                                </div>
                                <div className="mt-3">
                                    <p className="text-xs text-gray-400 mb-1">{t('current_file')}</p>
                                    <p className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate" title={currentPath}>
                                        {currentPath || 'Initializing...'}
                                    </p>
                                </div>
                            </div>

                            <div className="flex gap-3">
                                {status === 'scanning' && (
                                    <>
                                        <button onClick={onPause} className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"><Icons.Pause size={18} /> {t('pause')}</button>
                                        <button onClick={onCancel} className="flex-1 py-2.5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"><Icons.Stop size={18} /> {t('stop')}</button>
                                    </>
                                )}

                                {status === 'paused' && (
                                    <>
                                        <button onClick={onResume} className="flex-1 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"><Icons.Play size={18} /> {t('resume')}</button>
                                        <button onClick={onCancel} className="flex-1 py-2.5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"><Icons.Stop size={18} /> {t('stop')}</button>
                                    </>
                                )}

                                {(status === 'completed' || status === 'cancelled' || status === 'error' || status === 'idle') && (
                                    <button onClick={onClose} className="w-full py-2.5 bg-accent-500 hover:bg-accent-600 text-black rounded-xl font-bold transition-all shadow-lg shadow-accent-500/10 border border-white/5">{t('close')}</button>
                                )}
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};