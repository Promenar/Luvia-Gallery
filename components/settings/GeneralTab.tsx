import React from 'react';
import { motion } from 'framer-motion';
import { Icons } from '../ui/Icon';
import { useLanguage } from '../../contexts/LanguageContext';
import { HomeScreenConfig } from '../../types';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface GeneralTabProps {
  appTitle: string;
  homeSubtitle: string;
  language: 'en' | 'zh';
  homeConfig: HomeScreenConfig;
  theme: string;
  onUpdateTitle: (val: string) => void;
  onUpdateSubtitle: (val: string) => void;
  onUpdateHomeConfig: (config: HomeScreenConfig) => void;
  setLanguage: (lang: 'en' | 'zh') => void;
  onToggleTheme: () => void;
}

export const GeneralTab: React.FC<GeneralTabProps> = ({
  appTitle,
  homeSubtitle,
  language,
  homeConfig,
  theme,
  onUpdateTitle,
  onUpdateSubtitle,
  onUpdateHomeConfig,
  setLanguage,
  onToggleTheme,
}) => {
  const { t } = useLanguage();

  const homeModes = [
    { key: 'random', label: t('random_all') },
    { key: 'favorites', label: t('favorites') },
    { key: 'folder', label: t('specific_folder') },
    { key: 'single', label: t('single_item') },
  ] as const;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="space-y-8"
    >
      {/* 外观设置 */}
      <section>
        <h4 className="text-sm font-bold uppercase text-text-tertiary tracking-wider mb-4 opacity-80">
          {t('appearance')}
        </h4>
        <div className="space-y-4">
          {/* 网站标题 */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">
              {t('website_title')}
            </label>
            <Input
              value={appTitle}
              onChange={(e) => onUpdateTitle(e.target.value)}
              variant="glass"
            />
          </div>

          {/* 首页副标题 */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">
              {t('home_subtitle')}
            </label>
            <Input
              value={homeSubtitle}
              onChange={(e) => onUpdateSubtitle(e.target.value)}
              variant="glass"
            />
          </div>

          {/* 语言 */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">
              {t('language')}
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'en' | 'zh')}
              className="w-full px-4 py-2 rounded-xl input-premium [&>option]:text-black"
            >
              <option value="en">English</option>
              <option value="zh">中文 (Chinese)</option>
            </select>
          </div>

          {/* 主题切换 */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-text-secondary">
              {t('theme')}
            </label>
            <div className="flex gap-2">
              {(['system', 'light', 'dark'] as const).map((mode) => (
                <Button
                  key={mode}
                  variant={theme === mode ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={onToggleTheme}
                  className="flex-1"
                >
                  {mode === 'system' ? <Icons.Monitor size={16} /> : 
                   mode === 'light' ? <Icons.Sun size={16} /> : 
                   <Icons.Moon size={16} />}
                  <span className="ml-2 capitalize">{t(mode + '_mode')}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* 首屏配置 */}
          <div>
            <label className="block text-sm font-medium mb-2 text-text-secondary">
              {t('home_screen_conf')}
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {homeModes.map((mode) => (
                <button
                  key={mode.key}
                  onClick={() => onUpdateHomeConfig({ ...homeConfig, mode: mode.key })}
                  className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-all border ${
                    homeConfig.mode === mode.key
                      ? 'button-premium-active border-accent-500/30 shadow-glow'
                      : 'button-premium-ghost hover:border-white/10'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            {(homeConfig.mode === 'folder' || homeConfig.mode === 'single') && (
              <Input
                placeholder={t('enter_rel_path')}
                value={homeConfig.path || ''}
                onChange={(e) => onUpdateHomeConfig({ ...homeConfig, path: e.target.value })}
                variant="glass"
                className="font-mono text-xs"
              />
            )}
          </div>
        </div>
      </section>
    </motion.div>
  );
};
