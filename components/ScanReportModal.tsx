import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from './ui/Icon';
import { useLanguage } from '../contexts/LanguageContext';

interface ScanReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    smartResults: { missing: any[], error: any[] };
    onRepair: (selectedIds: string[]) => void;
    onDelete: (selectedIds: string[]) => Promise<void>;
}

export const ScanReportModal: React.FC<ScanReportModalProps> = ({
    isOpen,
    onClose,
    smartResults,
    onRepair,
    onDelete
}) => {
    const { t } = useLanguage();
    const [activeTab, setActiveTab] = useState<'error' | 'missing'>('error');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [isProcessing, setIsProcessing] = useState(false);

    const currentItems = useMemo(() => {
        return activeTab === 'error' ? (smartResults?.error || []) : (smartResults?.missing || []);
    }, [activeTab, smartResults]);

    const handleSelectAll = (checked: boolean) => {
        if (checked) {
            const all = new Set(selectedIds);
            currentItems.forEach((item: any) => all.add(item.id));
            setSelectedIds(all);
        } else {
            const newSet = new Set(selectedIds);
            currentItems.forEach((item: any) => newSet.delete(item.id));
            setSelectedIds(newSet);
        }
    };

    const handleToggleSelect = (id: string, checked: boolean) => {
        const newSet = new Set(selectedIds);
        if (checked) newSet.add(id);
        else newSet.delete(id);
        setSelectedIds(newSet);
    };

    const handleExport = () => {
        const text = currentItems.map((f: any) => `${f.path} [${(f.size || 0)} bytes]`).join('\n');
        navigator.clipboard.writeText(text);
        alert(t('copied_to_clipboard') || "Copied to clipboard");
    };

    const handleDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!confirm(t('batch_delete_confirm').replace('{count}', selectedIds.size.toString()) || `Permanently delete ${selectedIds.size} files?`)) return;

        setIsProcessing(true);
        try {
            await onDelete(Array.from(selectedIds));
            setSelectedIds(new Set());
        } catch (e) {
            alert("Delete failed");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleRepair = () => {
        // Implement specific repair logic if needed, or generic repair
        // Current backend supports full repair, maybe passing IDs in future
        onRepair(Array.from(selectedIds));
    };

    const isAllSelected = currentItems.length > 0 && currentItems.every((item: any) => selectedIds.has(item.id));
    const selectedCount = selectedIds.size;

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.95, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.95, y: 20 }}
                    className="glass-3 w-full max-w-4xl h-[80vh] rounded-2xl shadow-2xl flex flex-col border border-white/10"
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header */}
                    <div className="flex items-center justify-between p-6 border-b border-white/5 bg-black/20">
                        <div className="flex items-center gap-3">
                            <Icons.Alert size={24} className="text-red-400" />
                            <h3 className="text-xl font-bold text-text-primary">Scan Report</h3>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                            <Icons.Close size={20} className="text-text-secondary" />
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex border-b border-white/5">
                        <button
                            onClick={() => setActiveTab('error')}
                            className={`flex-1 py-3 font-medium text-sm transition-colors border-b-2 ${activeTab === 'error' ? 'border-red-500 text-red-400 bg-red-500/5' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
                        >
                            Errors ({smartResults?.error?.length || 0})
                        </button>
                        <button
                            onClick={() => setActiveTab('missing')}
                            className={`flex-1 py-3 font-medium text-sm transition-colors border-b-2 ${activeTab === 'missing' ? 'border-yellow-500 text-yellow-400 bg-yellow-500/5' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
                        >
                            Missing ({smartResults?.missing?.length || 0})
                        </button>
                    </div>

                    {/* Toolbar */}
                    <div className="p-4 flex items-center justify-between bg-white/[0.02]">
                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={isAllSelected}
                                onChange={(e) => handleSelectAll(e.target.checked)}
                                className="w-4 h-4 rounded border-gray-600 bg-black/40 text-accent-500 focus:ring-accent-500 focus:ring-offset-0"
                            />
                            <span className="text-sm text-text-secondary">{selectedIds.size} selected</span>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={handleExport} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg text-xs font-medium text-text-primary transition-colors">
                                Export List
                            </button>
                            {selectedIds.size > 0 && (
                                <>
                                    <button onClick={handleRepair} className="px-3 py-1.5 bg-accent-600/20 hover:bg-accent-600/30 text-accent-400 border border-accent-600/20 rounded-lg text-xs font-medium transition-colors">
                                        Retry
                                    </button>
                                    <button onClick={handleDelete} disabled={isProcessing} className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-medium transition-colors shadow-glow-red disabled:opacity-50">
                                        {isProcessing ? 'Deleting...' : 'Delete Selected'}
                                    </button>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-auto custom-scrollbar p-0">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-black/40 sticky top-0 z-10 backdrop-blur-md">
                                <tr>
                                    <th className="p-4 py-3 w-12 border-b border-white/5"></th>
                                    <th className="p-4 py-3 text-xs font-bold text-text-tertiary uppercase border-b border-white/5">Filename</th>
                                    <th className="p-4 py-3 text-xs font-bold text-text-tertiary uppercase border-b border-white/5">Path</th>
                                    <th className="p-4 py-3 text-xs font-bold text-text-tertiary uppercase border-b border-white/5 w-24">Size</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {currentItems.map((item: any) => (
                                    <tr key={item.id} className={`hover:bg-white/5 transition-colors ${selectedIds.has(item.id) ? 'bg-accent-500/5' : ''}`}>
                                        <td className="p-4 py-3 text-center">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(item.id)}
                                                onChange={(e) => handleToggleSelect(item.id, e.target.checked)}
                                                className="w-4 h-4 rounded border-gray-600 bg-black/40 text-accent-500 focus:ring-accent-500 focus:ring-offset-0"
                                            />
                                        </td>
                                        <td className="p-4 py-3">
                                            <div className="font-medium text-sm text-text-primary truncate max-w-[200px]" title={item.name}>{item.name}</div>
                                        </td>
                                        <td className="p-4 py-3">
                                            <div className="text-xs font-mono text-text-secondary truncate max-w-[300px]" title={item.path}>{item.path}</div>
                                        </td>
                                        <td className="p-4 py-3">
                                            <span className="text-xs text-text-tertiary font-mono">{(item.size / 1024 / 1024).toFixed(2)} MB</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {currentItems.length === 0 && (
                            <div className="flex flex-col items-center justify-center h-48 text-text-tertiary">
                                <Icons.Check size={32} className="mb-2 opacity-50" />
                                <p>No items found in this category.</p>
                            </div>
                        )}
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
