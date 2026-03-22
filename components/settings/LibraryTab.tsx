import React from 'react';
import { motion } from 'framer-motion';
import { Icons } from '../ui/Icon';
import { useLanguage } from '../../contexts/LanguageContext';
import { ExtendedSystemStatus } from '../../types';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';

interface LibraryTabProps {
  isServerMode: boolean;
  libraryPaths: string[];
  systemStatus: ExtendedSystemStatus | null;
  newPathInput: string;
  setNewPathInput: (val: string) => void;
  threadCount: number;
  onAddLibraryPath: (e?: React.FormEvent) => void;
  onRemoveLibraryPath: (path: string) => void;
  onMonitorUpdate: (mode: 'manual' | 'periodic', interval?: number) => void;
  onStartScan: () => void;
  onStartThumbGen: () => void;
  onSmartScan: () => void;
  onSmartRepair: () => void;
  onUpdateThreadCount: (count: number) => void;
  onPruneCache: () => void;
  onClearCache: () => void;
  onShowDirPicker: (show: boolean) => void;
  onOpenScanReport?: () => void;
  smartScanResults: any;
  thumbStatus: string;
}

export const LibraryTab: React.FC<LibraryTabProps> = ({
  isServerMode,
  libraryPaths,
  systemStatus,
  newPathInput,
  setNewPathInput,
  threadCount,
  onAddLibraryPath,
  onRemoveLibraryPath,
  onMonitorUpdate,
  onStartScan,
  onStartThumbGen,
  onSmartScan,
  onSmartRepair,
  onUpdateThreadCount,
  onPruneCache,
  onClearCache,
  onShowDirPicker,
  onOpenScanReport,
  smartScanResults,
  thumbStatus,
}) => {
  const { t } = useLanguage();

  // 客户端模式提示
  if (!isServerMode) {
    return (
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="flex flex-col items-center justify-center p-8 glass-1 rounded-2xl border border-dashed border-white/10"
      >
        <div className="p-4 bg-white/5 rounded-full mb-4 text-text-secondary">
          <Icons.Server size={32} />
        </div>
        <h4 className="text-lg font-bold mb-2 text-text-primary">
          {t('running_client_mode')}
        </h4>
        <p className="text-center text-sm text-text-secondary max-w-sm mb-6">
          {t('client_mode_description')}
        </p>
        <Button variant="primary">
          {t('switch_to_server')}
        </Button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-8"
    >
      {/* 库统计 */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1.5 h-6 bg-accent-500 rounded-full shadow-[0_0_10px_var(--accent-500)]" />
          <h4 className="text-lg font-bold text-text-primary">{t('library_stats')}</h4>
        </div>

        <Card variant="glass" padding="lg">
          <CardHeader
            title={t('library_scan_paths')}
            action={
              <Button variant="primary" size="sm" icon={<Icons.Scan size={14} />} onClick={onStartScan}>
                {t('scan_library')}
              </Button>
            }
          />
          <CardContent className="mt-4">
            <form onSubmit={onAddLibraryPath} className="flex gap-2 mb-4">
              <div className="flex-1 relative">
                <Input
                  value={newPathInput}
                  onChange={(e) => setNewPathInput(e.target.value)}
                  placeholder="/media"
                  variant="glass"
                />
                <button
                  type="button"
                  onClick={() => onShowDirPicker(true)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-text-tertiary hover:text-accent-400 hover:bg-white/10 rounded-md transition-colors"
                  title={t('browse')}
                >
                  <Icons.FolderOpen size={16} />
                </button>
              </div>
              <Button variant="primary" icon={<Icons.Plus size={18} />}>
                {t('add_path')}
              </Button>
            </form>

            {/* 路径列表 */}
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {libraryPaths.length === 0 ? (
                <div className="p-4 text-center text-sm text-text-tertiary italic">
                  {t('scanning_default')} <code className="font-mono bg-white/10 px-1 rounded">/media</code>
                </div>
              ) : (
                libraryPaths.map((path) => (
                  <div
                    key={path}
                    className="flex items-center justify-between p-3 glass-2 rounded-xl border border-white/5 shadow-inner group"
                  >
                    <div className="flex items-center gap-3">
                      <Icons.Folder size={18} className="text-accent-500" />
                      <span className="font-mono text-sm text-text-primary">{path}</span>
                    </div>
                    <button
                      onClick={() => onRemoveLibraryPath(path)}
                      className="text-red-400 opacity-0 group-hover:opacity-100 p-2 hover:bg-white/10 rounded-lg transition-all"
                    >
                      <Icons.Trash size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* 维护 */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1.5 h-6 bg-blue-500 rounded-full shadow-[0_0_10px_var(--blue-500)]" />
          <h4 className="text-lg font-bold text-text-primary">{t('maintenance')}</h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* 缓存管理 */}
          <Card variant="glass" padding="lg" hover>
            <CardHeader
              title={t('cache_management')}
              icon={<Icons.Database size={18} className="text-blue-400" />}
            />
            <CardContent>
              <div className="text-2xl font-bold mb-1 font-mono text-text-primary text-glow">
                {systemStatus?.cacheCount.toLocaleString() || '0'}
                <span className="text-sm font-normal text-text-secondary ml-2">{t('cached')}</span>
              </div>
              <div className="flex gap-2 mt-4">
                <Button variant="secondary" size="sm" onClick={onPruneCache} className="flex-1">
                  {t('clean_duplicate_cache')}
                </Button>
                <Button variant="danger" size="sm" onClick={onClearCache}>
                  {t('clear_all_cache')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 智能修复 */}
          <Card variant="glass" padding="lg" hover>
            <CardHeader
              title={t('smart_repair')}
              icon={<Icons.Zap size={18} className="text-yellow-400" />}
            />
            <CardContent>
              {smartScanResults && smartScanResults.timestamp > 0 ? (
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <Badge variant="error">Missing: {smartScanResults.missing.length}</Badge>
                    </div>
                    <div className="flex-1">
                      <Badge variant="warning">Broken: {smartScanResults.error.length}</Badge>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={onSmartRepair} className="flex-1">
                      {t('repair_now')}
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onSmartScan}>
                      {t('rescan')}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="secondary" size="sm" onClick={onSmartScan} fullWidth>
                  Start Analysis
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </section>
    </motion.div>
  );
};
