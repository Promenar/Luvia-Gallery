
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from './ui/Icon';

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
    onThumbPause: () => void;
    onThumbResume: () => void;
    onThumbStop: () => void;
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
    onThumbPause,
    onThumbResume,
    onThumbStop
}) => {
    // Determine overall visibility: at least one active or recently finished task
    // We keep it simple: if isOpen is true passed from parent. parent handles logic.

    const isScanActive = scanStatus === 'scanning' || scanStatus === 'paused';
    const isScanFinished = scanStatus === 'idle' || scanStatus === 'cancelled' || scanStatus === 'error';
    const isThumbActive = thumbStatus === 'scanning' || thumbStatus === 'paused';
    const isThumbFinished = thumbStatus === 'idle' || thumbStatus === 'error'; // Thumb doesn't report cancelled usually, just idle

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
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-gray-100 dark:border-gray-700"
                    >
                        {/* Header */}
                        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                            <h3 className="font-semibold text-gray-800 dark:text-gray-200 flex items-center gap-2">
                                <Icons.Refresh className={`animate-spin ${!isScanActive && !isThumbActive ? 'hidden' : ''}`} size={18} />
                                Background Tasks
                            </h3>
                            {(!isScanActive && !isThumbActive) && (
                                <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                                    <Icons.Close size={20} className="text-gray-500" />
                                </button>
                            )}
                        </div>

                        <div className="p-6 space-y-8">
                            {/* Library Scan Section */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-2 rounded-lg ${isScanActive ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}`}>
                                            <Icons.Search size={20} />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">Library Scan</h4>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {scanStatus === 'idle' ? 'Waiting / Finished' :
                                                    scanStatus === 'paused' ? 'Paused' :
                                                        `Processed: ${scanCount} files`}
                                            </p>
                                        </div>
                                    </div>
                                    {isScanActive && (
                                        <div className="flex items-center gap-1">
                                            {scanStatus === 'paused' ? (
                                                <button onClick={onScanResume} className="p-1.5 hover:bg-green-50 text-green-600 rounded-md" title="Resume">
                                                    <Icons.Play size={16} />
                                                </button>
                                            ) : (
                                                <button onClick={onScanPause} className="p-1.5 hover:bg-yellow-50 text-yellow-600 rounded-md" title="Pause">
                                                    <Icons.Pause size={16} />
                                                </button>
                                            )}
                                            <button onClick={onScanStop} className="p-1.5 hover:bg-red-50 text-red-600 rounded-md" title="Stop">
                                                <Icons.Stop size={16} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {isScanActive && (
                                    <div className="bg-gray-50 dark:bg-gray-900/50 p-2 rounded text-xs font-mono text-gray-500 truncate">
                                        {scanCurrentPath || 'Scanning...'}
                                    </div>
                                )}
                            </div>

                            {/* Separator */}
                            <div className="h-px bg-gray-100 dark:bg-gray-700" />

                            {/* Thumbnail Gen Section */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-2 rounded-lg ${isThumbActive ? 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}`}>
                                            <Icons.Image size={20} />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100">Thumbnails</h4>
                                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                                {thumbStatus === 'idle' ? 'Waiting / Finished' :
                                                    thumbStatus === 'paused' ? 'Paused' :
                                                        `${thumbCount} / ${thumbTotal} (${Math.round((thumbCount / (thumbTotal || 1)) * 100)}%)`}
                                            </p>
                                        </div>
                                    </div>
                                    {isThumbActive && (
                                        <div className="flex items-center gap-1">
                                            {thumbStatus === 'paused' ? (
                                                <button onClick={onThumbResume} className="p-1.5 hover:bg-green-50 text-green-600 rounded-md" title="Resume">
                                                    <Icons.Play size={16} />
                                                </button>
                                            ) : (
                                                <button onClick={onThumbPause} className="p-1.5 hover:bg-yellow-50 text-yellow-600 rounded-md" title="Pause">
                                                    <Icons.Pause size={16} />
                                                </button>
                                            )}
                                            <button onClick={onThumbStop} className="p-1.5 hover:bg-red-50 text-red-600 rounded-md" title="Stop">
                                                <Icons.Stop size={16} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {isThumbActive && (
                                    <>
                                        {renderProgressBar((thumbCount / (thumbTotal || 1)) * 100)}
                                        <div className="bg-gray-50 dark:bg-gray-900/50 p-2 rounded text-xs font-mono text-gray-500 truncate">
                                            {thumbCurrentPath || 'Processing...'}
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Footer - Close Button if both done */}
                        {(!isScanActive && !isThumbActive) && (
                            <div className="bg-gray-50 dark:bg-gray-900/50 p-4 flex justify-end border-t border-gray-100 dark:border-gray-700">
                                <button
                                    onClick={onClose}
                                    className="px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                                >
                                    Close
                                </button>
                            </div>
                        )}
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};
