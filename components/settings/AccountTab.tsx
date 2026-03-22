import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Icons } from '../ui/Icon';
import { useLanguage } from '../../contexts/LanguageContext';
import { User } from '../../types';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Badge } from '../ui/Badge';

interface AccountTabProps {
  users: User[];
  currentUser: User | null;
  isServerMode: boolean;
  onLogout: () => void;
  onAddUser: () => void;
  onRenameUser: (user: User) => void;
  onResetPassword: (user: User) => void;
  onDeleteUser: (user: User) => void;
  wallpaperToken: string;
  justCopied: boolean;
  wallpaperConfig: any;
  setWallpaperConfig: (config: any) => void;
  handleGenerateWallpaperToken: () => void;
  handleSaveWallpaperConfig: () => void;
  copyToClipboard: (text: string) => void;
  onSetDirPickerContext: (ctx: 'library' | 'userAllowedPaths' | 'wallpaper') => void;
  onShowDirPicker: (show: boolean) => void;
  baseUrl: string;
}

export const AccountTab: React.FC<AccountTabProps> = ({
  users,
  currentUser,
  isServerMode,
  onLogout,
  onAddUser,
  onRenameUser,
  onResetPassword,
  onDeleteUser,
  wallpaperToken,
  justCopied,
  wallpaperConfig,
  setWallpaperConfig,
  handleGenerateWallpaperToken,
  handleSaveWallpaperConfig,
  copyToClipboard,
  onSetDirPickerContext,
  onShowDirPicker,
  baseUrl,
}) => {
  const { t } = useLanguage();
  const visibleUsers = users.filter((u) => currentUser?.isAdmin || u.username === currentUser?.username);

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-8"
    >
      {/* 用户管理 */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-sm font-bold uppercase text-text-tertiary tracking-wider">
            {t('users')}
          </h4>
          {currentUser?.isAdmin && (
            <Button variant="ghost" size="sm" icon={<Icons.Plus size={16} />} onClick={onAddUser}>
              {t('add_user')}
            </Button>
          )}
        </div>

        <Card variant="glass" padding="none">
          {visibleUsers.map((u, idx, arr) => (
            <div
              key={u.username}
              className={`p-4 flex items-center justify-between hover:bg-white/5 transition-colors ${
                idx !== arr.length - 1 ? 'border-b border-white/5' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-accent-500/10 text-accent-400 flex items-center justify-center font-bold shadow-glow overflow-hidden relative group/avatar">
                  <span className="relative z-10">{u.username[0].toUpperCase()}</span>
                </div>
                <div>
                  <div className="font-bold flex items-center gap-2 text-text-primary">
                    {u.username}
                    {u.username === currentUser?.username && (
                      <Badge variant="success" size="sm">You</Badge>
                    )}
                  </div>
                  <div className="text-xs text-text-secondary">
                    {u.isAdmin ? 'Administrator' : 'User'}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                {(u.username === currentUser?.username || currentUser?.isAdmin) && (
                  <button
                    onClick={() => onResetPassword(u)}
                    className="p-2 text-text-tertiary hover:text-accent-400 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <Icons.Lock size={16} />
                  </button>
                )}
                {currentUser?.isAdmin && (
                  <>
                    <button
                      onClick={() => onRenameUser(u)}
                      className="p-2 text-text-tertiary hover:text-yellow-400 hover:bg-white/10 rounded-lg transition-colors"
                    >
                      <Icons.Edit size={16} />
                    </button>
                    {u.username !== currentUser?.username && (
                      <button
                        onClick={() => onDeleteUser(u)}
                        className="p-2 text-text-tertiary hover:text-red-400 hover:bg-white/10 rounded-lg transition-colors"
                      >
                        <Icons.Trash size={16} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>
      </section>

      {/* 壁纸Token */}
      {isServerMode && currentUser && (
        <section className="mt-8 pt-6 border-t border-white/10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1.5 h-6 bg-accent-500 rounded-full shadow-[0_0_10px_var(--accent-500)]" />
            <h4 className="text-sm font-bold uppercase text-text-tertiary tracking-wider">
              {t('wallpaper_token')}
            </h4>
          </div>

          <Card variant="glass" padding="lg">
            <p className="text-xs text-text-secondary mb-4">{t('wallpaper_token_desc')}</p>

            {!wallpaperToken ? (
              <Button
                variant="primary"
                icon={<Icons.Zap size={18} />}
                onClick={handleGenerateWallpaperToken}
              >
                {t('generate_wallpaper_token')}
              </Button>
            ) : (
              <div className="space-y-4">
                <div className="p-3 bg-black/40 rounded-xl flex items-center justify-between gap-4 shadow-inner">
                  <div className="flex-1 overflow-hidden">
                    <span className="text-[10px] text-text-tertiary font-bold uppercase block mb-1">
                      {t('wallpaper_token')}
                    </span>
                    <code className="text-xs text-text-primary font-mono truncate block opacity-90">
                      {wallpaperToken}
                    </code>
                  </div>
                  <button
                    onClick={() => copyToClipboard(wallpaperToken)}
                    className="p-2 hover:bg-white/10 rounded-lg text-accent-400 transition-colors shrink-0"
                    title="Copy Token"
                  >
                    {justCopied ? <Icons.Check size={18} /> : <Icons.Copy size={18} />}
                  </button>
                </div>

                {/* 复制壁纸URL按钮 */}
                <Button
                  variant="primary"
                  icon={<Icons.Link size={16} />}
                  onClick={() => {
                    const params = new URLSearchParams();
                    params.set('token', wallpaperToken);
                    params.set('mode', wallpaperConfig.mode);
                    if (wallpaperConfig.mode === 'folder' && wallpaperConfig.path) {
                      params.set('path', wallpaperConfig.path);
                    }
                    params.set('interval', wallpaperConfig.interval.toString());
                    params.set('info', wallpaperConfig.showInfo.toString());
                    params.set('videos', wallpaperConfig.showVideos.toString());
                    const url = `${baseUrl || window.location.origin}/wallpaper/index.html?${params.toString()}`;
                    copyToClipboard(url);
                    handleSaveWallpaperConfig();
                  }}
                  fullWidth
                >
                  {t('copy_wallpaper_url')}
                </Button>

                {justCopied && (
                  <p className="text-[10px] text-green-400 font-bold text-center animate-bounce">
                    {t('token_generated')} & Copied!
                  </p>
                )}
              </div>
            )}
          </Card>
        </section>
      )}

      {/* 退出登录 */}
      <div className="flex justify-end mt-8 border-t border-white/10 pt-6">
        <Button variant="danger" icon={<Icons.LogOut size={18} />} onClick={onLogout}>
          {t('sign_out')}
        </Button>
      </div>
    </motion.div>
  );
};
