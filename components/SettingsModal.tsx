import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from './ui/Icon';
import { User, ExtendedSystemStatus, HomeScreenConfig } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import SystemUpdater from './SystemUpdater';

export type SettingsTab = 'general' | 'library' | 'system' | 'account';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    appTitle: string;
    homeSubtitle: string;
    language: 'en' | 'zh';
    homeConfig: HomeScreenConfig;
    isServerMode: boolean;
    libraryPaths: string[];
    systemStatus: ExtendedSystemStatus | null;
    threadCount: number;
    users: User[];
    currentUser: User | null;
    newPathInput: string;
    setNewPathInput: (val: string) => void;
    setLanguage: (lang: 'en' | 'zh') => void;
    setIsServerMode: (val: boolean) => void;
    onUpdateTitle: (val: string) => void;
    onUpdateSubtitle: (val: string) => void;
    onUpdateHomeConfig: (config: HomeScreenConfig) => void;
    onAddLibraryPath: (e?: React.FormEvent) => void;
    onRemoveLibraryPath: (path: string) => void;
    onMonitorUpdate: (mode: 'manual' | 'periodic', interval?: number) => void;
    onStartScan: () => void;
    onStartThumbGen: () => void;
    onSmartScan: () => void;
    onSmartRepair: () => void;
    onExportConfig: () => void;
    onLogout: () => void;
    onAddUser: () => void;
    onRenameUser: (user: User) => void;
    onResetPassword: (user: User) => void;
    onDeleteUser: (user: User) => void;
    onSetDirPickerContext: (ctx: 'library' | 'userAllowedPaths') => void;
    onShowDirPicker: (val: boolean) => void;
    onUpdateThreadCount: (count: number) => void;
    onPruneCache: () => void;
    onClearCache: () => void;
    onFetchSmartResults: () => void;
    smartScanResults: any;
    thumbStatus: string;
    activeTab?: SettingsTab;
    onTabChange?: (tab: SettingsTab) => void;
    theme?: string;
    onToggleTheme?: () => void;
    onGenerateWallpaperToken?: (config?: any) => Promise<string>;
    onFetchWallpaperToken?: () => Promise<{ token: string, config: any }>;
    baseUrl?: string;
}

export const SettingsModal: React.FC<SettingsModalProps> = (props) => {
    const { t } = useLanguage();
    const [activeTab, setActiveTab] = useState<SettingsTab>('general');

    const {
        isOpen, onClose, appTitle, homeSubtitle, language, homeConfig,
        isServerMode, libraryPaths, systemStatus, threadCount, users, currentUser,
        newPathInput, setNewPathInput, setLanguage, setIsServerMode,
        onUpdateTitle, onUpdateSubtitle, onUpdateHomeConfig, onAddLibraryPath,
        onRemoveLibraryPath, onMonitorUpdate, onStartScan, onStartThumbGen,
        onSmartScan, onSmartRepair, onExportConfig, onLogout, onAddUser,
        onRenameUser, onResetPassword, onDeleteUser, onSetDirPickerContext,
        onShowDirPicker, onUpdateThreadCount, onPruneCache, onClearCache, onFetchSmartResults, smartScanResults, thumbStatus,
        activeTab: externalTab, onTabChange, theme, onToggleTheme,
        onGenerateWallpaperToken, onFetchWallpaperToken, baseUrl
    } = props;

    // Sync with external tab state
    useEffect(() => {
        if (externalTab) {
            setActiveTab(externalTab);
        }
    }, [externalTab]);

    // Reset to general when opened if not specified
    useEffect(() => {
        if (isOpen && !externalTab) {
            setActiveTab('general');
        }
    }, [isOpen, externalTab]);

    // Refresh smart results when system tab is opened
    useEffect(() => {
        if (isOpen && activeTab === 'system') {
            onFetchSmartResults();
        }
    }, [isOpen, activeTab]);

    // Fetch existing wallpaper token when account tab is opened
    useEffect(() => {
        if (isOpen && activeTab === 'account' && onFetchWallpaperToken) {
            onFetchWallpaperToken().then(res => {
                if (res.token) setWallpaperToken(res.token);
                if (res.config) setWallpaperConfig(res.config);
            });
        }
    }, [isOpen, activeTab]);

    const [wallpaperToken, setWallpaperToken] = useState('');
    const [justCopied, setJustCopied] = useState(false);
    const [wallpaperConfig, setWallpaperConfig] = useState<{ mode: 'random' | 'folder' | 'favorites', path: string, interval: number }>({
        mode: 'random',
        path: '',
        interval: 30
    });

    const handleGenerateWallpaperToken = async () => {
        if (onGenerateWallpaperToken) {
            const token = await onGenerateWallpaperToken(wallpaperConfig);
            setWallpaperToken(token);
        }
    };

    const handleSaveWallpaperConfig = async () => {
        if (onGenerateWallpaperToken) {
            // Re-using the same POST endpoint to save config even without regenerating token
            await onGenerateWallpaperToken(wallpaperConfig);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setJustCopied(true);
        setTimeout(() => setJustCopied(false), 2000);
    };

    if (!isOpen) return null;

    const renderContent = () => {
        switch (activeTab) {
            case 'general':
                return (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        <section>
                            <h4 className="text-sm font-bold uppercase text-text-tertiary tracking-wider mb-4 opacity-80">{t('appearance')}</h4>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-text-secondary">{t('website_title')}</label>
                                    <input
                                        value={appTitle}
                                        onChange={e => onUpdateTitle(e.target.value)}
                                        className="w-full px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-text-primary placeholder-text-muted outline-none focus:ring-1 focus:ring-accent-500/50 focus:border-accent-500/50 transition-all font-medium"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-text-secondary">{t('home_subtitle')}</label>
                                    <input
                                        value={homeSubtitle}
                                        onChange={e => onUpdateSubtitle(e.target.value)}
                                        className="w-full px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-text-primary placeholder-text-muted outline-none focus:ring-1 focus:ring-accent-500/50 focus:border-accent-500/50 transition-all font-medium"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1.5 text-text-secondary">{t('language')}</label>
                                    <select
                                        value={language}
                                        onChange={(e) => setLanguage(e.target.value as 'en' | 'zh')}
                                        className="w-full px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-text-primary outline-none focus:ring-1 focus:ring-accent-500/50 focus:border-accent-500/50 transition-all font-medium [&>option]:text-black"
                                    >
                                        <option value="en">English</option>
                                        <option value="zh">中文 (Chinese)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2 text-text-secondary">{t('home_screen_conf')}</label>
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {['random', 'favorites', 'folder', 'single'].map(m => (
                                            <button
                                                key={m}
                                                onClick={() => onUpdateHomeConfig({ ...homeConfig, mode: m as any })}
                                                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize border transition-all ${homeConfig.mode === m ? 'bg-accent-500/20 border-accent-500/50 text-accent-500 shadow-glow' : 'bg-white/5 border-white/10 text-text-secondary hover:bg-white/10'}`}
                                            >
                                                {m === 'favorites' ? t('favorites') : t(m === 'random' ? 'random_all' : (m === 'folder' ? 'specific_folder' : 'single_item'))}
                                            </button>
                                        ))}
                                    </div>
                                    {(homeConfig.mode === 'folder' || homeConfig.mode === 'single') && (
                                        <input
                                            placeholder={t('enter_rel_path')}
                                            value={homeConfig.path || ''}
                                            onChange={e => onUpdateHomeConfig({ ...homeConfig, path: e.target.value })}
                                            className="w-full px-4 py-2 rounded-xl border border-white/10 bg-white/5 text-text-primary placeholder-text-muted outline-none focus:ring-1 focus:ring-accent-500/50 focus:border-accent-500/50 font-mono text-sm transition-all"
                                        />
                                    )}
                                </div>
                            </div>
                        </section>
                    </div>
                );
            case 'library':
                return (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        {!isServerMode ? (
                            <div className="flex flex-col items-center justify-center p-8 glass-1 rounded-2xl border border-dashed border-white/20">
                                <div className="p-4 bg-white/5 rounded-full mb-4 text-text-secondary">
                                    <Icons.Server size={32} />
                                </div>
                                <h4 className="text-lg font-bold mb-2 text-text-primary">{t('running_client_mode')}</h4>
                                <p className="text-center text-sm text-text-secondary max-w-sm mb-6">
                                    {t('client_mode_description')}
                                </p>
                                <button
                                    onClick={() => { setIsServerMode(true); setActiveTab('system'); }}
                                    className="px-6 py-2 bg-accent-600 hover:bg-accent-500 text-white font-medium rounded-lg transition-colors shadow-glow"
                                >
                                    {t('switch_to_server')}
                                </button>
                            </div>
                        ) : (
                            <>
                                <section>
                                    <div className="flex items-center gap-2 mb-4">
                                        <div className="w-1.5 h-6 bg-accent-500 rounded-full shadow-[0_0_10px_var(--accent-500)]" />
                                        <h4 className="text-lg font-bold text-text-primary">{t('library_stats')}</h4>
                                    </div>
                                    <div className="glass-1 rounded-2xl overflow-hidden shadow-lg border border-white/10">
                                        <div className="p-6 border-b border-white/10">
                                            <div className="flex items-center justify-between mb-2">
                                                <h5 className="font-bold text-lg text-text-primary">{t('library_scan_paths')}</h5>
                                                <button
                                                    onClick={onStartScan}
                                                    className="flex items-center gap-2 px-3 py-1.5 bg-accent-500/10 text-accent-400 hover:bg-accent-500/20 rounded-lg text-xs font-bold transition-all border border-accent-500/20"
                                                >
                                                    <Icons.Scan size={14} /> {t('scan_library')}
                                                </button>
                                            </div>
                                            <p className="text-sm text-text-secondary mb-4">{t('media_served')}</p>
                                            <form onSubmit={onAddLibraryPath} className="flex gap-2">
                                                <div className="flex-1 relative">
                                                    <input
                                                        value={newPathInput}
                                                        onChange={(e) => setNewPathInput(e.target.value)}
                                                        placeholder="/media"
                                                        className="w-full px-4 py-2 pr-12 rounded-lg border border-white/10 bg-white/5 text-text-primary focus:ring-1 focus:ring-accent-500/50 outline-none placeholder-text-muted"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => { onSetDirPickerContext('library'); onShowDirPicker(true); }}
                                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-text-tertiary hover:text-accent-400 hover:bg-white/10 rounded-md transition-colors"
                                                        title={t('browse')}
                                                    >
                                                        <Icons.FolderOpen size={16} />
                                                    </button>
                                                </div>
                                                <button type="submit" className="px-4 py-2 bg-accent-600 hover:bg-accent-500 text-white font-medium rounded-lg transition-colors flex items-center gap-2 shadow-glow">
                                                    <Icons.Plus size={18} /> {t('add_path')}
                                                </button>
                                            </form>
                                        </div>
                                        <div className="bg-black/20 p-2 space-y-1 max-h-64 overflow-y-auto border-b border-white/10 custom-scrollbar">
                                            {libraryPaths.length === 0 && (
                                                <div className="p-4 text-center text-sm text-text-tertiary italic">
                                                    {t('scanning_default')} <span className="font-mono bg-white/10 px-1 rounded text-text-secondary">/media</span>
                                                </div>
                                            )}
                                            {libraryPaths.map(path => (
                                                <div key={path} className="flex items-center justify-between p-3 glass-2 rounded-xl border border-white/5 shadow-sm group">
                                                    <div className="flex items-center gap-3">
                                                        <Icons.Folder size={18} className="text-accent-500" />
                                                        <span className="font-mono text-sm text-text-primary">{path}</span>
                                                    </div>
                                                    <button onClick={() => onRemoveLibraryPath(path)} className="text-red-400 opacity-0 group-hover:opacity-100 p-2 hover:bg-white/10 rounded-lg transition-all">
                                                        <Icons.Trash size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        {systemStatus && (
                                            <div className="p-4 bg-accent-500/5 border-t border-white/10">
                                                <div className="mb-3">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <Icons.Activity size={18} className="text-text-secondary" />
                                                        <span className="text-sm font-bold text-text-primary">{t('monitoring_strategy')}</span>
                                                    </div>
                                                    <div className="flex flex-col gap-3">
                                                        <div className="grid grid-cols-2 gap-2">
                                                            {(['manual', 'periodic'] as const).map((m) => (
                                                                <button
                                                                    key={m}
                                                                    onClick={() => onMonitorUpdate(m, systemStatus.scanInterval)}
                                                                    className={`px-3 py-2 rounded-lg text-xs font-medium border capitalize transition-all ${(systemStatus.mode || 'manual') === m
                                                                        ? 'bg-accent-500/20 border-accent-500/30 text-accent-400 shadow-glow'
                                                                        : 'bg-white/5 border-white/10 text-text-secondary hover:bg-white/10'
                                                                        }`}
                                                                >
                                                                    {t((m + '_mode') as any)}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        <div className="text-xs text-text-secondary bg-white/5 p-3 rounded-lg border border-white/5">
                                                            {(systemStatus.mode || 'manual') === 'manual' && <p>{t('monitoring_desc_manual')}</p>}
                                                            {(systemStatus.mode || 'manual') === 'periodic' && (
                                                                <div className="space-y-2">
                                                                    <p>{t('monitoring_desc_periodic')}</p>
                                                                    <div className="flex items-center gap-2 mt-2">
                                                                        <span>{t('scan_every')}:</span>
                                                                        <select
                                                                            value={systemStatus.scanInterval || 60}
                                                                            onChange={(e) => onMonitorUpdate('periodic', parseInt(e.target.value))}
                                                                            className="bg-black/30 border border-white/10 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-accent-500/50 text-text-primary [&>option]:text-black"
                                                                        >
                                                                            <option value="15">15 {t('minutes')}</option>
                                                                            <option value="30">30 {t('minutes')}</option>
                                                                            <option value="60">1 {t('hour')}</option>
                                                                            <option value="360">6 {t('hours')}</option>
                                                                            <option value="720">12 {t('hours')}</option>
                                                                            <option value="1440">24 {t('hours')}</option>
                                                                        </select>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </section>
                                <section className="mt-8 pt-6 border-t border-white/10">
                                    <div className="flex items-center gap-2 mb-4">
                                        <div className="w-1.5 h-6 bg-blue-500 rounded-full shadow-[0_0_10px_var(--blue-500)]" />
                                        <h4 className="text-lg font-bold text-text-primary">{t('maintenance')}</h4>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="glass-1 p-6 rounded-2xl border border-white/10 shadow-lg flex flex-col h-full glass-hover">
                                            <h5 className="flex items-center gap-2 font-bold text-text-primary mb-4">
                                                <Icons.Database size={18} className="text-blue-400" /> {t('cache_management')}
                                            </h5>
                                            <div className="flex-1">
                                                <div className="text-2xl font-bold mb-1 font-mono text-text-primary text-glow">{systemStatus?.cacheCount.toLocaleString() || '0'} <span className="text-sm font-normal text-text-secondary">{t('cached')}</span></div>
                                                <div className="flex gap-2 mt-4">
                                                    <button onClick={onPruneCache} className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-medium transition-colors text-text-secondary hover:text-text-primary border border-white/5">{t('clean_duplicate_cache')}</button>
                                                    <button onClick={onClearCache} className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-xs font-medium transition-colors">{t('clear_all_cache')}</button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="glass-1 p-6 rounded-2xl border border-white/10 shadow-lg flex flex-col h-full glass-hover">
                                            <h5 className="flex items-center gap-2 font-bold text-text-primary mb-4">
                                                <Icons.Zap size={18} className="text-yellow-400" /> {t('smart_repair')}
                                            </h5>
                                            <div className="flex-1 flex flex-col justify-between">
                                                {smartScanResults && smartScanResults.timestamp > 0 ? (
                                                    <div className="space-y-4">
                                                        <div className="flex gap-4">
                                                            <div className="flex-1">
                                                                <span className="block text-xs text-text-secondary">Missing</span>
                                                                <span className="text-lg font-bold text-red-400 font-mono">{smartScanResults.missing.length.toLocaleString()}</span>
                                                            </div>
                                                            <div className="flex-1">
                                                                <span className="block text-xs text-text-secondary">Broken</span>
                                                                <span className="text-lg font-bold text-orange-400 font-mono">{smartScanResults.error.length.toLocaleString()}</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button onClick={onSmartRepair} className="flex-1 py-2 bg-yellow-500 hover:bg-yellow-400 text-black rounded-lg text-xs font-bold transition-colors shadow-glow">{t('repair_now')}</button>
                                                            <button onClick={onSmartScan} className="px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-xs font-medium transition-colors text-text-primary border border-white/5">{t('rescan')}</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <button onClick={onSmartScan} className="w-full py-2 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20 rounded-lg text-sm font-medium transition-colors">Start Analysis</button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-4">
                                        <div className="glass-1 p-5 rounded-2xl border border-white/10 shadow-lg hover:shadow-xl transition-all flex items-center justify-between gap-4 glass-hover">
                                            <div className="flex items-center gap-4">
                                                <div className="p-3 bg-purple-500/10 text-purple-400 rounded-xl border border-purple-500/20"><Icons.Image size={24} /></div>
                                                <div>
                                                    <h5 className="font-bold text-text-primary">{t('generate_thumbs')}</h5>
                                                    <p className="text-xs text-text-secondary">{t('generate_thumbs_desc')}</p>
                                                </div>
                                            </div>
                                            <button onClick={onStartThumbGen} className="px-8 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium text-sm transition-colors shadow-glow">
                                                {t('generate')}
                                            </button>
                                        </div>
                                    </div>

                                    <section className="mt-8 pt-6 border-t border-white/10">
                                        <div className="flex items-center gap-2 mb-4">
                                            <div className="w-1.5 h-6 bg-orange-500 rounded-full shadow-[0_0_10px_var(--orange-500)]" />
                                            <h4 className="text-lg font-bold text-text-primary">{t('performance_settings')}</h4>
                                        </div>
                                        <div className="glass-1 p-6 rounded-2xl border border-white/10 shadow-lg">
                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                                                <div className="flex-1">
                                                    <h5 className="font-bold text-text-primary mb-1">{t('thumbnail_threads')}</h5>
                                                    <p className="text-xs text-text-secondary">{t('thumbnail_threads_desc')}</p>
                                                </div>
                                                <div className="flex items-center gap-4 bg-black/20 p-3 rounded-xl border border-white/5">
                                                    <input
                                                        type="range"
                                                        min="1"
                                                        max="64"
                                                        value={threadCount}
                                                        onChange={(e) => onUpdateThreadCount(parseInt(e.target.value))}
                                                        className="w-32 accent-accent-500"
                                                    />
                                                    <span className="font-mono font-bold text-accent-500 w-8 text-center">{threadCount}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </section>
                                </section>
                            </>
                        )}
                    </div>
                );
            case 'system':
                return (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        <section>
                            <h4 className="text-sm font-bold uppercase text-text-tertiary tracking-wider mb-4">{t('connection')}</h4>
                            <div className="bg-black/20 p-1 rounded-xl inline-flex w-full md:w-auto border border-white/5">
                                <button className={`flex-1 md:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-all ${!isServerMode ? 'glass-2 text-text-primary shadow-glow' : 'text-text-tertiary hover:bg-white/5'}`} onClick={() => setIsServerMode(false)}>
                                    {t('client_mode')}
                                </button>
                                <button className={`flex-1 md:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-all ${isServerMode ? 'glass-2 text-text-primary shadow-glow' : 'text-text-tertiary hover:bg-white/5'}`} onClick={() => setIsServerMode(true)}>
                                    {t('server_mode')}
                                </button>
                            </div>
                        </section>
                        {isServerMode && systemStatus && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="glass-1 border border-white/10 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
                                        <div>
                                            <h5 className="flex items-center gap-2 font-bold text-text-primary mb-4">
                                                <Icons.Cpu size={18} className="text-accent-400" /> {t('backend_components')}
                                            </h5>
                                            <div className="space-y-3">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-text-secondary">FFmpeg (Video)</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-bold ${systemStatus.ffmpeg ? 'text-green-400 bg-green-500/10 border border-green-500/20' : 'text-red-400 bg-red-500/10 border border-red-500/20'} px-2 py-0.5 rounded`}>
                                                            {systemStatus.ffmpeg ? t('active') : t('missing')}
                                                        </span>
                                                        <div className={`w-2 h-2 rounded-full ${systemStatus.ffmpeg ? 'bg-green-500 shadow-glow-sm' : 'bg-red-500 shadow-glow-red'}`} />
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-text-secondary">{t('image_processor')}</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-bold ${systemStatus.ffmpeg || systemStatus.sharp ? 'text-green-400 bg-green-500/10 border border-green-500/20' : 'text-red-400 bg-red-500/10 border border-red-500/20'} px-2 py-0.5 rounded`}>
                                                            {systemStatus.ffmpeg || systemStatus.sharp ? (systemStatus.imageProcessor || 'Active') : t('missing')}
                                                        </span>
                                                        <div className={`w-2 h-2 rounded-full ${systemStatus.ffmpeg || systemStatus.sharp ? 'bg-green-500 shadow-glow-sm' : 'bg-red-500 shadow-glow-red'}`} />
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-text-secondary">Database</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-bold ${systemStatus.dbStatus === 'connected' ? 'text-green-400 bg-green-500/10 border border-green-500/20' : 'text-yellow-400 bg-yellow-500/10 border border-yellow-500/20'} px-2 py-0.5 rounded`}>
                                                            {systemStatus.dbStatus === 'connected' ? 'Connected' : (systemStatus.dbStatus || 'Unknown')}
                                                        </span>
                                                        <div className={`w-2 h-2 rounded-full ${systemStatus.dbStatus === 'connected' ? 'bg-green-500 shadow-glow-sm' : 'bg-yellow-500 shadow-glow-yellow'}`} />
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-text-secondary">GPU Acceleration</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-bold ${systemStatus.hardwareAcceleration?.type && systemStatus.hardwareAcceleration.type !== 'none' ? 'text-green-400 bg-green-500/10 border border-green-500/20' : 'text-text-tertiary bg-white/5 border border-white/5'} px-2 py-0.5 rounded uppercase`}>
                                                            {systemStatus.hardwareAcceleration?.type === 'cuda' ? 'NVIDIA CUDA' : (systemStatus.hardwareAcceleration?.type === 'vaapi' ? 'Intel/AMD VAAPI' : 'Disabled')}
                                                        </span>
                                                        <div className={`w-2 h-2 rounded-full ${systemStatus.hardwareAcceleration?.type && systemStatus.hardwareAcceleration.type !== 'none' ? 'bg-green-500 shadow-glow-sm' : 'bg-white/20'}`} />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center pt-3 mt-3 border-t border-white/10">
                                            <span className="text-xs text-header-secondary">Platform</span>
                                            <span className="text-xs font-mono text-text-secondary bg-black/20 px-2 py-0.5 rounded border border-white/5">{systemStatus.platform}</span>
                                        </div>
                                    </div>
                                    <div className="glass-1 border border-white/10 rounded-2xl p-5 shadow-lg">
                                        <h5 className="flex items-center gap-2 font-bold text-text-primary mb-4">
                                            <Icons.Database size={18} className="text-accent-400" /> {t('media_statistics')}
                                        </h5>
                                        <div className="flex flex-col gap-3">
                                            {[
                                                { label: t('total_files'), value: systemStatus.mediaStats?.totalFiles || 0, icon: Icons.List, color: 'text-accent-400', bg: 'bg-accent-500/20' },
                                                { label: t('images'), value: systemStatus.mediaStats?.images || 0, icon: Icons.Image, color: 'text-green-400', bg: 'bg-green-500/20' },
                                                { label: t('videos'), value: systemStatus.mediaStats?.videos || 0, icon: Icons.Play, color: 'text-blue-400', bg: 'bg-blue-500/20' },
                                                { label: t('audio'), value: systemStatus.mediaStats?.audio || 0, icon: Icons.Music, color: 'text-purple-400', bg: 'bg-purple-500/20' }
                                            ].map((stat, i) => (
                                                <div key={i} className="flex items-center justify-between p-3.5 bg-black/20 rounded-xl border border-white/5 hover:bg-white/5 transition-colors">
                                                    <div className="flex items-center gap-4">
                                                        <div className={`p-2 rounded-lg ${stat.bg} ${stat.color} border border-white/5`}>
                                                            <stat.icon size={20} />
                                                        </div>
                                                        <span className="text-sm font-bold text-text-secondary">{stat.label}</span>
                                                    </div>
                                                    <span className="text-xl font-black font-mono tracking-tight text-text-primary">{stat.value.toLocaleString()}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        <section className="pt-4 border-t border-white/10">
                            <SystemUpdater />
                        </section>
                        <section className="pt-4 border-t border-white/10">
                            <button onClick={onExportConfig} className="text-sm font-medium text-accent-400 hover:text-accent-300 hover:underline flex items-center gap-2 transition-colors">
                                <Icons.Download size={16} /> {t('backup_config')}
                            </button>
                        </section>
                    </div>
                );
            case 'account':
                return (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        <section>
                            <div className="flex items-center justify-between mb-4">
                                <h4 className="text-sm font-bold uppercase text-text-tertiary tracking-wider">{t('users')}</h4>
                                {currentUser?.isAdmin && (
                                    <button onClick={onAddUser} className="text-sm font-medium text-accent-500 hover:text-accent-400 hover:underline flex items-center gap-1 transition-colors">
                                        <Icons.Plus size={16} /> {t('add_user')}
                                    </button>
                                )}
                            </div>
                            <div className="glass-1 rounded-2xl overflow-hidden shadow-lg border border-white/10">
                                {users.filter(u => currentUser?.isAdmin || u.username === currentUser?.username).map((u, idx, arr) => (
                                    <div key={u.username} className={`p-4 flex items-center justify-between ${idx !== arr.length - 1 ? 'border-b border-white/5' : ''} hover:bg-white/5 transition-colors`}>
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-accent-500/20 text-accent-500 flex items-center justify-center font-bold border border-accent-500/30 shadow-glow">{u.username[0].toUpperCase()}</div>
                                            <div>
                                                <div className="font-bold flex items-center gap-2 text-text-primary">{u.username} {u.username === currentUser?.username && <span className="text-[10px] bg-green-500/20 text-green-400 border border-green-500/30 px-1.5 py-0.5 rounded font-bold uppercase">You</span>}</div>
                                                <div className="text-xs text-text-secondary">{u.isAdmin ? 'Administrator' : 'User'}</div>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            {u.username === currentUser?.username || currentUser?.isAdmin ? (
                                                <button onClick={() => onResetPassword(u)} className="p-2 text-text-tertiary hover:text-accent-400 hover:bg-white/10 rounded-lg transition-colors"><Icons.Lock size={16} /></button>
                                            ) : null}
                                            {currentUser?.isAdmin && (
                                                <>
                                                    <button onClick={() => onRenameUser(u)} className="p-2 text-text-tertiary hover:text-yellow-400 hover:bg-white/10 rounded-lg transition-colors"><Icons.Edit size={16} /></button>
                                                    {u.username !== currentUser?.username && (
                                                        <button onClick={() => onDeleteUser(u)} className="p-2 text-text-tertiary hover:text-red-400 hover:bg-white/10 rounded-lg transition-colors"><Icons.Trash size={16} /></button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        {isServerMode && currentUser && (
                            <section className="mt-8 pt-6 border-t border-white/10">
                                <div className="flex items-center gap-2 mb-4">
                                    <div className="w-1.5 h-6 bg-accent-500 rounded-full shadow-[0_0_10px_var(--accent-500)]" />
                                    <h4 className="text-sm font-bold uppercase text-text-tertiary tracking-wider">{t('wallpaper_token')}</h4>
                                </div>
                                <div className="glass-1 p-6 rounded-2xl border border-white/10 shadow-lg">
                                    <p className="text-xs text-text-secondary mb-4">
                                        {t('wallpaper_token_desc')}
                                    </p>

                                    {!wallpaperToken ? (
                                        <button
                                            onClick={handleGenerateWallpaperToken}
                                            className="px-6 py-2 bg-accent-600 hover:bg-accent-500 text-white font-medium rounded-lg transition-colors shadow-glow flex items-center gap-2"
                                        >
                                            <Icons.Zap size={18} />
                                            {t('generate_wallpaper_token')}
                                        </button>
                                    ) : (
                                        <div className="space-y-4 animate-in fade-in zoom-in-95 duration-300">
                                            <div className="p-3 bg-black/40 rounded-xl border border-accent-500/30 flex items-center justify-between gap-4">
                                                <div className="flex-1 overflow-hidden">
                                                    <span className="text-[10px] text-accent-400 font-bold uppercase block mb-1">{t('wallpaper_token')}</span>
                                                    <code className="text-xs text-text-primary font-mono truncate block">
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

                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={handleGenerateWallpaperToken}
                                                    className="p-2 text-text-tertiary hover:text-accent-400 transition-colors"
                                                    title="Regenerate"
                                                >
                                                    <Icons.Refresh size={16} />
                                                </button>
                                            </div>

                                            <div className="mt-6 space-y-4 pt-4 border-t border-white/5">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <Icons.Settings size={14} className="text-text-tertiary" />
                                                    <span className="text-[10px] font-bold uppercase text-text-tertiary tracking-widest">{t('home_screen_conf')}</span>
                                                </div>

                                                <div className="grid grid-cols-3 gap-2">
                                                    {(['random', 'folder', 'favorites'] as const).map(m => (
                                                        <button
                                                            key={m}
                                                            onClick={() => setWallpaperConfig(prev => ({ ...prev, mode: m }))}
                                                            className={`px-2 py-2 rounded-xl text-[10px] font-bold transition-all border ${wallpaperConfig.mode === m
                                                                ? 'bg-accent-500/20 border-accent-500/50 text-accent-400'
                                                                : 'bg-white/5 border-white/10 text-text-tertiary hover:bg-white/10'
                                                                }`}
                                                        >
                                                            {t(m === 'random' ? 'random_all' : (m === 'folder' ? 'specific_folder' : 'favorites'))}
                                                        </button>
                                                    ))}
                                                </div>

                                                {wallpaperConfig.mode === 'folder' && (
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="text"
                                                            value={wallpaperConfig.path}
                                                            onChange={(e) => setWallpaperConfig(prev => ({ ...prev, path: e.target.value }))}
                                                            placeholder={t('enter_rel_path')}
                                                            className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-text-primary focus:border-accent-500/50 outline-none"
                                                        />
                                                        <button
                                                            onClick={() => {
                                                                onSetDirPickerContext('library');
                                                                onShowDirPicker(true);
                                                            }}
                                                            className="p-2 bg-white/5 border border-white/10 rounded-xl text-text-tertiary hover:text-text-primary"
                                                        >
                                                            <Icons.Folder size={16} />
                                                        </button>
                                                    </div>
                                                )}

                                                <div className="flex items-center justify-between gap-4">
                                                    <span className="text-[10px] font-bold text-text-tertiary uppercase">{t('scan_every')}</span>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="number"
                                                            value={wallpaperConfig.interval}
                                                            onChange={(e) => setWallpaperConfig(prev => ({ ...prev, interval: parseInt(e.target.value) || 5 }))}
                                                            className="w-16 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-center text-text-primary"
                                                            min="5"
                                                        />
                                                        <span className="text-[10px] text-text-tertiary">Secs</span>
                                                    </div>
                                                </div>

                                                <button
                                                    onClick={() => {
                                                        const params = new URLSearchParams();
                                                        params.set('token', wallpaperToken);
                                                        params.set('mode', wallpaperConfig.mode);
                                                        if (wallpaperConfig.mode === 'folder' && wallpaperConfig.path) params.set('path', wallpaperConfig.path);
                                                        params.set('interval', wallpaperConfig.interval.toString());

                                                        const url = `${baseUrl || window.location.origin}/wallpaper/index.html?${params.toString()}`;
                                                        copyToClipboard(url);
                                                        handleSaveWallpaperConfig();
                                                    }}
                                                    className="w-full py-3 bg-accent-600 hover:bg-accent-500 text-white rounded-xl text-xs font-bold transition-all shadow-glow flex items-center justify-center gap-2"
                                                >
                                                    <Icons.Link size={16} />
                                                    {t('copy_wallpaper_url')}
                                                </button>
                                            </div>

                                            {justCopied && (
                                                <p className="text-[10px] text-green-400 font-bold text-center animate-bounce">
                                                    {t('token_generated')} & Copied!
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </section>
                        )}

                        <div className="flex justify-end mt-8 border-t border-white/10 pt-6">
                            <button onClick={onLogout} className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg font-medium transition-colors flex items-center gap-2">
                                <Icons.LogOut size={18} /> {t('sign_out')}
                            </button>
                        </div>
                    </div>
                );
            default:
                return null;
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 md:p-12"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ scale: 0.95, y: 20 }}
                        animate={{ scale: 1, y: 0 }}
                        exit={{ scale: 0.95, y: 20 }}
                        className="glass-3 w-full max-w-5xl h-[85vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row border border-white/10"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="w-full md:w-64 bg-white/5 dark:bg-black/20 border-r border-white/10 p-6 flex flex-col gap-1 shrink-0 backdrop-blur-md">
                            <h3 className="text-xl font-bold mb-6 px-2 flex items-center gap-2 text-text-primary">
                                <Icons.Settings size={24} className="text-accent-500" /> {t('settings')}
                            </h3>
                            <div className="space-y-1">
                                {(['general', 'account', 'library', 'system'] as const).map(tab => {
                                    if ((tab === 'library' || tab === 'system') && !currentUser?.isAdmin) return null;
                                    const labels: Record<string, string> = { general: t('general'), account: t('users'), library: t('storage_database'), system: t('system') };
                                    const icons: Record<string, any> = { general: Icons.Settings, account: Icons.User, library: Icons.Database, system: Icons.Cpu };
                                    const Icon = icons[tab];
                                    return (
                                        <button
                                            key={tab}
                                            onClick={() => { setActiveTab(tab); onTabChange?.(tab); }}
                                            className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all outline-none ${activeTab === tab ? 'glass-1 text-accent-500 shadow-glow font-semibold border border-white/10' : 'text-text-secondary hover:text-text-primary hover:bg-white/5 border border-transparent'}`}
                                        >
                                            <Icon size={18} /> {labels[tab]}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-10 bg-transparent relative">
                            <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-full text-text-tertiary hover:text-text-primary transition-colors z-50">
                                <Icons.Close size={20} />
                            </button>
                            <div className="max-w-3xl mx-auto pt-6 text-text-primary">
                                {renderContent()}
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
