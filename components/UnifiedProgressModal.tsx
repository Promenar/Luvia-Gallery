
import React from 'react';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from './kit/dialog';
import { Button } from './kit/button';
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

    const isIdle = !isScanActive && !isThumbActive && thumbQueue.length === 0;
    const thumbPercent = Math.round((thumbCount / (thumbTotal || 1)) * 100);

    const renderProgressBar = (progress: number) => (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out" style={{ width: `${progress}%` }} />
        </div>
    );

    const renderTaskControls = (status: string, onPause: () => void, onResume: () => void, onStop: () => void) => (
        <div className="flex items-center gap-1">
            {status === 'paused' ? (
                <Button variant="ghost" size="icon-sm" onClick={onResume} aria-label={t('resume')} title={t('resume')}>
                    <Icons.Play />
                </Button>
            ) : (
                <Button variant="ghost" size="icon-sm" onClick={onPause} aria-label={t('pause')} title={t('pause')}>
                    <Icons.Pause />
                </Button>
            )}
            <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" onClick={onStop} aria-label={t('stop')} title={t('stop')}>
                <Icons.Stop />
            </Button>
        </div>
    );

    const taskIconClass = (active: boolean) =>
        `rounded-lg p-2 ${active ? 'bg-accent text-primary' : 'bg-muted text-muted-foreground'}`;

    return (
        <>
            <Dialog
                open={isOpen && !isMinimized}
                onOpenChange={open => {
                    if (open) return;
                    // 任务进行中关闭弹窗等同于最小化，避免丢失进度入口
                    if (isIdle) onClose();
                    else setIsMinimized(true);
                }}
            >
                <DialogContent showCloseButton={false} className="flex max-h-[80vh] w-[calc(100%-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
                    <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
                        <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                            {!isIdle && <Icons.Refresh className="animate-spin text-primary" size={16} />}
                            {t('background_tasks')}
                        </DialogTitle>
                        <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon-sm" onClick={() => setIsMinimized(true)} aria-label={t('minimize')} title={t('minimize')}>
                                <Icons.Minus />
                            </Button>
                            {isIdle && (
                                <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('close')} title={t('close')}>
                                    <Icons.Close />
                                </Button>
                            )}
                        </div>
                    </div>

                    <div className="space-y-5 overflow-y-auto p-5">
                        {showScan && (
                            <section className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className={taskIconClass(isScanActive)}><Icons.Search size={18} /></div>
                                        <div>
                                            <h4 className="text-sm font-medium">{t('library_scan')}</h4>
                                            <p className="text-xs tabular-nums text-muted-foreground">
                                                {scanStatus === 'idle' || scanStatus === 'completed' ? t('waiting_finished') :
                                                    scanStatus === 'paused' ? t('paused') :
                                                        `${t('processed')}: ${scanCount}`}
                                            </p>
                                        </div>
                                    </div>
                                    {isScanActive && renderTaskControls(scanStatus, onScanPause, onScanResume, onScanStop)}
                                </div>
                                {isScanActive && (
                                    <div className="truncate rounded-md bg-muted/60 px-2 py-1.5 font-mono text-xs text-muted-foreground">
                                        {scanCurrentPath || t('scanning_library')}
                                    </div>
                                )}
                            </section>
                        )}

                        {showScan && (showThumb || showQueue) && <div className="h-px bg-border" />}

                        {showThumb && (
                            <section className="space-y-3">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className={taskIconClass(isThumbActive)}><Icons.Image size={18} /></div>
                                        <div>
                                            <h4 className="text-sm font-medium">{t('thumbnails')}</h4>
                                            <p className="text-xs tabular-nums text-muted-foreground">
                                                {thumbStatus === 'idle' ? t('waiting_finished') :
                                                    thumbStatus === 'paused' ? t('paused') :
                                                        `${thumbCount} / ${thumbTotal} (${thumbPercent}%)`}
                                            </p>
                                        </div>
                                    </div>
                                    {isThumbActive && renderTaskControls(thumbStatus, onThumbPause, onThumbResume, onThumbStop)}
                                </div>

                                {smartResults && (smartResults.missing.length > 0 || smartResults.error.length > 0) && (
                                    <div className="flex gap-2">
                                        {smartResults.missing.length > 0 && (
                                            <span className="rounded-md border border-primary/30 bg-accent px-2 py-0.5 text-xs tabular-nums text-accent-foreground">
                                                {t('missing_count').replace('{count}', String(smartResults.missing.length))}
                                            </span>
                                        )}
                                        {smartResults.error.length > 0 && (
                                            <span className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs tabular-nums text-destructive">
                                                {t('corrupted_count').replace('{count}', String(smartResults.error.length))}
                                            </span>
                                        )}
                                    </div>
                                )}

                                {isThumbActive && (
                                    <>
                                        {renderProgressBar(thumbPercent)}
                                        <div className="truncate rounded-md bg-muted/60 px-2 py-1.5 font-mono text-xs text-muted-foreground">
                                            {thumbCurrentPath || t('processing')}
                                        </div>
                                    </>
                                )}

                                {!isThumbActive && thumbStatus === 'idle' && smartResults && (smartResults.missing.length > 0 || smartResults.error.length > 0) && (
                                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-3">
                                        <p className="text-xs text-muted-foreground">{t('analysis_issues')}</p>
                                        {onStartRepair && (
                                            <Button
                                                size="sm"
                                                onClick={() => {
                                                    onStartRepair();
                                                    onClose(); // 关闭以触发父级刷新
                                                }}
                                            >
                                                {t('repair_now')}
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </section>
                        )}

                        {showQueue && (
                            <>
                                <div className="h-px bg-border" />
                                <section className="space-y-2">
                                    <h4 className="text-xs font-medium text-muted-foreground">
                                        {t('pending_tasks').replace('{count}', String(thumbQueue.length))}
                                    </h4>
                                    {thumbQueue.map((task) => (
                                        <div key={task.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium">{task.name}</p>
                                                <p className="text-xs tabular-nums text-muted-foreground">{t('files_count').replace('{count}', String(task.total))}</p>
                                            </div>
                                            {onThumbCancelTask && (
                                                <Button variant="ghost" size="icon-sm" onClick={() => onThumbCancelTask(task.id)} aria-label={t('cancel')} title={t('cancel')}>
                                                    <Icons.Close />
                                                </Button>
                                            )}
                                        </div>
                                    ))}
                                </section>
                            </>
                        )}
                    </div>

                    {isIdle && (
                        <DialogFooter className="mx-0 mb-0">
                            <Button variant="outline" onClick={onClose}>{t('close')}</Button>
                        </DialogFooter>
                    )}
                </DialogContent>
            </Dialog>

            {/* 最小化：右下角非模态进度卡，不阻挡浏览 */}
            {isOpen && isMinimized && (
                <div
                    role="status"
                    className="fixed right-4 bottom-4 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-[0_16px_48px_-16px_rgba(0,0,0,0.5)] animate-in fade-in-0 slide-in-from-bottom-4 md:right-6 md:bottom-6"
                >
                    {isScanActive || isThumbActive ? (
                        <Icons.Refresh className="animate-spin text-primary" size={18} />
                    ) : (
                        <Icons.Check className="text-primary" size={18} />
                    )}
                    <div className="min-w-0 flex-1">
                        <h4 className="truncate text-sm font-medium">
                            {isScanActive ? t('scanning_library') : (isThumbActive ? t('generating_thumbnails') : t('tasks_completed'))}
                        </h4>
                        <p className="truncate text-xs tabular-nums text-muted-foreground">
                            {isScanActive
                                ? `${scanCount} ${t('files_processed')}`
                                : isThumbActive
                                    ? `${thumbPercent}${t('percent_complete')}`
                                    : t('all_jobs_finished')}
                        </p>
                    </div>
                    <Button variant="ghost" size="icon-sm" onClick={() => setIsMinimized(false)} aria-label={t('expand')} title={t('expand')}>
                        <Icons.Maximize />
                    </Button>
                    {!isScanActive && !isThumbActive && (
                        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('close')} title={t('close')}>
                            <Icons.Close />
                        </Button>
                    )}
                </div>
            )}
        </>
    );
};

