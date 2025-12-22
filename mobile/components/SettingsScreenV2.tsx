import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Switch, Modal, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL, setBaseUrl, clearStaticCache, getToken } from '../utils/api';
import { getCacheSize } from '../utils/Database';
import { useToast } from '../utils/ToastContext';
import { useLanguage } from '../utils/i18n';
import { useAppTheme } from '../utils/ThemeContext';
import { useConfig } from '../utils/ConfigContext';
import * as Haptics from 'expo-haptics';
import {
    ArrowLeft, Server, Settings, Trash2, Save, Activity, Sun, Moon, Monitor,
    Languages, Image as ImageIcon, RotateCw, RefreshCw,
    Cpu,
    ShieldCheck,
    Users,
    UserPlus,
    Pencil,
    X,
    AlertTriangle,
    Minus,
    Plus,
    Zap,
    ChevronRight,
    HardDrive,
    Database,
    Pause,
    Play,
    Square,
    CheckCircle2
} from 'lucide-react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    withRepeat,
    Easing,
    FadeIn,
    FadeInLeft,
    FadeOutRight,
    FadeInRight,
    FadeOutLeft
} from 'react-native-reanimated';
import { ItemPicker } from './ItemPicker';

interface SettingsScreenV2Props {
    onBack?: () => void;
    onLogout?: () => void;
    username?: string;
    isAdmin?: boolean;
}

interface SystemStats {
    storage: number;
    cacheCount: number;
    mediaStats: {
        totalFiles: number;
        images: number;
        videos: number;
    };
}

export const SettingsScreenV2: React.FC<SettingsScreenV2Props> = ({ onBack, onLogout, username, isAdmin }) => {
    const insets = useSafeAreaInsets();
    const { showToast } = useToast();
    const { t, language, setLanguage } = useLanguage();
    const { mode, setMode, isDark } = useAppTheme();
    const { carouselConfig, setCarouselConfig, biometricsEnabled, setBiometricsEnabled, showRecent, setShowRecent } = useConfig();

    const [activeTab, setActiveTab] = useState<'app' | 'server'>('app');
    const [cacheSize, setCacheSize] = useState<string>('');

    // Animation Shared Values
    const tabOffset = useSharedValue(0);
    const indicatorWidth = useSharedValue(0);

    const animatedIndicatorStyle = useAnimatedStyle(() => {
        return {
            transform: [{ translateX: withSpring(tabOffset.value, { damping: 20, stiffness: 150 }) }],
        };
    });

    // Picker State
    const [isPickerOpen, setIsPickerOpen] = useState<{ visible: boolean, mode: 'folder' | 'file' }>({ visible: false, mode: 'folder' });
    const [pickerContext, setPickerContext] = useState<'carousel' | 'user_add' | 'user_edit'>('carousel');

    const [stats, setStats] = useState<SystemStats | null>(null);
    const [loadingStats, setLoadingStats] = useState(false);
    const [serverUsers, setServerUsers] = useState<any[]>([]);
    const [serverConfig, setServerConfig] = useState<any>(null);

    // Polling States
    const [scanState, setScanState] = useState<any>(null);
    const [thumbState, setThumbState] = useState<any>(null);
    const [smartResults, setSmartResults] = useState<any>(null);

    // User Modal State
    const [showUserModal, setShowUserModal] = useState(false);
    const [userForm, setUserForm] = useState({
        username: '',
        password: '',
        isAdmin: false,
        allowedPaths: [] as string[],
        isEditing: false,
        originalUsername: ''
    });

    // Confirm Dialog State
    const [confirmDialog, setConfirmDialog] = useState<{
        visible: boolean;
        title: string;
        message: string;
        onConfirm?: () => void;
        isDestructive?: boolean;
    }>({ visible: false, title: '', message: '' });

    const pollTimer = useRef<any>(null);

    // --- Interaction Helpers ---
    // Safe Haptic trigger to avoid bridge deadlock during heavy re-renders.
    // By pushing to the next tick, we allow NativeWind/Layout to finish critical paths.
    const triggerHaptic = useCallback((style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
        setTimeout(() => {
            Haptics.impactAsync(style).catch(() => { });
        }, 10); // Small delay to be extra safe
    }, []);

    const triggerNotification = useCallback((type: Haptics.NotificationFeedbackType) => {
        setTimeout(() => {
            Haptics.notificationAsync(type).catch(() => { });
        }, 10);
    }, []);

    // --- API Helpers for Admin ---
    const adminFetch = useCallback(async (endpoint: string, options: any = {}) => {
        const token = getToken();
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...options.headers
        };

        try {
            const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
            const contentType = res.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const text = await res.text();
                throw new Error(`Server returned non-JSON response (${res.status})`);
            }

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || data.error || `Error ${res.status}`);
            }
            return data;
        } catch (err: any) {
            console.error(`[adminFetch] Failed @ ${endpoint}:`, err.message);
            throw err;
        }
    }, []);

    const loadStats = async (silent = false) => {
        if (!isAdmin) return;
        if (!silent) setLoadingStats(true);
        try {
            const data = await adminFetch('/api/scan/status');
            setStats(data);
            setScanState(data); // Sync local scan state
        } catch (e: any) {
            if (!silent) console.error('Stats load failed', e);
        } finally {
            if (!silent) setLoadingStats(false);
        }
    };

    const fetchThumbStatus = async () => {
        if (!isAdmin) return;
        try {
            const data = await adminFetch('/api/thumb-gen/status');
            setThumbState(data);
        } catch (e) {
            console.error("Fetch thumb status failed", e);
        }
    };

    const fetchSmartResults = async () => {
        if (!isAdmin) return;
        try {
            const data = await adminFetch('/api/thumb/smart-results?summary=true');
            setSmartResults(data);
        } catch (e) {
            console.error("Fetch smart results failed", e);
        }
    };

    // Global Polling Effect
    useEffect(() => {
        if (!isAdmin || activeTab !== 'server') return;

        const poll = async () => {
            await Promise.all([
                loadStats(true),
                fetchThumbStatus(),
                fetchSmartResults()
            ]);
        };

        const interval = setInterval(poll, 1500);
        return () => clearInterval(interval);
    }, [isAdmin, activeTab]);

    const fetchUsers = async () => {
        if (!isAdmin) return;
        try {
            const data = await adminFetch('/api/config');
            if (data) {
                setServerConfig(data);
                if (data.users) {
                    const usersArr = Array.isArray(data.users)
                        ? data.users
                        : Object.keys(data.users).map(k => ({ username: k, ...data.users[k] }));
                    setServerUsers(usersArr);
                }
            }
        } catch (e) {
            console.error("Fetch users failed", e);
        }
    };

    useEffect(() => {
        if (activeTab === 'server' && isAdmin) {
            loadStats();
            fetchUsers();
        }
    }, [activeTab, isAdmin]);

    // Load Cache Size
    useEffect(() => {
        const updateCacheSize = async () => {
            const size = await getCacheSize();
            setCacheSize(formatBytes(size));
        };
        updateCacheSize();
    }, [activeTab]); // Refresh when tab changes

    const handleAction = async (endpoint: string, label: string, options: any = { method: 'POST' }) => {
        try {
            await adminFetch(endpoint, options);
            showToast(t('admin.action_started', { label }), 'success');
            triggerNotification(Haptics.NotificationFeedbackType.Success);
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const handleClearCache = async () => {
        setConfirmDialog({
            visible: true,
            title: t('label.clear_cache'),
            message: t('msg.cache_confirm'),
            isDestructive: true,
            onConfirm: async () => {
                try {
                    await AsyncStorage.removeItem('lumina_cache_home');
                    await clearStaticCache();
                    showToast(t('msg.cache_cleared'), 'success');
                    // Refresh size
                    const size = await getCacheSize();
                    setCacheSize(formatBytes(size));
                } catch (e) {
                    showToast(t('msg.cache_clear_failed'), 'error');
                }
            }
        });
    };

    const handleSaveUser = async () => {
        if (!userForm.username || (!userForm.isEditing && !userForm.password)) return;
        try {
            const payload = userForm.isEditing ? {
                newUsername: userForm.username,
                newPassword: userForm.password || undefined,
                isAdmin: userForm.isAdmin,
                allowedPaths: userForm.allowedPaths
            } : {
                username: userForm.username,
                password: userForm.password,
                isAdmin: userForm.isAdmin,
                allowedPaths: userForm.allowedPaths
            };

            const endpoint = userForm.isEditing
                ? `/api/users/${userForm.originalUsername}`
                : '/api/users';
            const method = 'POST';

            await adminFetch(endpoint, { method, body: JSON.stringify(payload) });

            setShowUserModal(false);
            setUserForm({ username: '', password: '', isAdmin: false, allowedPaths: [], isEditing: false, originalUsername: '' });
            fetchUsers();
            showToast(t('common.success'), 'success');
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const handleEditUser = (u: any) => {
        setUserForm({
            username: u.username,
            password: '', // Don't show password
            isAdmin: !!u.isAdmin,
            allowedPaths: Array.isArray(u.allowedPaths) ? u.allowedPaths : [],
            isEditing: true,
            originalUsername: u.username
        });
        setShowUserModal(true);
    };

    const handleDeleteUser = (user: any) => {
        if (user.username === username) return;
        setConfirmDialog({
            visible: true,
            title: t('admin.delete_user'),
            message: t('admin.delete_user_confirm', { username: user.username }),
            isDestructive: true,
            onConfirm: async () => {
                try {
                    await adminFetch(`/api/users/${user.username}`, { method: 'DELETE' });
                    fetchUsers();
                    showToast(t('common.success'), 'success');
                } catch (e: any) {
                    showToast(e.message, 'error');
                }
            }
        });
    };

    const handleUpdateConcurrency = async (delta: number) => {
        if (!serverConfig) return;
        const current = serverConfig.threadCount || 2;
        const newValue = Math.max(1, Math.min(64, current + delta));
        if (newValue === current) return;

        const performUpdate = async (val: number) => {
            triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
            try {
                const newConfig = { ...serverConfig, threadCount: val };
                await adminFetch('/api/config', {
                    method: 'POST',
                    body: JSON.stringify(newConfig)
                });
                setServerConfig(newConfig);
                showToast(t('admin.concurrency_updated', { count: val }), 'success');
            } catch (e: any) {
                showToast(e.message, 'error');
            }
        };

        if (newValue > 16 && newValue > current) {
            Alert.alert(
                t('common.warning'),
                t('admin.concurrency_warning', { count: 16 }),
                [
                    { text: t('btn.cancel'), style: 'cancel' },
                    { text: t('dialog.confirm'), onPress: () => performUpdate(newValue) }
                ]
            );
        } else {
            performUpdate(newValue);
        }
    };

    const formatBytes = (bytes: number) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    // Sub-components
    const SectionHeader = ({ title }: { title: string }) => (
        <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 ml-1">
            {title}
        </Text>
    );

    const ConfirmDialog = () => (
        <Modal visible={confirmDialog.visible} transparent animationType="fade" onRequestClose={() => setConfirmDialog({ ...confirmDialog, visible: false })}>
            <View className="flex-1 bg-black/60 items-center justify-center p-6">
                <Animated.View entering={FadeIn.duration(200)} className="bg-white dark:bg-zinc-900 w-full max-w-[320px] rounded-[32px] p-6 shadow-2xl overflow-hidden border border-gray-100 dark:border-zinc-800">
                    <View className="items-center mb-4">
                        <View className={`w-16 h-16 rounded-full ${confirmDialog.isDestructive ? 'bg-red-50 dark:bg-red-900/20' : 'bg-indigo-50 dark:bg-indigo-900/20'} items-center justify-center mb-4`}>
                            <AlertTriangle size={32} color={confirmDialog.isDestructive ? '#ef4444' : '#6366f1'} />
                        </View>
                        <Text className="text-xl font-black text-gray-900 dark:text-white text-center">{confirmDialog.title}</Text>
                        <Text className="text-sm text-gray-500 dark:text-gray-400 text-center mt-2 leading-5">
                            {confirmDialog.message}
                        </Text>
                    </View>

                    <View className="gap-3 mt-2">
                        <TouchableOpacity
                            onPress={() => {
                                triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                                setConfirmDialog({ ...confirmDialog, visible: false });
                                confirmDialog.onConfirm?.();
                            }}
                            className={`py-4 rounded-2xl items-center ${confirmDialog.isDestructive ? 'bg-red-500' : 'bg-black dark:bg-white'}`}
                        >
                            <Text className={`font-black uppercase tracking-widest ${confirmDialog.isDestructive ? 'text-white' : 'text-white dark:text-black'}`}>
                                {confirmDialog.isDestructive ? t('dialog.confirm') : t('dialog.confirm')}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => {
                                triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
                                setConfirmDialog({ ...confirmDialog, visible: false });
                            }}
                            className="py-4 rounded-2xl items-center bg-gray-100 dark:bg-zinc-800"
                        >
                            <Text className="text-gray-600 dark:text-gray-400 font-bold uppercase tracking-widest">{t('dialog.cancel')}</Text>
                        </TouchableOpacity>
                    </View>
                </Animated.View>
            </View>
        </Modal>
    );

    const OptionRow = ({ icon: Icon, title, subtitle, right, onPress, red }: any) => (
        <TouchableOpacity
            onPress={onPress}
            disabled={!onPress}
            className={`flex-row items-center justify-between p-4 bg-gray-50 dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 mb-2 ${onPress ? 'active:opacity-70' : ''}`}
        >
            <View className="flex-row items-center gap-3 flex-1">
                <View className={`w-10 h-10 rounded-full ${red ? 'bg-red-50 dark:bg-red-900/20' : 'bg-white dark:bg-zinc-800'} items-center justify-center border border-gray-100 dark:border-zinc-700`}>
                    <Icon size={18} color={red ? '#ef4444' : (isDark ? '#fff' : '#000')} />
                </View>
                <View className="flex-1">
                    <Text className={`font-bold ${red ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
                        {title}
                    </Text>
                    {subtitle && (
                        <Text className="text-xs text-gray-500 dark:text-gray-400">
                            {subtitle}
                        </Text>
                    )}
                </View>
            </View>
            {right}
        </TouchableOpacity>
    );

    const MaintenanceTaskRow = ({ icon: Icon, title, subtitle, status, progress, onStart, onPause, onResume, onCancel }: any) => {
        const isActive = status !== 'idle' && status !== 'stopped' && status !== 'cancelled';
        const isPaused = status === 'paused';
        const percentage = progress && progress.total > 0 ? (progress.count / progress.total) : 0;

        // Animations
        const spinValue = useSharedValue(0);
        useEffect(() => {
            if (isActive && !isPaused) {
                spinValue.value = withRepeat(withTiming(360, { duration: 2000, easing: Easing.linear }), -1, false);
            } else {
                spinValue.value = 0;
            }
        }, [isActive, isPaused]);

        const spinStyle = useAnimatedStyle(() => ({
            transform: [{ rotate: `${spinValue.value}deg` }]
        }));

        const progressWidth = useSharedValue(0);
        useEffect(() => {
            progressWidth.value = withTiming(percentage * 100, { duration: 500 });
        }, [percentage]);

        const progressStyle = useAnimatedStyle(() => ({
            width: `${progressWidth.value}%`
        }));

        return (
            <View className="bg-gray-50 dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 mb-2 overflow-hidden relative">
                {/* Progress Background */}
                {isActive && (
                    <Animated.View
                        className="absolute left-0 top-0 bottom-0 bg-indigo-50 dark:bg-indigo-900/10"
                        style={progressStyle}
                    />
                )}

                <TouchableOpacity
                    onPress={isActive ? undefined : onStart}
                    activeOpacity={0.7}
                    disabled={isActive}
                    className="flex-row items-center justify-between p-4"
                >
                    <View className="flex-row items-center gap-3 flex-1">
                        <Animated.View style={isActive && !isPaused ? spinStyle : {}} className={`w-10 h-10 rounded-full bg-white dark:bg-zinc-800 items-center justify-center border border-gray-100 dark:border-zinc-700`}>
                            {isActive ? (
                                <RefreshCw size={18} color="#6366f1" />
                            ) : (
                                <Icon size={18} color={isDark ? '#fff' : '#000'} />
                            )}
                        </Animated.View>
                        <View className="flex-1">
                            <View className="flex-row items-center justify-between">
                                <Text className="font-bold text-gray-900 dark:text-white">{title}</Text>
                                {isActive && (
                                    <Text className="text-[10px] font-black text-indigo-500 uppercase tracking-tighter">
                                        {Math.round(percentage * 100)}%
                                    </Text>
                                )}
                            </View>
                            {isActive ? (
                                <Text className="text-[10px] text-gray-400 font-medium truncate" numberOfLines={1}>
                                    {progress?.currentPath || 'Processing...'}
                                </Text>
                            ) : (
                                <Text className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</Text>
                            )}
                        </View>
                    </View>

                    {/* Inline Controls */}
                    {isActive ? (
                        <View className="flex-row items-center gap-1 ml-2">
                            <TouchableOpacity
                                onPress={isPaused ? onResume : onPause}
                                className="w-8 h-8 items-center justify-center rounded-full bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700"
                            >
                                {isPaused ? <Play size={14} color="#10b981" fill="#10b981" /> : <Pause size={14} color="#f59e0b" fill="#f59e0b" />}
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={onCancel}
                                className="w-8 h-8 items-center justify-center rounded-full bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700"
                            >
                                <Square size={12} color="#ef4444" fill="#ef4444" />
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <ChevronRight size={16} color={isDark ? '#4b5563' : '#9ca3af'} />
                    )}
                </TouchableOpacity>
            </View>
        );
    };

    const StatCard = ({ icon: Icon, label, value, color, subtitle }: any) => (
        <View className="flex-1 bg-gray-50 dark:bg-zinc-900 p-4 rounded-2xl border border-gray-100 dark:border-zinc-800">
            <View className="flex-row items-center gap-2 mb-2">
                <View className="w-6 h-6 rounded-lg items-center justify-center bg-white dark:bg-zinc-800 border border-gray-100 dark:border-zinc-700">
                    <Icon size={14} color={color} />
                </View>
                <Text className="text-[10px] font-bold text-gray-400 uppercase tracking-widest leading-none">{label}</Text>
            </View>
            <Text className="text-lg font-black text-gray-900 dark:text-white leading-none">{value}</Text>
            {subtitle && (
                <Text className="text-[10px] font-bold text-gray-400 mt-1 uppercase tracking-tight">{subtitle}</Text>
            )}
        </View>
    );

    return (
        <View className="flex-1 bg-white dark:bg-black">
            {/* Header Area */}
            <View style={{ paddingTop: insets.top + 10 }} className="px-6 pb-6 border-b border-gray-100 dark:border-zinc-900">
                <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-4">
                        {onBack && (
                            <TouchableOpacity
                                onPress={onBack}
                                className="p-2 bg-gray-50 dark:bg-zinc-900 rounded-full"
                            >
                                <ArrowLeft size={20} color={isDark ? "#fff" : "#000"} />
                            </TouchableOpacity>
                        )}
                        <View>
                            <Text className="text-3xl font-bold text-gray-900 dark:text-white tracking-tighter">
                                {t('header.settings')}
                            </Text>
                            <Text className="text-gray-500 dark:text-gray-400 text-sm font-medium">
                                {t('settings.subtitle')}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* Tab Switcher - Animated Indicator */}
                <View className="flex-row mt-6 bg-gray-100 dark:bg-zinc-900/50 p-1 rounded-2xl relative overflow-hidden">
                    {/* Animated Background Indicator */}
                    <Animated.View
                        style={[
                            {
                                position: 'absolute',
                                left: 4,
                                top: 4,
                                bottom: 4,
                                width: '48.5%',
                                borderRadius: 12,
                            },
                            animatedIndicatorStyle
                        ]}
                        className="bg-white dark:bg-zinc-800 shadow-sm"
                    />

                    <TouchableOpacity
                        onPress={() => {
                            triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
                            tabOffset.value = 0;
                            setActiveTab('app');
                        }}
                        onLayout={(e) => {
                            if (indicatorWidth.value === 0) {
                                indicatorWidth.value = e.nativeEvent.layout.width;
                            }
                        }}
                        className="flex-1 py-3 items-center flex-row justify-center z-10"
                    >
                        <View style={{ marginRight: 8 }}>
                            <Settings size={16} color={activeTab === 'app' ? (isDark ? '#fff' : '#000') : '#9ca3af'} />
                        </View>
                        <Text className={`font-bold ${activeTab === 'app' ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
                            {t('settings.local')}
                        </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => {
                            triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
                            tabOffset.value = indicatorWidth.value;
                            setActiveTab('server');
                        }}
                        className="flex-1 py-3 items-center flex-row justify-center z-10"
                    >
                        <View style={{ marginRight: 8 }}>
                            <Server size={16} color={activeTab === 'server' ? (isDark ? '#fff' : '#000') : '#9ca3af'} />
                        </View>
                        <Text className={`font-bold ${activeTab === 'server' ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
                            {t('settings.remote')}
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView
                className="flex-1 px-4"
                contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
                showsVerticalScrollIndicator={false}
            >
                {activeTab === 'app' ? (
                    <Animated.View key="app-tab" entering={FadeInLeft.duration(300)} exiting={FadeOutLeft.duration(300)} className="gap-8 py-6">
                        {/* General Section */}
                        <View>
                            <SectionHeader title={t('section.general')} />
                            <OptionRow
                                icon={Languages}
                                title={t('settings.language')}
                                subtitle={language === 'zh' ? '简体中文' : 'English'}
                                onPress={() => {
                                    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                                    setLanguage(language === 'zh' ? 'en' : 'zh');
                                }}
                                right={<ChevronRight size={16} color="#9ca3af" />}
                            />
                        </View>

                        {/* Appearance Section */}
                        <View>
                            <SectionHeader title={t('section.appearance')} />
                            <View className="bg-gray-50 dark:bg-zinc-900 p-2 rounded-2xl flex-row">
                                {(['system', 'light', 'dark'] as const).map((m, idx) => {
                                    const Icon = m === 'system' ? Monitor : (m === 'light' ? Sun : Moon);
                                    const active = mode === m;
                                    return (
                                        <TouchableOpacity
                                            key={m}
                                            onPress={() => {
                                                triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                                                setMode(m);
                                            }}
                                            style={{ marginLeft: idx === 0 ? 0 : 8 }}
                                            className={`flex-1 py-3 items-center justify-center rounded-xl border ${active ? 'bg-white dark:bg-zinc-800 border-indigo-200 dark:border-indigo-800' : 'border-transparent'}`}
                                        >
                                            <Icon size={18} color={active ? (isDark ? '#818cf8' : '#4f46e5') : '#9ca3af'} />
                                            <Text className={`text-[10px] font-bold mt-1.5 ${active ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>
                                                {t(`settings.theme.${m}`)}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        </View>

                        {/* Carousel Config Section */}
                        <View>
                            <SectionHeader title={t('settings.carousel')} />
                            <OptionRow
                                icon={Activity}
                                title={t('settings.show_recent')}
                                subtitle={t('settings.show_recent_desc')}
                                right={
                                    <Switch
                                        value={showRecent}
                                        onValueChange={(val) => {
                                            triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
                                            setShowRecent(val);
                                        }}
                                        trackColor={{ false: '#d1d5db', true: '#818cf8' }}
                                        thumbColor="#fff"
                                    />
                                }
                            />
                            <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-3xl border border-gray-100 dark:border-zinc-800">
                                <Text className="text-sm font-bold text-gray-900 dark:text-white mb-4 ml-1">
                                    {t('settings.carousel.source')}
                                </Text>
                                <View className="flex-row flex-wrap gap-2">
                                    {[
                                        { id: 'all', label: t('settings.carousel.random'), icon: RefreshCw },
                                        { id: 'favorites', label: t('tab.favorites'), icon: ShieldCheck },
                                        { id: 'folder', label: t('settings.carousel.folder'), icon: Users },
                                        { id: 'file', label: t('settings.carousel.file'), icon: ImageIcon }
                                    ].map((modeItem) => {
                                        const active = carouselConfig.sourceType === modeItem.id;
                                        return (
                                            <TouchableOpacity
                                                key={modeItem.id}
                                                onPress={() => {
                                                    triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
                                                    if (modeItem.id === 'folder' || modeItem.id === 'file') {
                                                        setIsPickerOpen({ visible: true, mode: modeItem.id as any });
                                                    } else {
                                                        setCarouselConfig({ ...carouselConfig, sourceType: modeItem.id as any, sourceValue: null, sourceName: '' });
                                                    }
                                                }}
                                                style={{ width: '48.5%' }}
                                                className={`py-3 rounded-2xl border flex-row items-center justify-center gap-2 ${active ? 'bg-indigo-500 border-indigo-500' : 'bg-white dark:bg-zinc-800 border-gray-100 dark:border-zinc-700'}`}
                                            >
                                                <modeItem.icon size={14} color={active ? '#fff' : (isDark ? '#9ca3af' : '#6b7280')} />
                                                <Text className={`text-[11px] font-bold ${active ? 'text-white' : 'text-gray-500 dark:text-gray-400'}`} numberOfLines={1}>
                                                    {modeItem.label}
                                                </Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>

                                {(carouselConfig.sourceType === 'folder' || carouselConfig.sourceType === 'file') && carouselConfig.sourceName && (
                                    <View className="mt-4 p-3 bg-white dark:bg-zinc-800 rounded-2xl border border-indigo-100 dark:border-indigo-900/30 flex-row items-center justify-between">
                                        <View className="flex-row items-center gap-2 flex-1">
                                            <View className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/20 items-center justify-center">
                                                <Text className="text-indigo-600 dark:text-indigo-400 text-[10px] font-black">ID</Text>
                                            </View>
                                            <Text className="text-xs font-medium text-gray-700 dark:text-gray-300 flex-1" numberOfLines={1}>
                                                {carouselConfig.sourceName}
                                            </Text>
                                        </View>
                                        <TouchableOpacity
                                            onPress={() => setIsPickerOpen({ visible: true, mode: carouselConfig.sourceType as any })}
                                            className="ml-2"
                                        >
                                            <Text className="text-xs font-bold text-indigo-500">{t('action.change')}</Text>
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </View>
                        </View>

                        {/* Security Section */}
                        <View>
                            <SectionHeader title={t('section.security')} />
                            <OptionRow
                                icon={ShieldCheck}
                                title={t('settings.biometric')}
                                subtitle={t('settings.biometric_desc')}
                                right={
                                    <Switch
                                        value={biometricsEnabled}
                                        onValueChange={(val) => {
                                            triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
                                            setBiometricsEnabled(val);
                                        }}
                                        trackColor={{ false: '#d1d5db', true: '#818cf8' }}
                                        thumbColor="#fff"
                                    />
                                }
                            />
                        </View>

                        {/* Cache Management */}
                        <View>
                            <SectionHeader title={t('section.cache')} />
                            <OptionRow
                                icon={Trash2}
                                title={`${t('label.clear_cache')} (${cacheSize})`}
                                subtitle={t('msg.cache_desc')}
                                onPress={handleClearCache}
                                red
                            />
                        </View>

                        {/* User Account */}
                        <View>
                            <SectionHeader title={t('section.user')} />
                            <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-2xl border border-gray-100 dark:border-zinc-800">
                                <View className="flex-row items-center justify-between">
                                    <View>
                                        <Text className="text-lg font-bold text-gray-900 dark:text-white">
                                            {username || t('guest')}
                                        </Text>
                                        <Text className="text-xs text-indigo-500 font-bold uppercase tracking-wider">
                                            {isAdmin ? t('admin.admin_role') : t('admin.user_role')}
                                        </Text>
                                    </View>
                                    {onLogout && (
                                        <TouchableOpacity
                                            onPress={() => {
                                                setConfirmDialog({
                                                    visible: true,
                                                    title: t('label.logout'),
                                                    message: t('msg.logout_confirm'),
                                                    isDestructive: true,
                                                    onConfirm: onLogout
                                                });
                                            }}
                                            className="px-4 py-2 bg-red-50 dark:bg-red-900/20 rounded-xl"
                                        >
                                            <Text className="text-red-500 font-bold text-sm">{t('label.logout')}</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>
                            </View>
                        </View>
                    </Animated.View>
                ) : (
                    <Animated.View key="server-tab" entering={FadeInRight.duration(300)} exiting={FadeOutRight.duration(300)} className="gap-8 py-6">
                        {isAdmin ? (
                            <>
                                {/* Server Stats */}
                                <View>
                                    <SectionHeader title={t('section.system')} />
                                    {loadingStats && !stats ? (
                                        <View className="h-32 items-center justify-center">
                                            <ActivityIndicator color={isDark ? "#fff" : "#000"} />
                                        </View>
                                    ) : stats ? (
                                        <>
                                            <View className="flex-row">
                                                <StatCard icon={HardDrive} label={t('stats.total_media')} value={stats.mediaStats.totalFiles} color="#3b82f6" />
                                                <View style={{ width: 8 }} />
                                                <StatCard
                                                    icon={Database}
                                                    label={t('stats.cache_size')}
                                                    value={formatBytes(stats.storage)}
                                                    subtitle={t('stats.items_count', { count: stats.cacheCount || 0 })}
                                                    color="#10b981"
                                                />
                                            </View>
                                            <View style={{ height: 8 }} />
                                            <View className="flex-row">
                                                <StatCard icon={ImageIcon} label={t('stats.images')} value={stats.mediaStats.images} color="#8b5cf6" />
                                                <View style={{ width: 8 }} />
                                                <StatCard icon={Activity} label={t('stats.videos')} value={stats.mediaStats.videos} color="#f59e0b" />
                                            </View>
                                        </>
                                    ) : (
                                        <TouchableOpacity onPress={() => loadStats()} className="p-10 items-center justify-center bg-gray-50 dark:bg-zinc-900 rounded-2xl border border-dashed border-gray-300">
                                            <Text className="text-gray-400 font-bold">{t('msg.load_error')}</Text>
                                            <Text className="text-[10px] text-gray-500 mt-2 uppercase">{t('msg.tap_retry')}</Text>
                                        </TouchableOpacity>
                                    )}
                                </View>

                                {/* Maintenance Tasks */}
                                <View>
                                    <SectionHeader title={t('admin.server_maintenance')} />
                                    <View className="gap-2">
                                        <MaintenanceTaskRow
                                            icon={RefreshCw}
                                            title={t('admin.scan_library')}
                                            subtitle={t('admin.scan_library_desc')}
                                            status={scanState?.status || 'idle'}
                                            progress={scanState}
                                            onStart={() => handleAction('/api/scan/start', t('admin.scan_library'))}
                                            onPause={() => handleAction('/api/scan/control', t('action.pause'), { method: 'POST', body: JSON.stringify({ action: 'pause' }) })}
                                            onResume={() => handleAction('/api/scan/control', t('action.resume'), { method: 'POST', body: JSON.stringify({ action: 'resume' }) })}
                                            onCancel={() => handleAction('/api/scan/control', t('action.cancel'), { method: 'POST', body: JSON.stringify({ action: 'stop' }) })}
                                        />
                                        <MaintenanceTaskRow
                                            icon={Cpu}
                                            title={t('admin.thumb_gen')}
                                            subtitle={t('admin.thumb_gen_desc')}
                                            status={thumbState?.currentTaskName === 'System Thumbnail Scan' ? (thumbState?.status || 'idle') : 'idle'}
                                            progress={thumbState}
                                            onStart={() => handleAction('/api/thumb-gen/start', t('admin.thumb_gen'))}
                                            onPause={() => handleAction('/api/thumb-gen/control', t('action.pause'), { method: 'POST', body: JSON.stringify({ action: 'pause' }) })}
                                            onResume={() => handleAction('/api/thumb-gen/control', t('action.resume'), { method: 'POST', body: JSON.stringify({ action: 'resume' }) })}
                                            onCancel={() => handleAction('/api/thumb-gen/control', t('action.cancel'), { method: 'POST', body: JSON.stringify({ action: 'stop' }) })}
                                        />
                                        <MaintenanceTaskRow
                                            icon={RotateCw}
                                            title={t('admin.smart_repair')}
                                            subtitle={
                                                smartResults && (smartResults.missingCount > 0 || smartResults.errorCount > 0)
                                                    ? t('admin.smart_results', { missing: smartResults.missingCount, error: smartResults.errorCount })
                                                    : t('admin.scan_library_desc')
                                            }
                                            status={
                                                (thumbState?.currentTaskName === 'Smart Thumbnail Scan' ||
                                                    thumbState?.currentTaskName?.includes('Smart Repair'))
                                                    ? (thumbState?.status || 'idle') : 'idle'
                                            }
                                            progress={thumbState}
                                            onStart={() => handleAction('/api/thumb/smart-scan', t('admin.smart_repair'))}
                                            onPause={() => handleAction('/api/thumb-gen/control', t('action.pause'), { method: 'POST', body: JSON.stringify({ action: 'pause' }) })}
                                            onResume={() => handleAction('/api/thumb-gen/control', t('action.resume'), { method: 'POST', body: JSON.stringify({ action: 'resume' }) })}
                                            onCancel={() => handleAction('/api/thumb-gen/control', t('action.cancel'), { method: 'POST', body: JSON.stringify({ action: 'stop' }) })}
                                        />

                                        {/* Smart Repair Action (Conditional) */}
                                        {smartResults && (smartResults.missingCount > 0 || smartResults.errorCount > 0) && (
                                            <TouchableOpacity
                                                onPress={() => handleAction('/api/thumb/smart-repair', t('admin.smart_repair_action'), {
                                                    method: 'POST',
                                                    body: JSON.stringify({ repairMissing: true, repairError: true })
                                                })}
                                                disabled={thumbState?.status !== 'idle'}
                                                className={`flex-row items-center justify-center p-3 bg-indigo-500 rounded-2xl mb-2 ${thumbState?.status !== 'idle' ? 'opacity-50' : ''}`}
                                            >
                                                <Zap size={16} color="#fff" className="mr-2" />
                                                <Text className="text-white font-bold">{t('admin.smart_repair_action')}</Text>
                                            </TouchableOpacity>
                                        )}
                                        <View className="bg-gray-50 dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 mb-2 p-4">
                                            <View className="flex-row items-center justify-between gap-4">
                                                <View className="flex-row items-center gap-3 flex-1">
                                                    <View className="w-10 h-10 rounded-full bg-white dark:bg-zinc-800 items-center justify-center border border-gray-100 dark:border-zinc-700">
                                                        <Zap size={18} color={isDark ? '#fff' : '#000'} />
                                                    </View>
                                                    <Text className="font-bold text-gray-900 dark:text-white flex-1">{t('admin.thumb_concurrency')}</Text>
                                                </View>
                                                <View className="flex-row items-center gap-3 bg-gray-100 dark:bg-zinc-800 p-1 rounded-xl">
                                                    <TouchableOpacity
                                                        onPress={() => handleUpdateConcurrency(-1)}
                                                        className="w-8 h-8 items-center justify-center rounded-lg bg-white dark:bg-zinc-700 shadow-sm"
                                                    >
                                                        <Minus size={14} color={isDark ? "#fff" : "#000"} />
                                                    </TouchableOpacity>
                                                    <View className="w-6 items-center">
                                                        <Text className="text-sm font-black text-gray-900 dark:text-white">
                                                            {serverConfig?.threadCount || 2}
                                                        </Text>
                                                    </View>
                                                    <TouchableOpacity
                                                        onPress={() => handleUpdateConcurrency(1)}
                                                        className="w-8 h-8 items-center justify-center rounded-lg bg-white dark:bg-zinc-700 shadow-sm"
                                                    >
                                                        <Plus size={14} color={isDark ? "#fff" : "#000"} />
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                            <View className="mt-3 pl-[52px]">
                                                <Text className="text-[11px] text-gray-500 dark:text-zinc-500 leading-4">
                                                    {t('admin.thumb_concurrency_desc')}
                                                </Text>
                                            </View>
                                        </View>
                                        <OptionRow
                                            icon={Trash2}
                                            title={t('admin.prune_cache')}
                                            onPress={() => handleAction('/api/cache/prune', t('admin.prune_cache'))}
                                            red
                                        />
                                    </View>
                                </View>

                                {/* User Management */}
                                <View>
                                    <View className="flex-row items-center justify-between mb-4 px-1">
                                        <SectionHeader title={t('admin.users')} />
                                        <TouchableOpacity
                                            onPress={() => {
                                                setUserForm({ username: '', password: '', isAdmin: false, allowedPaths: [], isEditing: false, originalUsername: '' });
                                                setPickerContext('user_add');
                                                setShowUserModal(true);
                                            }}
                                            className="flex-row items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 rounded-full"
                                        >
                                            <UserPlus size={14} color="#4f46e5" />
                                            <Text className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{t('admin.add_user')}</Text>
                                        </TouchableOpacity>
                                    </View>

                                    <View className="gap-2">
                                        {serverUsers.length === 0 ? (
                                            <View className="p-8 items-center bg-gray-50 dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800">
                                                <Users size={24} color="#9ca3af" className="mb-2 opacity-50" />
                                                <Text className="text-gray-400 text-xs">{t('admin.user_count', { count: 0 })}</Text>
                                            </View>
                                        ) : (
                                            serverUsers.map((u) => (
                                                <View
                                                    key={u.username}
                                                    className="flex-row items-center justify-between p-4 bg-gray-50 dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800"
                                                >
                                                    <View className="flex-row items-center gap-3">
                                                        <View className="w-10 h-10 rounded-full bg-indigo-50 dark:bg-indigo-900/20 items-center justify-center">
                                                            <Text className="font-black text-indigo-600 dark:text-indigo-400">{u.username[0].toUpperCase()}</Text>
                                                        </View>
                                                        <View>
                                                            <Text className="font-bold text-gray-900 dark:text-white">{u.username}</Text>
                                                            <Text className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                                                                {u.isAdmin ? t('admin.role_admin') : t('admin.role_user')}
                                                            </Text>
                                                        </View>
                                                    </View>
                                                    <View className="flex-row items-center gap-1">
                                                        {u.username !== username && (
                                                            <TouchableOpacity
                                                                onPress={() => {
                                                                    setPickerContext('user_edit');
                                                                    handleEditUser(u);
                                                                }}
                                                                className="p-2"
                                                            >
                                                                <Pencil size={16} color={isDark ? "#9ca3af" : "#64748b"} />
                                                            </TouchableOpacity>
                                                        )}
                                                        {u.username !== username && (
                                                            <TouchableOpacity onPress={() => handleDeleteUser(u)} className="p-2">
                                                                <Trash2 size={16} color="#ef4444" />
                                                            </TouchableOpacity>
                                                        )}
                                                    </View>
                                                </View>
                                            ))
                                        )}
                                    </View>
                                </View>

                                <View className="mt-8 mb-4 items-center opacity-50">
                                    <Text className="text-[10px] text-gray-400 dark:text-zinc-500 font-mono">
                                        Lumina Gallery Mobile v1.0.0 (Phoenix V2)
                                    </Text>
                                </View>
                            </>
                        ) : (
                            <View className="items-center justify-center py-20 bg-gray-50 dark:bg-zinc-900 rounded-3xl border border-gray-100 dark:border-zinc-800">
                                <ShieldCheck size={48} color={isDark ? "#818cf8" : "#4f46e5"} className="mb-4 opacity-20" />
                                <Text className="text-gray-400 font-bold uppercase tracking-widest text-xs">
                                    {t('admin.access_denied')}
                                </Text>
                                <Text className="text-gray-500 mt-1 text-center px-10">
                                    {t('admin.access_denied_desc')}
                                </Text>
                            </View>
                        )}
                    </Animated.View>
                )}
            </ScrollView>

            {/* Global Picker */}
            <ItemPicker
                visible={isPickerOpen.visible}
                mode={isPickerOpen.mode}
                onClose={() => setIsPickerOpen({ ...isPickerOpen, visible: false })}
                onSelect={(value, name) => {
                    if (pickerContext === 'carousel') {
                        setCarouselConfig({
                            ...carouselConfig,
                            sourceType: isPickerOpen.mode,
                            sourceValue: value,
                            sourceName: name
                        });
                    } else if (pickerContext === 'user_add' || pickerContext === 'user_edit') {
                        // Avoid duplicates
                        if (!userForm.allowedPaths.includes(value)) {
                            setUserForm({
                                ...userForm,
                                allowedPaths: [...userForm.allowedPaths, value]
                            });
                        }
                    }
                }}
            />

            {/* User Editor Modal */}
            <Modal visible={showUserModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowUserModal(false)}>
                <View
                    className="flex-1 bg-white dark:bg-black p-6"
                    style={{ paddingTop: insets.top + (Platform.OS === 'android' ? 10 : 0) }}
                >
                    <View className="flex-row items-center justify-between mb-8">
                        <Text className="text-2xl font-black text-gray-900 dark:text-white">
                            {userForm.isEditing ? t('admin.edit_user') : t('admin.add_user')}
                        </Text>
                        <TouchableOpacity onPress={() => setShowUserModal(false)} className="p-2 bg-gray-100 dark:bg-zinc-800 rounded-full">
                            <ArrowLeft size={20} color={isDark ? "#fff" : "#000"} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView showsVerticalScrollIndicator={false}>
                        <View className="gap-6">
                            <View>
                                <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">{t('admin.username')}</Text>
                                <TextInput
                                    className={`bg-gray-50 dark:bg-zinc-900 p-4 rounded-2xl border border-gray-100 dark:border-zinc-800 text-gray-900 dark:text-white`}
                                    value={userForm.username}
                                    onChangeText={(tVal) => setUserForm({ ...userForm, username: tVal })}
                                    placeholder={t('admin.username')}
                                    placeholderTextColor="#9ca3af"
                                />
                            </View>
                            <View>
                                <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">{t('admin.password')}</Text>
                                <TextInput
                                    className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-2xl border border-gray-100 dark:border-zinc-800 text-gray-900 dark:text-white"
                                    value={userForm.password}
                                    onChangeText={(pVal) => setUserForm({ ...userForm, password: pVal })}
                                    secureTextEntry
                                    placeholder={userForm.isEditing ? t('admin.pwd_placeholder') : t('admin.password')}
                                    placeholderTextColor="#9ca3af"
                                />
                            </View>

                            <View>
                                <View className="flex-row items-center justify-between mb-2 ml-1">
                                    <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t('admin.allowed_paths')}</Text>
                                </View>

                                {userForm.allowedPaths.length > 0 && (
                                    <View className="gap-2">
                                        {userForm.allowedPaths.map((path, idx) => (
                                            <View key={`${idx}-${path}`} className="flex-row items-center justify-between bg-gray-50 dark:bg-zinc-900 p-3 rounded-xl border border-gray-100 dark:border-zinc-800">
                                                <Text className="flex-1 text-sm text-gray-600 dark:text-gray-400 font-medium" numberOfLines={1}>
                                                    {path}
                                                </Text>
                                                <TouchableOpacity
                                                    onPress={() => {
                                                        const newPaths = userForm.allowedPaths.filter((_, i) => i !== idx);
                                                        setUserForm({ ...userForm, allowedPaths: newPaths });
                                                    }}
                                                    className="ml-2 p-1"
                                                >
                                                    <X size={14} color="#ef4444" />
                                                </TouchableOpacity>
                                            </View>
                                        ))}
                                    </View>
                                )}

                                <TouchableOpacity
                                    onPress={() => {
                                        setIsPickerOpen({ visible: true, mode: 'folder' });
                                    }}
                                    className="mt-3 flex-row items-center justify-center p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-800/50"
                                >
                                    <Plus size={20} color="#4f46e5" />
                                    <Text className="ml-2 font-bold text-indigo-600">{t('admin.add_path') || 'Add Path'}</Text>
                                </TouchableOpacity>
                            </View>

                            <OptionRow
                                icon={ShieldCheck}
                                title={t('admin.admin_role')}
                                right={<Switch value={userForm.isAdmin} onValueChange={(v) => setUserForm({ ...userForm, isAdmin: v })} />}
                            />

                            <TouchableOpacity
                                onPress={handleSaveUser}
                                className="bg-black dark:bg-white py-4 rounded-2xl items-center mt-4 shadow-xl shadow-black/20"
                            >
                                <Text className="text-white dark:text-black font-black uppercase tracking-widest">{t('admin.save')}</Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                </View>
            </Modal>
            <ConfirmDialog />
        </View>
    );
};
