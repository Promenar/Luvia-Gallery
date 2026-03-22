import React from 'react';
import { motion } from 'framer-motion';
import { Icons } from '../ui/Icon';
import { useLanguage } from '../../contexts/LanguageContext';
import { ExtendedSystemStatus } from '../../types';
import { Card, CardHeader, CardContent } from '../ui/Card';
import { Badge } from '../ui/Badge';

interface SystemTabProps {
  isServerMode: boolean;
  systemStatus: ExtendedSystemStatus | null;
  onExportConfig: () => void;
}

export const SystemTab: React.FC<SystemTabProps> = ({
  isServerMode,
  systemStatus,
  onExportConfig,
}) => {
  const { t } = useLanguage();

  const statusBadge = (active: boolean, label: string) => (
    <Badge variant={active ? 'success' : 'error'} size="sm">
      {label}
    </Badge>
  );

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-8"
    >
      {/* 连接模式 */}
      <section>
        <h4 className="text-sm font-bold uppercase text-text-tertiary tracking-wider mb-4">
          {t('connection')}
        </h4>
        <div className="bg-black/20 p-1 rounded-xl inline-flex w-full md:w-auto border border-white/5">
          {['client', 'server'].map((mode) => (
            <button
              key={mode}
              className={`flex-1 md:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-all ${
                (mode === 'server') === isServerMode
                  ? 'glass-2 text-text-primary shadow-glow'
                  : 'text-text-tertiary hover:bg-white/5'
              }`}
            >
              {t(mode + '_mode')}
            </button>
          ))}
        </div>
      </section>

      {/* 系统状态 */}
      {isServerMode && systemStatus && (
        <section>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 后端组件 */}
            <Card variant="glass" padding="lg">
              <CardHeader
                title={t('backend_components')}
                icon={<Icons.Cpu size={18} className="text-accent-400" />}
              />
              <CardContent>
                <div className="space-y-3">
                  {/* FFmpeg */}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-secondary">FFmpeg (Video)</span>
                    {statusBadge(systemStatus.ffmpeg, systemStatus.ffmpeg ? t('active') : t('missing'))}
                  </div>

                  {/* 图片处理器 */}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-secondary">{t('image_processor')}</span>
                    {statusBadge(
                      systemStatus.ffmpeg || systemStatus.sharp,
                      systemStatus.imageProcessor || 'Active'
                    )}
                  </div>

                  {/* 数据库 */}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-secondary">Database</span>
                    {statusBadge(
                      systemStatus.dbStatus === 'connected',
                      systemStatus.dbStatus === 'connected' ? 'Connected' : systemStatus.dbStatus || 'Unknown'
                    )}
                  </div>

                  {/* GPU加速 */}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-text-secondary">GPU Acceleration</span>
                    <Badge
                      variant={systemStatus.hardwareAcceleration?.type && systemStatus.hardwareAcceleration.type !== 'none' ? 'info' : 'default'}
                      size="sm"
                    >
                      {systemStatus.hardwareAcceleration?.type === 'cuda'
                        ? 'NVIDIA CUDA'
                        : systemStatus.hardwareAcceleration?.type === 'vaapi'
                        ? 'Intel/AMD VAAPI'
                        : 'Disabled'}
                    </Badge>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-3 mt-3 border-t border-white/10">
                  <span className="text-xs text-text-tertiary">Platform</span>
                  <code className="text-xs font-mono text-text-secondary bg-black/20 px-2 py-0.5 rounded">
                    {systemStatus.platform}
                  </code>
                </div>
              </CardContent>
            </Card>

            {/* 媒体统计 */}
            <Card variant="glass" padding="lg">
              <CardHeader
                title={t('media_statistics')}
                icon={<Icons.Database size={18} className="text-accent-400" />}
              />
              <CardContent>
                <div className="space-y-3">
                  {[
                    { label: t('total_files'), value: systemStatus.mediaStats?.totalFiles || 0, icon: Icons.List, color: 'text-accent-400' },
                    { label: t('images'), value: systemStatus.mediaStats?.images || 0, icon: Icons.Image, color: 'text-green-400' },
                    { label: t('videos'), value: systemStatus.mediaStats?.videos || 0, icon: Icons.Play, color: 'text-blue-400' },
                    { label: t('audio'), value: systemStatus.mediaStats?.audio || 0, icon: Icons.Music, color: 'text-purple-400' },
                  ].map((stat, i) => (
                    <div key={i} className="flex items-center justify-between p-3 card-stat-premium rounded-xl">
                      <div className="flex items-center gap-4">
                        <div className={`p-2 rounded-lg bg-white/10 ${stat.color}`}>
                          <stat.icon size={20} />
                        </div>
                        <span className="text-sm font-bold text-text-secondary">{stat.label}</span>
                      </div>
                      <span className="text-xl font-black font-mono text-text-primary">
                        {stat.value.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* 导出配置 */}
      <section className="pt-4 border-t border-white/10">
        <button
          onClick={onExportConfig}
          className="text-sm font-medium text-accent-400 hover:text-accent-300 hover:underline flex items-center gap-2 transition-colors"
        >
          <Icons.Download size={16} />
          {t('backup_config')}
        </button>
      </section>
    </motion.div>
  );
};
