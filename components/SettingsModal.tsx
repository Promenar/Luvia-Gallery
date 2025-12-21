import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from './ui/Icon';
import { User, ExtendedSystemStatus, HomeScreenConfig } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

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
    onPruneCache: () => void;
    onClearCache: () => void;
    smartScanResults: any;
    thumbStatus: string;
    theme?: string;
    onToggleTheme?: () => void;
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
        onShowDirPicker, onPruneCache, onClearCache, smartScanResults, thumbStatus,
        theme, onToggleTheme
    } = props;

    // Refresh smart results when system tab is opened
    useEffect(() => {
        if (isOpen && activeTab === 'system') {
            onSmartScan(); // In App.tsx this was handleFetchSmartResults but let's use onSmartScan or similar
        }
    }, [isOpen, activeTab]);

    if (!isOpen) return null;

    const renderContent = () => {
        switch (activeTab) {
            case 'general':
                return (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        <section>
                            <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-4">{t('appearance')}</h4>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium mb-1.5">{t('website_title')}</label>
                                    <input
                                        value={appTitle}
                                        onChange={e => onUpdateTitle(e.target.value)}
                                        className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1.5">{t('home_subtitle')}</label>
                                    <input
                                        value={homeSubtitle}
                                        onChange={e => onUpdateSubtitle(e.target.value)}
                                        className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-1.5">{t('language')}</label>
                                    <select
                                        value={language}
                                        onChange={(e) => setLanguage(e.target.value as 'en' | 'zh')}
                                        className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-primary-500 transition-all"
                                    >
                                        <option value="en">English</option>
                                        <option value="zh">中文 (Chinese)</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium mb-2">{t('home_screen_conf')}</label>
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {['random', 'folder', 'single'].map(m => (
                                            <button
                                                key={m}
                                                onClick={() => onUpdateHomeConfig({ ...homeConfig, mode: m as any })}
                                                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize border transition-colors ${homeConfig.mode === m ? 'bg-primary-50 dark:bg-primary-900/30 border-primary-500 text-primary-600' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'}`}
                                            >
                                                {t(m === 'random' ? 'random_all' : (m === 'folder' ? 'specific_folder' : 'single_item'))}
                                            </button>
                                        ))}
                                    </div>
                                    {homeConfig.mode !== 'random' && (
                                        <input
                                            placeholder={t('enter_rel_path')}
                                            value={homeConfig.path || ''}
                                            onChange={e => onUpdateHomeConfig({ ...homeConfig, path: e.target.value })}
                                            className="w-full px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-primary-500 font-mono text-sm transition-all"
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
                            <div className="flex flex-col items-center justify-center p-8 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
                                <div className="p-4 bg-gray-100 dark:bg-gray-800 rounded-full mb-4">
                                    <Icons.Server size={32} className="text-gray-400" />
                                </div>
                                <h4 className="text-lg font-bold mb-2">{t('running_client_mode')}</h4>
                                <p className="text-center text-sm text-gray-500 max-w-sm mb-6">
                                    {t('client_mode_description')}
                                </p>
                                <button
                                    onClick={() => { setIsServerMode(true); setActiveTab('system'); }}
                                    className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors"
                                >
                                    {t('switch_to_server')}
                                </button>
                            </div>
                        ) : (
                            <>
                                <section>
                                    <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-4">{t('storage_database')}</h4>
                                    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
                                        <div className="p-6 border-b border-gray-100 dark:border-gray-700">
                                            <h5 className="font-bold text-lg mb-2">{t('library_scan_paths')}</h5>
                                            <p className="text-sm text-gray-500 mb-4">{t('media_served')}</p>
                                            <form onSubmit={onAddLibraryPath} className="flex gap-2">
                                                <div className="flex-1 relative">
                                                    <input
                                                        value={newPathInput}
                                                        onChange={(e) => setNewPathInput(e.target.value)}
                                                        placeholder="/media"
                                                        className="w-full px-4 py-2 pr-12 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 outline-none"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => { onSetDirPickerContext('library'); onShowDirPicker(true); }}
                                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-primary-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors"
                                                        title={t('browse')}
                                                    >
                                                        <Icons.FolderOpen size={16} />
                                                    </button>
                                                </div>
                                                <button type="submit" className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2">
                                                    <Icons.Plus size={18} /> {t('add_path')}
                                                </button>
                                            </form>
                                        </div>
                                        <div className="bg-gray-50 dark:bg-gray-900/50 p-2 space-y-1 max-h-64 overflow-y-auto border-b border-gray-100 dark:border-gray-700">
                                            {libraryPaths.length === 0 && (
                                                <div className="p-4 text-center text-sm text-gray-500 italic">
                                                    {t('scanning_default')} <span className="font-mono bg-gray-200 dark:bg-gray-700 px-1 rounded">/media</span>
                                                </div>
                                            )}
                                            {libraryPaths.map(path => (
                                                <div key={path} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm group">
                                                    <div className="flex items-center gap-3">
                                                        <Icons.Folder size={18} className="text-primary-500" />
                                                        <span className="font-mono text-sm">{path}</span>
                                                    </div>
                                                    <button onClick={() => onRemoveLibraryPath(path)} className="text-red-500 opacity-0 group-hover:opacity-100 p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all">
                                                        <Icons.Trash size={16} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        {systemStatus && (
                                            <div className="p-4 bg-blue-50/50 dark:bg-blue-900/10 border-t border-gray-100 dark:border-gray-700">
                                                <div className="mb-3">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <Icons.Activity size={18} className="text-gray-500" />
                                                        <span className="text-sm font-bold text-gray-700 dark:text-gray-300">{t('monitoring_strategy')}</span>
                                                    </div>
                                                    <div className="flex flex-col gap-3">
                                                        <div className="grid grid-cols-2 gap-2">
                                                            {(['manual', 'periodic'] as const).map((m) => (
                                                                <button
                                                                    key={m}
                                                                    onClick={() => onMonitorUpdate(m, systemStatus.scanInterval)}
                                                                    className={`px-3 py-2 rounded-lg text-xs font-medium border capitalize transition-all ${(systemStatus.mode || 'manual') === m
                                                                        ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 shadow-sm'
                                                                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                                                                        }`}
                                                                >
                                                                    {t((m + '_mode') as any)}
                                                                </button>
                                                            ))}
                                                        </div>
                                                        <div className="text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800/50 p-3 rounded-lg border border-gray-100 dark:border-gray-700/50">
                                                            {(systemStatus.mode || 'manual') === 'manual' && <p>{t('monitoring_desc_manual')}</p>}
                                                            {(systemStatus.mode || 'manual') === 'periodic' && (
                                                                <div className="space-y-2">
                                                                    <p>{t('monitoring_desc_periodic')}</p>
                                                                    <div className="flex items-center gap-2 mt-2">
                                                                        <span>{t('scan_every')}:</span>
                                                                        <select
                                                                            value={systemStatus.scanInterval || 60}
                                                                            onChange={(e) => onMonitorUpdate('periodic', parseInt(e.target.value))}
                                                                            className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-primary-500"
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
                                <section>
                                    <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-4">Maintenance</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="p-2.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 rounded-xl"><Icons.Scan size={24} /></div>
                                                <div>
                                                    <h5 className="font-bold text-gray-900 dark:text-white">{t('scan_library')}</h5>
                                                    <p className="text-xs text-gray-500">Index files from disk</p>
                                                </div>
                                            </div>
                                            <button onClick={onStartScan} className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-sm transition-colors shadow-sm shadow-blue-500/20">
                                                Start Scan
                                            </button>
                                        </div>
                                        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                                            <div className="flex items-center gap-3 mb-3">
                                                <div className="p-2.5 bg-purple-50 dark:bg-purple-900/30 text-purple-600 rounded-xl"><Icons.Image size={24} /></div>
                                                <div>
                                                    <h5 className="font-bold text-gray-900 dark:text-white">{t('generate_thumbs')}</h5>
                                                    <p className="text-xs text-gray-500">Process missing previews</p>
                                                </div>
                                            </div>
                                            <button onClick={onStartThumbGen} className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-medium text-sm transition-colors shadow-sm shadow-purple-500/20">
                                                Generate
                                            </button>
                                        </div>
                                    </div>
                                </section>
                            </>
                        )}
                    </div>
                );
            case 'system':
                return (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                        <section>
                            <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider mb-4">{t('connection')}</h4>
                            <div className="bg-gray-100 dark:bg-gray-800 p-1 rounded-xl inline-flex w-full md:w-auto">
                                <button className={`flex-1 md:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-all ${!isServerMode ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500'}`} onClick={() => setIsServerMode(false)}>
                                    {t('client_mode')}
                                </button>
                                <button className={`flex-1 md:flex-none px-6 py-2 rounded-lg text-sm font-medium transition-all ${isServerMode ? 'bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white' : 'text-gray-500'}`} onClick={() => setIsServerMode(true)}>
                                    {t('server_mode')}
                                </button>
                            </div>
                        </section>
                        {isServerMode && systemStatus && (
                            <div className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
                                        <div>
                                            <h5 className="flex items-center gap-2 font-bold text-gray-900 dark:text-white mb-4">
                                                <Icons.Cpu size={18} className="text-primary-500" /> {t('backend_components')}
                                            </h5>
                                            <div className="space-y-3">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">FFmpeg (Video)</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-bold ${systemStatus.ffmpeg ? 'text-green-600 bg-green-50 dark:bg-green-900/20' : 'text-red-600 bg-red-50 dark:bg-red-900/20'} px-2 py-0.5 rounded`}>
                                                            {systemStatus.ffmpeg ? t('active') : t('missing')}
                                                        </span>
                                                        <div className={`w-2 h-2 rounded-full ${systemStatus.ffmpeg ? 'bg-green-500' : 'bg-red-500'}`} />
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">{t('image_processor')}</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-bold ${systemStatus.ffmpeg || systemStatus.sharp ? 'text-green-600 bg-green-50 dark:bg-green-900/20' : 'text-red-600 bg-red-50 dark:bg-red-900/20'} px-2 py-0.5 rounded`}>
                                                            {systemStatus.ffmpeg || systemStatus.sharp ? (systemStatus.imageProcessor || 'Active') : t('missing')}
                                                        </span>
                                                        <div className={`w-2 h-2 rounded-full ${systemStatus.ffmpeg || systemStatus.sharp ? 'bg-green-500' : 'bg-red-500'}`} />
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">Database</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-bold ${systemStatus.dbStatus === 'connected' ? 'text-green-600 bg-green-50 dark:bg-green-900/20' : 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20'} px-2 py-0.5 rounded`}>
                                                            {systemStatus.dbStatus === 'connected' ? 'Connected' : (systemStatus.dbStatus || 'Unknown')}
                                                        </span>
                                                        <div className={`w-2 h-2 rounded-full ${systemStatus.dbStatus === 'connected' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm text-gray-600 dark:text-gray-400">GPU Acceleration</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-bold ${systemStatus.hardwareAcceleration?.type && systemStatus.hardwareAcceleration.type !== 'none' ? 'text-green-600 bg-green-50 dark:bg-green-900/20' : 'text-gray-600 bg-gray-100 dark:bg-gray-800'} px-2 py-0.5 rounded uppercase`}>
                                                            {systemStatus.hardwareAcceleration?.type === 'cuda' ? 'NVIDIA CUDA' : (systemStatus.hardwareAcceleration?.type === 'vaapi' ? 'Intel/AMD VAAPI' : 'Disabled')}
                                                        </span>
                                                        <div className={`w-2 h-2 rounded-full ${systemStatus.hardwareAcceleration?.type && systemStatus.hardwareAcceleration.type !== 'none' ? 'bg-green-500' : 'bg-gray-400'}`} />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center pt-3 mt-3 border-t border-gray-100 dark:border-gray-800">
                                            <span className="text-xs text-gray-400">Platform</span>
                                            <span className="text-xs font-mono text-gray-500 bg-gray-50 dark:bg-gray-900/50 px-2 py-0.5 rounded">{systemStatus.platform}</span>
                                        </div>
                                    </div>
                                    <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
                                        <h5 className="flex items-center gap-2 font-bold text-gray-900 dark:text-white mb-4">
                                            <Icons.Database size={18} className="text-blue-500" /> {t('cache_management')}
                                        </h5>
                                        <div className="text-2xl font-bold mb-1">{systemStatus.cacheCount.toLocaleString()} <span className="text-sm font-normal text-gray-500">{t('cached')}</span></div>
                                        <div className="grid grid-cols-2 gap-2 mt-4">
                                            <button onClick={onPruneCache} className="px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg text-xs font-medium transition-colors">{t('clean_duplicate_cache')}</button>
                                            <button onClick={onClearCache} className="px-3 py-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-xs font-medium transition-colors">{t('clear_all_cache')}</button>
                                        </div>
                                    </div>
                                </div>
                                <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl p-5 shadow-sm">
                                    <h5 className="flex items-center gap-2 font-bold text-gray-900 dark:text-white mb-4">
                                        <Icons.Zap size={18} className="text-yellow-500" /> {t('smart_repair')}
                                    </h5>
                                    {smartScanResults && smartScanResults.timestamp > 0 ? (
                                        <div className="space-y-4">
                                            <div className="flex gap-4">
                                                <div className="flex-1">
                                                    <span className="block text-sm text-gray-500">Missing</span>
                                                    <span className="text-xl font-bold text-red-500">{smartScanResults.missing.length}</span>
                                                </div>
                                                <div className="flex-1">
                                                    <span className="block text-sm text-gray-500">Broken</span>
                                                    <span className="text-xl font-bold text-orange-500">{smartScanResults.error.length}</span>
                                                </div>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={onSmartRepair} className="flex-1 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-bold transition-colors">{t('repair_now')}</button>
                                                <button onClick={onSmartScan} className="px-4 py-2 bg-gray-100 dark:bg-gray-800 rounded-lg text-sm font-medium transition-colors">{t('rescan')}</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <button onClick={onSmartScan} className="w-full py-2 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 rounded-lg text-sm font-medium transition-colors">Start Analysis</button>
                                    )}
                                </div>
                            </div>
                        )}
                        <section className="pt-4 border-t border-gray-100 dark:border-gray-800">
                            <button onClick={onExportConfig} className="text-sm font-medium text-primary-600 hover:underline flex items-center gap-2">
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
                                <h4 className="text-sm font-bold uppercase text-gray-400 tracking-wider">{t('users')}</h4>
                                {currentUser?.isAdmin && (
                                    <button onClick={onAddUser} className="text-sm font-medium text-primary-600 hover:underline flex items-center gap-1">
                                        <Icons.Plus size={16} /> {t('add_user')}
                                    </button>
                                )}
                            </div>
                            <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
                                {users.filter(u => currentUser?.isAdmin || u.username === currentUser?.username).map((u, idx, arr) => (
                                    <div key={u.username} className={`p-4 flex items-center justify-between ${idx !== arr.length - 1 ? 'border-b border-gray-50 dark:border-gray-700/50' : ''}`}>
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 flex items-center justify-center font-bold">{u.username[0].toUpperCase()}</div>
                                            <div>
                                                <div className="font-bold flex items-center gap-2">{u.username} {u.username === currentUser?.username && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-bold uppercase">You</span>}</div>
                                                <div className="text-xs text-gray-500">{u.isAdmin ? 'Administrator' : 'User'}</div>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            {u.username === currentUser?.username || currentUser?.isAdmin ? (
                                                <button onClick={() => onResetPassword(u)} className="p-2 text-gray-400 hover:text-blue-600 rounded-lg transition-colors"><Icons.Lock size={16} /></button>
                                            ) : null}
                                            {currentUser?.isAdmin && (
                                                <>
                                                    <button onClick={() => onRenameUser(u)} className="p-2 text-gray-400 hover:text-orange-600 rounded-lg transition-colors"><Icons.Edit size={16} /></button>
                                                    {u.username !== currentUser?.username && (
                                                        <button onClick={() => onDeleteUser(u)} className="p-2 text-gray-400 hover:text-red-600 rounded-lg transition-colors"><Icons.Trash size={16} /></button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                        <div className="flex justify-end">
                            <button onClick={onLogout} className="px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg font-medium transition-colors flex items-center gap-2">
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
                        className="bg-white dark:bg-gray-900 w-full max-w-5xl h-[85vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row border border-gray-200 dark:border-gray-800"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="w-full md:w-64 bg-gray-50 dark:bg-gray-950/50 border-r border-gray-100 dark:border-gray-800 p-6 flex flex-col gap-1 shrink-0">
                            <h3 className="text-xl font-bold mb-6 px-2 flex items-center gap-2">
                                <Icons.Settings size={24} className="text-primary-600" /> {t('settings')}
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
                                            onClick={() => setActiveTab(tab)}
                                            className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-colors ${activeTab === tab ? 'bg-white dark:bg-gray-800 shadow-sm font-medium text-primary-600' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50'}`}
                                        >
                                            <Icon size={18} /> {labels[tab]}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-10 bg-white dark:bg-gray-900 relative">
                            <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-gray-100 dark:bg-gray-800 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors z-50">
                                <Icons.Close size={20} />
                            </button>
                            <div className="max-w-3xl mx-auto pt-6">
                                {renderContent()}
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};
