import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL, setBaseUrl } from '../utils/api';
import { useToast } from '../utils/ToastContext';
import { ArrowLeft, Save, Trash2, Activity, Server, Database, User as UserIcon, Moon, Globe, HardDrive, Lock, Plus, Edit, Zap, List, Image as ImageIcon, Play, Music, LogOut, Cpu, Download, RefreshCw, AlertCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'react-native';
import { Header } from './Header';
import { useLanguage } from '../utils/i18n';
import { useAppTheme } from '../utils/ThemeContext';
import { useConfig } from '../utils/ConfigContext';

import { ItemPicker } from './ItemPicker';
import { Layout, Images, PlayCircle } from 'lucide-react-native';
import { Portal } from 'react-native-paper';
import { BlurView } from 'expo-blur';
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut, LinearTransition, FadeInDown, FadeOutUp } from 'react-native-reanimated';

interface SettingsScreenProps {
    onBack?: () => void;
    onLogout?: () => void;
    username?: string;
    isAdmin?: boolean;
}

interface SystemStatus {
    storage: number;
    cacheCount: number;
    mediaStats: {
        totalFiles: number;
        images: number;
        videos: number;
    };
    scanInterval: number;
    mode: string;
}

const BREADCRUMB_KEY = 'lumina_diagnostic_log';

const addBreadcrumb = async (msg: string) => {
    const time = new Date().toLocaleTimeString();
    const log = `[${time}] ${msg}`;
    console.log(`[Diagnostic] ${log}`);
    try {
        const existing = await AsyncStorage.getItem(BREADCRUMB_KEY);
        const logs = existing ? JSON.parse(existing) : [];
        logs.push(log);
        await AsyncStorage.setItem(BREADCRUMB_KEY, JSON.stringify(logs.slice(-50)));
    } catch (e) { }
};

// Helper: Section Wrapper for Drawer/Accordion style
const CollapsibleSection: React.FC<{
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
    initiallyExpanded?: boolean;
}> = ({ title, icon, children, initiallyExpanded = false }) => {
    const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
    const [isAnimating, setIsAnimating] = useState(false);

    const toggle = () => {
        if (isAnimating) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setIsAnimating(true);
        setIsExpanded(!isExpanded);
        // Lock interaction during the transition duration
        setTimeout(() => setIsAnimating(false), 400);
    };

    return (
        <Animated.View className="mb-4">
            <TouchableOpacity
                onPress={toggle}
                activeOpacity={0.7}
                className={`flex-row items-center justify-between p-4 bg-gray-50 dark:bg-zinc-900 border ${isExpanded ? 'border-gray-200 dark:border-zinc-700 rounded-t-2xl' : 'border-gray-100 dark:border-zinc-800 rounded-2xl'}`}
            >
                <View className="flex-row items-center gap-3">
                    {icon}
                    <Text className="text-base font-bold text-gray-800 dark:text-gray-100">{title}</Text>
                </View>
                <ArrowLeft size={18} color="#9ca3af" style={{ transform: [{ rotate: isExpanded ? '90deg' : '-90deg' }] }} />
            </TouchableOpacity>
            {isExpanded && (
                <View className="p-4 bg-white dark:bg-black border-x border-b border-gray-100 dark:border-zinc-800 rounded-b-2xl">
                    {children}
                </View>
            )}
        </Animated.View>
    );
};

interface UserForm {
    username: string;
    password?: string;
    isAdmin: boolean;
    allowedPaths: string;
    isEditing?: boolean;
    originalUsername?: string;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onBack, onLogout, username, isAdmin }) => {
    const { showToast } = useToast();
    const insets = useSafeAreaInsets();
    const { t, language, setLanguage } = useLanguage();
    const { mode, setMode, isDark } = useAppTheme();
    const { carouselConfig, setCarouselConfig, biometricsEnabled, setBiometricsEnabled } = useConfig();
    const [url, setUrl] = useState(API_URL);
    const [stats, setStats] = useState<SystemStatus | null>(null);
    const [loadingStats, setLoadingStats] = useState(false);
    const [isPickerOpen, setIsPickerOpen] = useState<{ visible: boolean, mode: 'folder' | 'file', target?: 'carousel' | 'userForm' }>({ visible: false, mode: 'folder', target: 'carousel' });
    const [showCacheDialog, setShowCacheDialog] = useState(false);
    const [showUserModal, setShowUserModal] = useState(false);
    const [userForm, setUserForm] = useState<UserForm>({ username: '', password: '', isAdmin: false, allowedPaths: '' });
    const [activeTab, setActiveTab] = useState<'app' | 'server'>('app');
    const [isServerMounted, setIsServerMounted] = useState(false);
    const [diagnosticLogs, setDiagnosticLogs] = useState<string[]>([]);

    // --- Admin Management State ---
    const [serverUsers, setServerUsers] = useState<any[]>([]);
    const [smartResults, setSmartResults] = useState<any>(null);
    const [isServerScanning, setIsServerScanning] = useState(false);
    const [isServerThumbGen, setIsServerThumbGen] = useState(false);
    const pollTimerRef = React.useRef<NodeJS.Timeout | null>(null);
    const isFetchingRef = React.useRef(false);

    useEffect(() => {
        addBreadcrumb("SettingsScreen Mounted. Admin: " + isAdmin);
    }, []);

    useEffect(() => {
        if (activeTab === 'server') {
            addBreadcrumb("Tab: Switched to Server Admin");
            const timer = setTimeout(() => {
                setIsServerMounted(true);
                addBreadcrumb("Server Tab Content (Staggered) Mounted");
            }, 150);
            return () => clearTimeout(timer);
        } else {
            addBreadcrumb("Tab: Switched to App Settings");
            setIsServerMounted(false);
        }
    }, [activeTab]);

    // --- Helper: Fetch with Timeout ---
    const fetchWithTimeout = async (url: string, options: any = {}, timeout = 15000) => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            return response;
        } catch (e) {
            clearTimeout(id);
            throw e;
        }
    };

    useEffect(() => {
        loadStats();
        if (isAdmin) {
            fetchUsers();
            fetchSmartResults();
        }
    }, [isAdmin]);

    const loadStats = async (silent = false) => {
        if (isFetchingRef.current) return;
        addBreadcrumb(`loadStats start (silent=${silent})`);
        if (!silent) setLoadingStats(true);
        isFetchingRef.current = true;

        try {
            const { getToken } = await import('../utils/api');
            const token = getToken();

            const res = await fetchWithTimeout(`${API_URL}/api/system/status`, {
                headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                }
            });

            addBreadcrumb(`loadStats fetch status: ${res.status}`);
            if (res.ok) {
                const data = await res.json();
                setStats(data);
                addBreadcrumb(`loadStats success, data size: ${JSON.stringify(data).length}`);
                // Background status check
                await checkTasksStatus();
            }
        } catch (e: any) {
            addBreadcrumb(`loadStats Error: ${e.message}`);
            console.error("Failed to load system stats", e);
        } finally {
            if (!silent) setLoadingStats(false);
            isFetchingRef.current = false;
        }
    };

    const checkTasksStatus = async () => {
        try {
            const { getToken } = await import('../utils/api');
            const token = getToken();
            const headers = { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) };

            const [scanRes, thumbRes] = await Promise.all([
                fetchWithTimeout(`${API_URL}/api/scan/status`, { headers }, 8000),
                fetchWithTimeout(`${API_URL}/api/thumb-gen/status`, { headers }, 8000)
            ]);

            if (scanRes.ok) {
                const scanData = await scanRes.ok ? await scanRes.json() : { status: 'idle' };
                setIsServerScanning(scanData.status === 'scanning');
            }
            if (thumbRes.ok) {
                const thumbData = await thumbRes.ok ? await thumbRes.json() : { status: 'idle' };
                setIsServerThumbGen(thumbData.status === 'scanning');
            }
        } catch (e: any) {
            console.warn("Task status check failed", e.message);
        }
    };

    const fetchUsers = async () => {
        try {
            const { getToken } = await import('../utils/api');
            const token = getToken();
            const res = await fetchWithTimeout(`${API_URL}/api/config`, {
                headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
            }, 10000);
            if (res.ok) {
                const data = await res.json();
                if (data.users) setServerUsers(data.users);
            }
        } catch (e) {
            console.error("Failed to fetch users", e);
        }
    };

    const fetchSmartResults = async () => {
        try {
            const { getToken } = await import('../utils/api');
            const token = getToken();
            // Optimized: Fetch summary only to avoid memory issues with large results
            const res = await fetchWithTimeout(`${API_URL}/api/thumb/smart-results?summary=true`, {
                headers: { ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
            }, 10000);
            if (res.ok) setSmartResults(await res.json());
        } catch (e) { }
    };

    const handleServerAdminAction = async (endpoint: string, method = 'POST', body?: any) => {
        addBreadcrumb(`handleServerAdminAction: ${endpoint} [${method}]`);
        try {
            const { getToken } = await import('../utils/api');
            const token = getToken();
            const res = await fetchWithTimeout(`${API_URL}${endpoint}`, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: body ? JSON.stringify(body) : undefined
            }, 20000);

            addBreadcrumb(`${endpoint} status: ${res.status}`);
            if (res.ok) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                addBreadcrumb(`${endpoint} success`);
                loadStats(true);
                return { success: true, data: await res.json().catch(() => ({})) };
            } else {
                const err = await res.text();
                addBreadcrumb(`${endpoint} failed: ${err.substring(0, 50)}`);
                showToast(err || "Action failed", 'error');
                return { success: false, error: err };
            }
        } catch (e: any) {
            addBreadcrumb(`${endpoint} Error: ${e.message}`);
            showToast("Network error", 'error');
            return { success: false };
        }
    };

    const startServerScan = async () => {
        addBreadcrumb("Action: startServerScan triggered");
        await handleServerAdminAction('/api/scan/start');
    };
    const startThumbGen = async () => {
        addBreadcrumb("Action: startThumbGen triggered");
        await handleServerAdminAction('/api/thumb-gen/start');
    };
    const pruneServerCache = async () => {
        addBreadcrumb("Action: pruneServerCache triggered");
        await handleServerAdminAction('/api/cache/prune');
    };
    const clearServerCache = async () => {
        addBreadcrumb("Action: clearServerCache modal triggered");
        Alert.alert(
            t('admin.clear_all_cache'),
            t('admin.confirm_clear_cache'),
            [
                { text: t('action.cancel'), style: 'cancel' },
                {
                    text: t('action.clear'),
                    style: 'destructive',
                    onPress: async () => {
                        addBreadcrumb("Action: clearServerCache confirmed");
                        await handleServerAdminAction('/api/cache/clear');
                    }
                }
            ]
        );
    };

    const handleSmartRepair = async () => {
        addBreadcrumb("Action: handleSmartRepair triggered");
        await handleServerAdminAction('/api/thumb/smart-repair', 'POST', { repairMissing: true, repairError: true });
    };
    const handleSmartScan = async () => {
        addBreadcrumb("Action: handleSmartScan triggered");
        const res = await handleServerAdminAction('/api/thumb/smart-scan');
        if (res && res.success) {
            addBreadcrumb("SmartScan started successfully");
            setIsServerThumbGen(true);
        }
    };

    const handleDeleteUser = (u: any) => {
        if (u.username === username) return;
        Alert.alert(
            t('admin.delete_user'),
            t('admin.confirm_delete_user'),
            [
                { text: t('action.cancel'), style: 'cancel' },
                {
                    text: t('admin.delete_user'), style: 'destructive', onPress: async () => {
                        // Note: delete is simulated by re-posting config in current Web architecture
                        // But backend also has DELETE /api/users/:username? Let me check server.js
                        // Actually handleUserFormSubmit in App.tsx usage: delete updatedData[user.username]; persistData(updatedUsers, undefined, updatedData);
                        // It seems it posts to /api/config.
                        // Wait, App.tsx line 1133: persistData(updatedUsers, undefined, updatedData);
                        // Let's check how persistData calls /api/config.
                        const updatedUsers = serverUsers.filter(user => user.username !== u.username);
                        const res = await handleServerAdminAction('/api/config', 'POST', { users: updatedUsers });
                        if (res.success) fetchUsers();
                    }
                }
            ]
        );
    };

    const handleUserSubmit = async () => {
        if (!userForm.username || (!userForm.password && !userForm.isEditing)) return;

        const isEditing = userForm.isEditing;
        const endpoint = isEditing ? `/api/users/${userForm.originalUsername}` : '/api/users';

        const payload: any = {
            isAdmin: userForm.isAdmin,
            allowedPaths: userForm.allowedPaths.split(/[\n,]/).map(p => p.trim()).filter(Boolean)
        };

        if (!isEditing) {
            payload.username = userForm.username;
            payload.password = userForm.password;
        } else {
            if (userForm.username !== userForm.originalUsername) payload.newUsername = userForm.username;
            if (userForm.password) payload.newPassword = userForm.password;
        }

        const res = await handleServerAdminAction(endpoint, 'POST', payload);
        if (res.success) {
            setShowUserModal(false);
            setUserForm({ username: '', password: '', isAdmin: false, allowedPaths: '' });
            fetchUsers();
        }
    };

    const handleSave = async () => {
        await setBaseUrl(url, true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(t('common.success') || 'Saved', 'success');
        if (onBack) onBack();
    };

    const handleClearAppCache = async () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setShowCacheDialog(true);
    };

    const confirmClearCache = async () => {
        try {
            setShowCacheDialog(false);
            // Clear stored cache keys
            await AsyncStorage.removeItem('lumina_cache_home');
            // Clear SQLite Cache
            const { clearStaticCache } = await import('../utils/api');
            await clearStaticCache();

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            showToast(t('msg.cache_cleared') || "Local cache cleared.", 'success');
            // Attempt to reload stats
            loadStats();
        } catch (e) {
            showToast("Failed to clear cache.", 'error');
        }
    };

    const formatBytes = (bytes: number) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    useEffect(() => {
        // Unified Polling Master
        const poll = async () => {
            if (activeTab === 'server' || isServerScanning || isServerThumbGen) {
                // If scanning or just looking at server tab, refresh stats
                await loadStats(true);
            }
        };

        // Run poll every 6 seconds. This is NOT dependent on any state change to re-trigger.
        pollTimerRef.current = setInterval(poll, 6000);

        return () => {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        };
    }, [activeTab, isServerScanning, isServerThumbGen]);

    // --- User Form Handler ---
    const handleAddUserSubmit = async () => {
        await handleUserSubmit();
    };

    return (
        <View className="flex-1 bg-white dark:bg-black">
            <Header
                title={t('header.settings')}
                subtitle={t('settings.subtitle')}
                showBack={!!onBack}
                onBack={onBack}
            />

            <ScrollView className="flex-1 px-6 pt-6">
                <View>
                    {/* Tab Switcher */}
                    <View className="flex-row mb-6 bg-gray-100 dark:bg-zinc-900/50 p-1 rounded-2xl">
                        <TouchableOpacity
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveTab('app'); }}
                            className={`flex-1 py-2.5 rounded-xl items-center flex-row justify-center gap-2 ${activeTab === 'app' ? 'bg-white dark:bg-zinc-800 shadow-sm' : ''}`}
                        >
                            <Lock size={14} color={activeTab === 'app' ? (isDark ? '#818cf8' : '#4f46e5') : '#9ca3af'} />
                            <Text className={`font-bold ${activeTab === 'app' ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>{t('settings.local') || 'App Settings'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setActiveTab('server'); }}
                            className={`flex-1 py-2.5 rounded-xl items-center flex-row justify-center gap-2 ${activeTab === 'server' ? 'bg-white dark:bg-zinc-800 shadow-sm' : ''}`}
                        >
                            <Server size={14} color={activeTab === 'server' ? (isDark ? '#818cf8' : '#4f46e5') : '#9ca3af'} />
                            <Text className={`font-bold ${activeTab === 'server' ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>{t('settings.remote') || 'Server Admin'}</Text>
                        </TouchableOpacity>
                    </View>

                    {activeTab === 'app' ? (
                        <Animated.View entering={FadeIn.duration(200)}>
                            {/* Appearance */}
                            <CollapsibleSection title={t('settings.appearance')} icon={<Moon color="#4b5563" size={20} />} initiallyExpanded>
                                <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800">
                                    {/* System Option */}
                                    <TouchableOpacity
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                            setMode('system');
                                        }}
                                        className={`flex-row items-center p-3 rounded-lg mb-2 ${mode === 'system' ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800' : ''}`}
                                    >
                                        <View className={`w-4 h-4 rounded-full border mr-3 items-center justify-center ${mode === 'system' ? 'border-indigo-600 bg-indigo-600' : 'border-gray-400'}`}>
                                            {mode === 'system' && <View className="w-2 h-2 rounded-full bg-white" />}
                                        </View>
                                        <Text className="font-bold text-gray-900 dark:text-white">{t('settings.theme.system')}</Text>
                                    </TouchableOpacity>

                                    {/* Light Option */}
                                    <TouchableOpacity
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                            setMode('light');
                                        }}
                                        className={`flex-row items-center p-3 rounded-lg mb-2 ${mode === 'light' ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800' : ''}`}
                                    >
                                        <View className={`w-4 h-4 rounded-full border mr-3 items-center justify-center ${mode === 'light' ? 'border-indigo-600 bg-indigo-600' : 'border-gray-400'}`}>
                                            {mode === 'light' && <View className="w-2 h-2 rounded-full bg-white" />}
                                        </View>
                                        <Text className="font-bold text-gray-900 dark:text-white">{t('settings.theme.light')}</Text>
                                    </TouchableOpacity>

                                    {/* Dark Option */}
                                    <TouchableOpacity
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                            setMode('dark');
                                        }}
                                        className={`flex-row items-center p-3 rounded-lg ${mode === 'dark' ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800' : ''}`}
                                    >
                                        <View className={`w-4 h-4 rounded-full border mr-3 items-center justify-center ${mode === 'dark' ? 'border-indigo-600 bg-indigo-600' : 'border-gray-400'}`}>
                                            {mode === 'dark' && <View className="w-2 h-2 rounded-full bg-white" />}
                                        </View>
                                        <Text className="font-bold text-gray-900 dark:text-white">{t('settings.theme.dark')}</Text>
                                    </TouchableOpacity>
                                </View>
                            </CollapsibleSection>

                            {/* Language */}
                            <CollapsibleSection title={t('settings.language')} icon={<Globe color="#4b5563" size={20} />}>
                                <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800">
                                    {/* Chinese Option */}
                                    <TouchableOpacity
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                            setLanguage('zh');
                                        }}
                                        className={`flex-row items-center p-3 rounded-lg mb-2 ${language === 'zh' ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800' : ''}`}
                                    >
                                        <View className={`w-4 h-4 rounded-full border mr-3 items-center justify-center ${language === 'zh' ? 'border-indigo-600 bg-indigo-600' : 'border-gray-400'}`}>
                                            {language === 'zh' && <View className="w-2 h-2 rounded-full bg-white" />}
                                        </View>
                                        <Text className="font-bold text-gray-900 dark:text-white">简体中文</Text>
                                    </TouchableOpacity>

                                    {/* English Option */}
                                    <TouchableOpacity
                                        onPress={() => {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                            setLanguage('en');
                                        }}
                                        className={`flex-row items-center p-3 rounded-lg ${language === 'en' ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800' : ''}`}
                                    >
                                        <View className={`w-4 h-4 rounded-full border mr-3 items-center justify-center ${language === 'en' ? 'border-indigo-600 bg-indigo-600' : 'border-gray-400'}`}>
                                            {language === 'en' && <View className="w-2 h-2 rounded-full bg-white" />}
                                        </View>
                                        <Text className="font-bold text-gray-900 dark:text-white">English</Text>
                                    </TouchableOpacity>
                                </View>
                            </CollapsibleSection>

                            {/* Carousel Configuration */}
                            <CollapsibleSection title={t('settings.carousel')} icon={<Layout color="#4b5563" size={20} />}>
                                <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800">
                                    {/* Option: Random Library */}
                                    <TouchableOpacity
                                        onPress={() => setCarouselConfig({ sourceType: 'all', sourceValue: null, sourceName: t('settings.carousel.random') })}
                                        className={`flex-row items-center p-3 rounded-lg mb-2 ${carouselConfig.sourceType === 'all' ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800' : ''}`}
                                    >
                                        <View className={`w-4 h-4 rounded-full border mr-3 items-center justify-center ${carouselConfig.sourceType === 'all' ? 'border-indigo-600 bg-indigo-600' : 'border-gray-400'}`}>
                                            {carouselConfig.sourceType === 'all' && <View className="w-2 h-2 rounded-full bg-white" />}
                                        </View>
                                        <View>
                                            <Text className="font-bold text-gray-900 dark:text-white">{t('settings.carousel.random')}</Text>
                                            <Text className="text-xs text-gray-500">{t('settings.carousel.source')}</Text>
                                        </View>
                                    </TouchableOpacity>

                                    {/* Option: Favorites */}
                                    <TouchableOpacity
                                        onPress={() => setCarouselConfig({ sourceType: 'favorites', sourceValue: null, sourceName: t('header.favorites') })}
                                        className={`flex-row items-center p-3 rounded-lg mb-2 ${carouselConfig.sourceType === 'favorites' ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800' : ''}`}
                                    >
                                        <View className={`w-4 h-4 rounded-full border mr-3 items-center justify-center ${carouselConfig.sourceType === 'favorites' ? 'border-indigo-600 bg-indigo-600' : 'border-gray-400'}`}>
                                            {carouselConfig.sourceType === 'favorites' && <View className="w-2 h-2 rounded-full bg-white" />}
                                        </View>
                                        <View>
                                            <Text className="font-bold text-gray-900 dark:text-white">{t('header.favorites')}</Text>
                                            <Text className="text-xs text-gray-500">{t('settings.carousel.source')}</Text>
                                        </View>
                                    </TouchableOpacity>

                                    {/* Option: Specific Folder */}
                                    <TouchableOpacity
                                        onPress={() => setIsPickerOpen({ visible: true, mode: 'folder' })}
                                        className={`flex-row items-center p-3 rounded-lg mb-2 ${carouselConfig.sourceType === 'folder' ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800' : ''}`}
                                    >
                                        <View className={`w-4 h-4 rounded-full border mr-3 items-center justify-center ${carouselConfig.sourceType === 'folder' ? 'border-indigo-600 bg-indigo-600' : 'border-gray-400'}`}>
                                            {carouselConfig.sourceType === 'folder' && <View className="w-2 h-2 rounded-full bg-white" />}
                                        </View>
                                        <View className="flex-1">
                                            <Text className="font-bold text-gray-900 dark:text-white">{t('settings.carousel.folder')}</Text>
                                            <Text className="text-xs text-gray-500" numberOfLines={1}>
                                                {carouselConfig.sourceType === 'folder' ? `${carouselConfig.sourceName}` : t('settings.carousel.select_folder')}
                                            </Text>
                                        </View>
                                        {carouselConfig.sourceType === 'folder' && <Images size={16} color="#4f46e5" />}
                                    </TouchableOpacity>

                                    {/* Option: Specific File */}
                                    <TouchableOpacity
                                        onPress={() => setIsPickerOpen({ visible: true, mode: 'file' })}
                                        className={`flex-row items-center p-3 rounded-lg ${carouselConfig.sourceType === 'file' ? 'bg-indigo-100 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800' : ''}`}
                                    >
                                        <View className={`w-4 h-4 rounded-full border mr-3 items-center justify-center ${carouselConfig.sourceType === 'file' ? 'border-indigo-600 bg-indigo-600' : 'border-gray-400'}`}>
                                            {carouselConfig.sourceType === 'file' && <View className="w-2 h-2 rounded-full bg-white" />}
                                        </View>
                                        <View className="flex-1">
                                            <Text className="font-bold text-gray-900 dark:text-white">{t('settings.carousel.file')}</Text>
                                            <Text className="text-xs text-gray-500" numberOfLines={1}>
                                                {carouselConfig.sourceType === 'file' ? `${carouselConfig.sourceName}` : t('settings.carousel.select_file')}
                                            </Text>
                                        </View>
                                        {carouselConfig.sourceType === 'file' && <PlayCircle size={16} color="#4f46e5" />}
                                    </TouchableOpacity>

                                    {/* Interval Adjustment */}
                                    <View className="mt-4 pt-4 border-t border-gray-100 dark:border-zinc-800">
                                        <View className="flex-row items-center mb-3">
                                            <Activity size={16} color="#4b5563" className="mr-2" />
                                            <Text className="font-bold text-gray-800 dark:text-gray-100">
                                                {t('settings.carousel.interval')}
                                            </Text>
                                        </View>
                                        <View className="flex-row gap-2">
                                            {[7000, 10000, 15000].map((v) => (
                                                <TouchableOpacity
                                                    key={v}
                                                    onPress={async () => {
                                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                                        await setCarouselConfig({ ...carouselConfig, interval: v });
                                                    }}
                                                    className={`flex-1 py-2 rounded-lg items-center border ${(carouselConfig.interval || 7000) === v
                                                        ? 'bg-indigo-100 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800'
                                                        : 'bg-white dark:bg-zinc-800 border-gray-100 dark:border-zinc-800'
                                                        }`}
                                                >
                                                    <Text className={`text-xs font-bold ${(carouselConfig.interval || 7000) === v
                                                        ? 'text-indigo-600 dark:text-indigo-400'
                                                        : 'text-gray-500'
                                                        }`}>
                                                        {t('settings.carousel.seconds').replace('{{count}}', (v / 1000).toString())}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    </View>
                                </View>
                            </CollapsibleSection>
                            {/* --- Security and other App settings follow here --- */}
                            {/* Security */}
                            <CollapsibleSection title={t('settings.security') || 'Security'} icon={<Lock color="#4b5563" size={20} />}>
                                <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800">
                                    <View className="flex-row items-center justify-between">
                                        <View className="flex-1 mr-4">
                                            <Text className="font-bold text-gray-900 dark:text-white text-base mb-1">
                                                {t('settings.biometric') || 'Biometric Lock'}
                                            </Text>
                                            <Text className="text-xs text-gray-500 dark:text-gray-400">
                                                {t('settings.biometric_desc') || 'Require FaceID/TouchID to access app'}
                                            </Text>
                                        </View>
                                        <TouchableOpacity
                                            onPress={async () => {
                                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                                await setBiometricsEnabled(!biometricsEnabled);
                                            }}
                                            className={`w-12 h-7 rounded-full items-center justify-center ${biometricsEnabled ? 'bg-indigo-600' : 'bg-gray-300 dark:bg-zinc-700'}`}
                                        >
                                            <View className={`w-5 h-5 bg-white rounded-full shadow-sm absolute ${biometricsEnabled ? 'right-1' : 'left-1'}`} />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </CollapsibleSection>

                            {/* Cache Management (Only for Admin) */}
                            {isAdmin && (
                                <CollapsibleSection title={t('section.cache')} icon={<Database color="#4b5563" size={20} />}>
                                    <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800">
                                        <Text className="text-sm text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                                            {t('msg.cache_desc')}
                                        </Text>
                                        <TouchableOpacity
                                            onPress={handleClearAppCache}
                                            className="bg-white dark:bg-zinc-800 border border-red-200 dark:border-red-900 flex-row items-center justify-center py-3 rounded-lg active:bg-red-50 dark:active:bg-red-900/10"
                                        >
                                            <Trash2 color="#ef4444" size={18} className="mr-2" />
                                            <Text className="text-red-500 font-bold">{t('label.clear_cache')}</Text>
                                        </TouchableOpacity>
                                    </View>
                                </CollapsibleSection>
                            )}

                        </Animated.View>
                    ) : (
                        <View>
                            {isServerMounted ? (
                                <Animated.View entering={FadeIn.duration(200)}>
                                    {/* --- Server Management Tab --- */}
                                    {/* System Monitoring (Only for Admin) */}
                                    {isAdmin && (
                                        <CollapsibleSection title={t('section.system')} icon={<Activity color="#4b5563" size={20} />} initiallyExpanded>
                                            <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800">
                                                <View className="flex-row items-center justify-between mb-4">
                                                    <View className="flex-row items-center gap-2">
                                                        <HardDrive size={16} color="#6366f1" />
                                                        <Text className="text-gray-500 dark:text-gray-400 font-medium">{t('stats.cache_size')}</Text>
                                                    </View>
                                                    <Text className="text-gray-900 dark:text-white font-bold">{stats ? formatBytes(stats.storage) : '---'}</Text>
                                                </View>
                                                <View className="flex-row items-center justify-between mb-2">
                                                    <View className="flex-row items-center gap-2">
                                                        <ImageIcon size={16} color="#ec4899" />
                                                        <Text className="text-gray-500 dark:text-gray-400 font-medium">{t('stats.total_media')}</Text>
                                                    </View>
                                                    <Text className="text-gray-900 dark:text-white font-bold">{stats ? stats.mediaStats.totalFiles : '---'}</Text>
                                                </View>
                                                <View className="flex-row gap-4 mt-2 pt-2 border-t border-gray-100 dark:border-zinc-800">
                                                    <View className="flex-1">
                                                        <Text className="text-[10px] text-gray-400 uppercase font-bold">{t('tab.library')}</Text>
                                                        <Text className="text-sm font-bold text-gray-700 dark:text-gray-200">{stats ? stats.mediaStats.images : 0}</Text>
                                                    </View>
                                                    <View className="flex-1">
                                                        <Text className="text-[10px] text-gray-400 uppercase font-bold">{t('section.just_added')}</Text>
                                                        <Text className="text-sm font-bold text-gray-700 dark:text-gray-200">{stats ? stats.mediaStats.videos : 0}</Text>
                                                    </View>
                                                </View>
                                            </View>
                                        </CollapsibleSection>
                                    )}
                                    {/* Server Maintenance (Only for Admin) */}
                                    {isAdmin && (
                                        <CollapsibleSection title={t('admin.server_maintenance')} icon={<Zap color="#4b5563" size={20} />}>
                                            <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800">
                                                <View className="flex-row flex-wrap gap-2 mb-4">
                                                    <TouchableOpacity onPress={startServerScan} className="flex-1 min-w-[45%] bg-white dark:bg-zinc-800 p-3 rounded-lg border border-gray-100 dark:border-zinc-700 flex-row items-center justify-center gap-2">
                                                        <RefreshCw size={14} color={isServerScanning ? "#10b981" : "#4b5563"} />
                                                        <Text className={`text-xs font-bold ${isServerScanning ? 'text-green-500' : 'text-gray-700 dark:text-gray-300'}`}>{t('admin.scan_library')}</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity onPress={startThumbGen} className="flex-1 min-w-[45%] bg-white dark:bg-zinc-800 p-3 rounded-lg border border-gray-100 dark:border-zinc-700 flex-row items-center justify-center gap-2">
                                                        <ImageIcon size={14} color={isServerThumbGen ? "#10b981" : "#4b5563"} />
                                                        <Text className={`text-xs font-bold ${isServerThumbGen ? 'text-green-500' : 'text-gray-700 dark:text-gray-300'}`}>{t('admin.thumb_gen')}</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity onPress={pruneServerCache} className="flex-1 min-w-[45%] bg-white dark:bg-zinc-800 p-3 rounded-lg border border-gray-100 dark:border-zinc-700 flex-row items-center justify-center gap-2">
                                                        <Database size={14} color="#4b5563" />
                                                        <Text className="text-xs font-bold text-gray-700 dark:text-gray-300">{t('admin.prune_cache')}</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity onPress={clearServerCache} className="flex-1 min-w-[45%] bg-white dark:bg-zinc-800 p-3 rounded-lg border border-red-100 dark:border-red-900/30 flex-row items-center justify-center gap-2">
                                                        <Trash2 size={14} color="#ef4444" />
                                                        <Text className="text-xs font-bold text-red-500">{t('admin.clear_all_cache')}</Text>
                                                    </TouchableOpacity>
                                                </View>

                                                <View className="bg-white dark:bg-zinc-800/50 p-4 rounded-xl border border-gray-100 dark:border-zinc-700">
                                                    <View className="flex-row items-center justify-between mb-3">
                                                        <View className="flex-row items-center gap-2">
                                                            <AlertCircle size={16} color="#eab308" />
                                                            <Text className="font-bold text-gray-800 dark:text-gray-200">{t('admin.smart_repair')}</Text>
                                                        </View>
                                                        <TouchableOpacity onPress={handleSmartScan} className="px-3 py-1 bg-gray-100 dark:bg-zinc-700 rounded-full">
                                                            <Text className="text-[10px] font-bold text-gray-600 dark:text-gray-300">{t('action.refresh')}</Text>
                                                        </TouchableOpacity>
                                                    </View>
                                                    {smartResults ? (
                                                        <View className="flex-row gap-4 mb-4">
                                                            <View className="flex-1">
                                                                <Text className="text-[10px] text-gray-500 mb-1">{t('admin.missing')}</Text>
                                                                <Text className="text-lg font-black text-red-500 font-mono">{smartResults.missingCount || 0}</Text>
                                                            </View>
                                                            <View className="flex-1">
                                                                <Text className="text-[10px] text-gray-500 mb-1">{t('admin.broken')}</Text>
                                                                <Text className="text-lg font-black text-yellow-600 font-mono">{smartResults.errorCount || 0}</Text>
                                                            </View>
                                                        </View>
                                                    ) : (
                                                        <Text className="text-xs text-gray-400 italic mb-4">No analysis results</Text>
                                                    )}
                                                    <TouchableOpacity onPress={handleSmartRepair} className="w-full bg-yellow-500 py-3 rounded-lg items-center active:bg-yellow-600 shadow-sm shadow-yellow-500/30">
                                                        <Text className="text-white font-black text-sm uppercase tracking-wider">{t('admin.repair_now')}</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                        </CollapsibleSection>
                                    )}

                                    {/* Server Configuration */}
                                    <CollapsibleSection title={t('settings.server')} icon={<Server color="#4b5563" size={20} />}>
                                        <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800">
                                            <Text className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{t('settings.backend_url')}</Text>
                                            <TextInput
                                                className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg p-3 text-gray-800 dark:text-white mb-4"
                                                value={url}
                                                onChangeText={setUrl}
                                                placeholder="http://192.168.1.100:3001"
                                                placeholderTextColor="#9ca3af"
                                                autoCapitalize="none"
                                                autoCorrect={false}
                                            />
                                            <TouchableOpacity
                                                onPress={handleSave}
                                                className="bg-black dark:bg-white flex-row items-center justify-center py-3 rounded-lg active:opacity-80 disabled:opacity-50"
                                            >
                                                <Save color={isDark ? 'black' : 'white'} size={18} className="mr-2" />
                                                <Text className="text-white dark:text-black font-bold">{t('action.save')}</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </CollapsibleSection>

                                    {/* User Account (Always show for current user in server tab) */}
                                    <CollapsibleSection title={t('section.user')} icon={<UserIcon color="#4b5563" size={20} />}>
                                        <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800">
                                            <View className="flex-row items-center justify-between mb-4">
                                                <Text className="text-gray-500 dark:text-gray-400 font-medium">{t('login.username')}</Text>
                                                <Text className="text-gray-900 dark:text-white font-bold text-lg">{username || t('guest')}</Text>
                                            </View>

                                            <TouchableOpacity
                                                onPress={() => {
                                                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                                                    onLogout && onLogout();
                                                }}
                                                className="bg-red-500 flex-row items-center justify-center py-3 rounded-lg active:opacity-80"
                                            >
                                                <Text className="text-white font-bold">{t('label.logout')}</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </CollapsibleSection>

                                    {/* User Management (Only for Admin) */}
                                    {isAdmin && (
                                        <CollapsibleSection title={t('admin.users')} icon={<List color="#4b5563" size={20} />}>
                                            <View className="flex-row items-center justify-between mb-4">
                                                <Text className="text-xs text-gray-500">{t('admin.manage_user_desc') || 'Manage user permissions'}</Text>
                                                <TouchableOpacity onPress={() => {
                                                    setUserForm({ username: '', password: '', isAdmin: false, allowedPaths: '' });
                                                    setShowUserModal(true);
                                                }} className="flex-row items-center gap-1 px-3 py-1 bg-indigo-50 dark:bg-indigo-900/30 rounded-full border border-indigo-100 dark:border-indigo-800">
                                                    <Plus size={14} color="#4f46e5" />
                                                    <Text className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{t('admin.add_user')}</Text>
                                                </TouchableOpacity>
                                            </View>
                                            <View className="bg-gray-50 dark:bg-zinc-900 rounded-xl border border-gray-100 dark:border-zinc-800 overflow-hidden">
                                                {serverUsers.map((u, idx) => (
                                                    <View key={u.username} className={`p-4 flex-row items-center justify-between ${idx < serverUsers.length - 1 ? 'border-b border-gray-100 dark:border-zinc-800' : ''}`}>
                                                        <View className="flex-row items-center gap-3">
                                                            <View className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 items-center justify-center">
                                                                <Text className="text-indigo-600 dark:text-indigo-300 font-black text-lg">{u.username[0].toUpperCase()}</Text>
                                                            </View>
                                                            <View>
                                                                <View className="flex-row items-center gap-2">
                                                                    <Text className="font-bold text-gray-900 dark:text-white">{u.username}</Text>
                                                                    {u.username === username && <View className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 rounded"><Text className="text-[8px] font-bold text-green-700 dark:text-green-400">YOU</Text></View>}
                                                                </View>
                                                                <Text className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">{u.isAdmin ? t('admin.admin_role') : t('admin.user_role')}</Text>
                                                            </View>
                                                        </View>
                                                        <View className="flex-row gap-2">
                                                            <TouchableOpacity onPress={() => {
                                                                setUserForm({
                                                                    username: u.username,
                                                                    password: '',
                                                                    isAdmin: !!u.isAdmin,
                                                                    allowedPaths: (u.allowedPaths || []).join('\n'),
                                                                    isEditing: true,
                                                                    originalUsername: u.username
                                                                });
                                                                setShowUserModal(true);
                                                            }} className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
                                                                <Edit size={16} color={isDark ? "#818cf8" : "#4f46e5"} />
                                                            </TouchableOpacity>
                                                            <TouchableOpacity onPress={() => handleDeleteUser(u)} disabled={u.username === username} className={`p-2 rounded-lg ${u.username === username ? 'opacity-20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                                                                <Trash2 size={16} color="#ef4444" />
                                                            </TouchableOpacity>
                                                        </View>
                                                    </View>
                                                ))}
                                            </View>
                                        </CollapsibleSection>
                                    )}
                                </Animated.View>
                            ) : null}
                        </View>
                    )}

                    {/* Version Info & Diagnostic Tools */}
                    <View className="mt-10 mb-20 items-center gap-4">
                        <Text className="text-gray-400 text-xs">Lumina Gallery 移动版 v1.0.0</Text>

                        <View className="flex-row gap-3">
                            <TouchableOpacity
                                onPress={async () => {
                                    const logs = await AsyncStorage.getItem(BREADCRUMB_KEY);
                                    if (logs) {
                                        setDiagnosticLogs(JSON.parse(logs));
                                        Alert.alert("System Diagnostic Log", JSON.parse(logs).join('\n'));
                                    } else {
                                        Alert.alert("No logs available");
                                    }
                                }}
                                className="flex-row items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-zinc-800 rounded-full"
                            >
                                <Activity size={14} color="#6b7280" />
                                <Text className="text-[10px] font-bold text-gray-600 dark:text-gray-400">Diagnostic Logs</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                onPress={async () => {
                                    await AsyncStorage.removeItem(BREADCRUMB_KEY);
                                    Alert.alert("Logs Cleared");
                                }}
                                className="flex-row items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-zinc-800 rounded-full"
                            >
                                <RefreshCw size={14} color="#6b7280" />
                                <Text className="text-[10px] font-bold text-gray-600 dark:text-gray-400">Clear Logs</Text>
                            </TouchableOpacity>
                        </View>

                        {activeTab === 'app' && (
                            <TouchableOpacity
                                onPress={() => {
                                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                                    if (onLogout) onLogout();
                                }}
                                className="w-full flex-row items-center justify-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-100 dark:border-red-900/30"
                            >
                                <LogOut size={18} color="#ef4444" />
                                <Text className="text-red-600 dark:text-red-400 font-black">{t('action.logout')}</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </View>
            </ScrollView>

            <ItemPicker
                visible={isPickerOpen.visible}
                mode={isPickerOpen.mode}
                onClose={() => setIsPickerOpen({ ...isPickerOpen, visible: false })}
                onSelect={async (value, name) => {
                    if (isPickerOpen.target === 'userForm') {
                        const current = userForm.allowedPaths || '';
                        const paths = current.split('\n').map(p => p.trim()).filter(Boolean);
                        if (!paths.includes(value)) {
                            paths.push(value);
                            setUserForm(p => ({ ...p, allowedPaths: paths.join('\n') }));
                        }
                    } else {
                        await setCarouselConfig({
                            sourceType: isPickerOpen.mode,
                            sourceValue: value,
                            sourceName: name
                        });
                    }
                    setIsPickerOpen({ ...isPickerOpen, visible: false });
                }}
            />

            {/* Premium Cache Dialog */}
            {
                showCacheDialog && (
                    <Portal>
                        <View className="absolute inset-0 items-center justify-center z-50">
                            {/* Backdrop */}
                            <Animated.View
                                entering={FadeIn.duration(150)}
                                exiting={FadeOut.duration(150)}
                                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                            >
                                <TouchableOpacity
                                    style={{ flex: 1 }}
                                    activeOpacity={1}
                                    onPress={() => setShowCacheDialog(false)}
                                />
                            </Animated.View>

                            {/* Dialog Content - High-end "Cold" Animation: No bounce, just swift fade & subtle scale */}
                            <Animated.View
                                entering={FadeIn.duration(200).withInitialValues({ transform: [{ scale: 0.95 }] })}
                                exiting={FadeOut.duration(150)}
                                className="w-[85%] max-w-sm overflow-hidden rounded-3xl bg-white dark:bg-zinc-900 shadow-2xl"
                            >
                                <View className="p-6 items-center">
                                    <View className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 items-center justify-center mb-4">
                                        <Trash2 size={24} color="#ef4444" />
                                    </View>

                                    <Text className="text-xl font-bold text-gray-900 dark:text-white mb-2 text-center">
                                        {t('label.clear_cache')}
                                    </Text>

                                    <Text className="text-gray-600 dark:text-gray-300 text-center mb-6 leading-5">
                                        {t('msg.cache_confirm')}
                                    </Text>

                                    <View className="flex-row gap-3 w-full">
                                        <TouchableOpacity
                                            onPress={() => {
                                                addBreadcrumb("Action: clearAppCache cancelled");
                                                setShowCacheDialog(false);
                                            }}
                                            className="flex-1 py-3 bg-gray-100 dark:bg-zinc-800 rounded-xl items-center active:bg-gray-200 dark:active:bg-zinc-700"
                                        >
                                            <Text className="font-bold text-gray-700 dark:text-gray-300">{t('dialog.cancel')}</Text>
                                        </TouchableOpacity>

                                        <TouchableOpacity
                                            onPress={() => {
                                                addBreadcrumb("Action: clearAppCache confirmed from dialog");
                                                confirmClearCache();
                                            }}
                                            className="flex-1 py-3 bg-red-500 rounded-xl items-center active:bg-red-600"
                                        >
                                            <Text className="font-bold text-white">{t('dialog.confirm')}</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </Animated.View>
                        </View>
                    </Portal>
                )
            }

            {/* User Editor Modal */}
            {
                showUserModal && (
                    <Portal>
                        <View className="absolute inset-0 items-center justify-center z-50 p-6">
                            <Animated.View
                                entering={FadeIn.duration(200)}
                                exiting={FadeOut.duration(150)}
                                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                            >
                                <TouchableOpacity style={{ flex: 1 }} onPress={() => setShowUserModal(false)} />
                            </Animated.View>

                            <Animated.View
                                entering={ZoomIn.duration(200)}
                                exiting={ZoomOut.duration(150)}
                                className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-3xl overflow-hidden shadow-2xl"
                            >
                                <View className="p-6">
                                    <View className="flex-row items-center justify-between mb-6">
                                        <Text className="text-xl font-black text-gray-900 dark:text-white">
                                            {userForm.isEditing ? t('admin.edit_user') : t('admin.add_user')}
                                        </Text>
                                        <TouchableOpacity onPress={() => setShowUserModal(false)}>
                                            <ArrowLeft size={20} color="#6b7280" />
                                        </TouchableOpacity>
                                    </View>

                                    <ScrollView className="max-h-[70vh]">
                                        <View className="space-y-4">
                                            <View>
                                                <Text className="text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">{t('admin.username')}</Text>
                                                <TextInput
                                                    className="bg-gray-50 dark:bg-zinc-800 p-3.5 rounded-xl border border-gray-100 dark:border-zinc-700 text-gray-900 dark:text-white"
                                                    value={userForm.username}
                                                    onChangeText={(text: string) => setUserForm((p: UserForm) => ({ ...p, username: text }))}
                                                    placeholder="jane_doe"
                                                    placeholderTextColor="#9ca3af"
                                                    autoCapitalize="none"
                                                />
                                            </View>
                                            <View>
                                                <Text className="text-xs font-bold text-gray-500 uppercase mb-1.5 ml-1">{t('admin.password')}</Text>
                                                <TextInput
                                                    className="bg-gray-50 dark:bg-zinc-800 p-3.5 rounded-xl border border-gray-100 dark:border-zinc-700 text-gray-900 dark:text-white"
                                                    value={userForm.password}
                                                    onChangeText={(text: string) => setUserForm((p: UserForm) => ({ ...p, password: text }))}
                                                    secureTextEntry
                                                    placeholder={userForm.isEditing ? t('admin.pwd_placeholder') : "••••••••"}
                                                    placeholderTextColor="#9ca3af"
                                                />
                                            </View>

                                            <View>
                                                <View className="flex-row items-center justify-between mb-1.5 ml-1">
                                                    <Text className="text-xs font-bold text-gray-500 uppercase">{t('admin.allowed_paths')}</Text>
                                                    <TouchableOpacity
                                                        onPress={() => setIsPickerOpen({ visible: true, mode: 'folder', target: 'userForm' })}
                                                        className="flex-row items-center gap-1 px-2 py-0.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg"
                                                    >
                                                        <Plus size={12} color="#4f46e5" />
                                                        <Text className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">{t('admin.select_folder')}</Text>
                                                    </TouchableOpacity>
                                                </View>
                                                <TextInput
                                                    className="bg-gray-50 dark:bg-zinc-800 p-3.5 rounded-xl border border-gray-100 dark:border-zinc-700 text-gray-900 dark:text-white min-h-[80px]"
                                                    value={userForm.allowedPaths}
                                                    onChangeText={(text: string) => setUserForm((p: UserForm) => ({ ...p, allowedPaths: text }))}
                                                    multiline
                                                    placeholder={t('admin.allowed_paths_desc')}
                                                    placeholderTextColor="#9ca3af"
                                                />
                                            </View>

                                            <TouchableOpacity
                                                onPress={() => setUserForm((p: UserForm) => ({ ...p, isAdmin: !p.isAdmin }))}
                                                className={`flex-row items-center justify-between p-3.5 rounded-xl border ${userForm.isAdmin ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-800' : 'bg-gray-50 border-gray-100 dark:bg-zinc-800 dark:border-zinc-700'}`}
                                            >
                                                <View className="flex-row items-center gap-2">
                                                    <Cpu size={18} color={userForm.isAdmin ? "#4f46e5" : "#6b7280"} />
                                                    <Text className={`font-bold ${userForm.isAdmin ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-600 dark:text-gray-400'}`}>{t('admin.admin_role')}</Text>
                                                </View>
                                                <View className={`w-5 h-5 rounded-full border-2 items-center justify-center ${userForm.isAdmin ? 'border-indigo-500 bg-indigo-500' : 'border-gray-300'}`}>
                                                    {userForm.isAdmin && <View className="w-2 h-2 bg-white rounded-full" />}
                                                </View>
                                            </TouchableOpacity>
                                        </View>

                                        <TouchableOpacity
                                            onPress={handleUserSubmit}
                                            className="mt-8 mb-2 bg-black dark:bg-white py-4 rounded-2xl items-center shadow-lg shadow-black/20"
                                        >
                                            <Text className="text-white dark:text-black font-black uppercase tracking-widest">{t('admin.save')}</Text>
                                        </TouchableOpacity>
                                    </ScrollView>
                                </View>
                            </Animated.View>
                        </View>
                    </Portal>
                )
            }
        </View >
    );
};
