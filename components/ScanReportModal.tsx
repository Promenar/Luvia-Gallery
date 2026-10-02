import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogTitle } from './kit/dialog';
import { Button } from './kit/button';
import { Icons } from './ui/Icon';
import { useLanguage } from '../contexts/LanguageContext';
import { notify, useFeedback } from './feedback/feedback';

interface ScanReportModalProps {
    isOpen: boolean;
    onClose: () => void;
    smartResults: { missing: any[], error: any[] };
    onRepair: (selectedIds: string[]) => void;
    onDelete: (selectedIds: string[]) => Promise<void>;
    onNavigate?: (item: any) => void;
}

export const ScanReportModal: React.FC<ScanReportModalProps> = ({
    isOpen,
    onClose,
    smartResults,
    onRepair,
    onDelete,
    onNavigate
}) => {
    const { t } = useLanguage();
    const { confirm } = useFeedback();
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
        navigator.clipboard.writeText(text)
            .then(() => notify.success(t('copied_to_clipboard')))
            .catch(() => notify.error(t('copy_failed')));
    };

    const handleDelete = async () => {
        if (selectedIds.size === 0) return;
        if (!await confirm({ title: t('batch_delete_confirm').replace('{count}', selectedIds.size.toString()), confirmText: t('delete_action'), destructive: true })) return;

        setIsProcessing(true);
        try {
            await onDelete(Array.from(selectedIds));
            setSelectedIds(new Set());
        } catch (e) {
            notify.error(t('delete_failed'));
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

    const checkboxClass = 'size-4 rounded-sm border-input accent-primary';

    return (
        <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
            <DialogContent className="flex h-[80vh] w-[calc(100%-1.5rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
                <div className="flex items-center gap-3 border-b border-border p-4 pr-12">
                    <Icons.Alert size={18} className="text-destructive" />
                    <DialogTitle className="text-base font-semibold">{t('scan_report')}</DialogTitle>
                </div>

                {/* 分类 */}
                <div role="tablist" className="flex border-b border-border">
                    {(['error', 'missing'] as const).map(tab => {
                        const count = tab === 'error' ? (smartResults?.error?.length || 0) : (smartResults?.missing?.length || 0);
                        const isActive = activeTab === tab;
                        return (
                            <button
                                key={tab}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                onClick={() => setActiveTab(tab)}
                                className={`flex-1 border-b-2 py-2.5 text-sm font-medium transition-colors ${isActive ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                            >
                                {tab === 'error' ? t('errors_tab') : t('missing_tab')} <span className="tabular-nums">({count})</span>
                            </button>
                        );
                    })}
                </div>

                {/* 工具条 */}
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                        <input
                            type="checkbox"
                            checked={isAllSelected}
                            onChange={(e) => handleSelectAll(e.target.checked)}
                            className={checkboxClass}
                        />
                        <span className="tabular-nums">{t('selected_count').replace('{count}', String(selectedIds.size))}</span>
                    </label>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={handleExport}>{t('export_list')}</Button>
                        {selectedIds.size > 0 && (
                            <>
                                <Button variant="secondary" size="sm" onClick={handleRepair}>{t('retry')}</Button>
                                <Button variant="destructive" size="sm" onClick={handleDelete} disabled={isProcessing}>
                                    {isProcessing ? t('deleting') : t('delete_selected')}
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {/* 列表 */}
                <div className="flex-1 overflow-auto custom-scrollbar">
                    <table className="w-full border-collapse text-left">
                        <thead className="sticky top-0 z-10 bg-popover">
                            <tr className="border-b border-border text-xs text-muted-foreground">
                                <th className="w-12 px-4 py-2.5"></th>
                                <th className="px-4 py-2.5 font-medium">{t('filename')}</th>
                                <th className="px-4 py-2.5 font-medium">{t('path')}</th>
                                <th className="w-24 px-4 py-2.5 font-medium">{t('size')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {currentItems.map((item: any) => (
                                <tr key={item.id} className={`transition-colors hover:bg-accent/40 ${selectedIds.has(item.id) ? 'bg-accent/60' : ''}`}>
                                    <td className="px-4 py-2.5 text-center">
                                        <input
                                            type="checkbox"
                                            aria-label={item.name}
                                            checked={selectedIds.has(item.id)}
                                            onChange={(e) => handleToggleSelect(item.id, e.target.checked)}
                                            className={checkboxClass}
                                        />
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <div className="max-w-[200px] truncate text-sm font-medium" title={item.name}>{item.name}</div>
                                    </td>
                                    <td className="px-4 py-2.5">
                                        {onNavigate ? (
                                            <button
                                                type="button"
                                                className="max-w-[300px] truncate font-mono text-xs text-primary hover:underline"
                                                title={item.path}
                                                onClick={() => onNavigate(item)}
                                            >
                                                {item.path}
                                            </button>
                                        ) : (
                                            <div className="max-w-[300px] truncate font-mono text-xs text-muted-foreground" title={item.path}>{item.path}</div>
                                        )}
                                    </td>
                                    <td className="px-4 py-2.5">
                                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{(item.size / 1024 / 1024).toFixed(2)} MB</span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {currentItems.length === 0 && (
                        <div className="flex h-48 flex-col items-center justify-center text-muted-foreground">
                            <Icons.Check size={24} className="mb-2 opacity-60" />
                            <p className="text-sm">{t('no_items_in_category')}</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
