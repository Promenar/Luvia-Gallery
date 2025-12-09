import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from './ui/Icon';

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
}

export const ScanProgressModal: React.FC<ScanProgressModalProps> = ({
  isOpen,
  status,
  count,
  currentPath,
  onPause,
  onResume,
  onCancel,
  onClose
}) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ scale: 0.9, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.9, y: 20 }}
            className="bg-white dark:bg-gray-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden border border-gray-100 dark:border-gray-700"
          >
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
                    {status === 'scanning' ? 'Scanning Library...' : 
                     status === 'paused' ? 'Scan Paused' : 
                     status === 'completed' ? 'Scan Complete' : 'Scan Stopped'}
                  </h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {status === 'completed' ? 'Library successfully updated' : 'Discovering media files'}
                  </p>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl p-4 mb-6 border border-gray-100 dark:border-gray-800">
                <div className="flex justify-between items-end mb-2">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Items Found</span>
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
                    <p className="text-xs text-gray-400 mb-1">Current Directory</p>
                    <p className="text-xs font-mono text-gray-600 dark:text-gray-300 truncate" title={currentPath}>
                        {currentPath || 'Initializing...'}
                    </p>
                </div>
              </div>

              <div className="flex gap-3">
                {status === 'scanning' && (
                  <>
                    <button 
                        onClick={onPause}
                        className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        <Icons.Pause size={18} /> Pause
                    </button>
                    <button 
                        onClick={onCancel}
                        className="flex-1 py-2.5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        <Icons.Stop size={18} /> Stop
                    </button>
                  </>
                )}
                
                {status === 'paused' && (
                  <>
                    <button 
                        onClick={onResume}
                        className="flex-1 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        <Icons.Play size={18} /> Resume
                    </button>
                    <button 
                        onClick={onCancel}
                        className="flex-1 py-2.5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                    >
                        <Icons.Stop size={18} /> Stop
                    </button>
                  </>
                )}

                {(status === 'completed' || status === 'cancelled' || status === 'error') && (
                    <button 
                        onClick={onClose}
                        className="w-full py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-medium transition-colors"
                    >
                        Close
                    </button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};