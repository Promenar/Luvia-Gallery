import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL, setBaseUrl } from '../utils/api';
import { ArrowLeft, Save, Trash2, Activity, Server, Database, User, Moon, Globe, HardDrive, Lock } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'react-native';
import { Header } from './Header';
import { useLanguage } from '../utils/i18n';
import { useTheme } from '../utils/ThemeContext';
import { useConfig } from '../utils/ConfigContext';
import { ItemPicker } from './ItemPicker';
import { Layout, Images, PlayCircle } from 'lucide-react-native';

interface SettingsScreenProps {
    onBack?: () => void;
    onLogout?: () => void;
    username?: string;
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

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onBack, onLogout, username }) => {
    const insets = useSafeAreaInsets();
    const { t, language, setLanguage } = useLanguage();
    const { mode, setMode } = useTheme();
    const { carouselConfig, setCarouselConfig, biometricsEnabled, setBiometricsEnabled } = useConfig();
    const [url, setUrl] = useState(API_URL);
    const [stats, setStats] = useState<SystemStatus | null>(null);
    const [loadingStats, setLoadingStats] = useState(false);
    const [isPickerOpen, setIsPickerOpen] = useState<{ visible: boolean, mode: 'folder' | 'file' }>({ visible: false, mode: 'folder' });

    useEffect(() => {
        loadStats();
    }, []);

    const loadStats = async () => {
        setLoadingStats(true);
        try {
            const res = await fetch(`${API_URL}/api/system/status`);
            if (res.ok) {
                const data = await res.json();
                setStats(data);
            }
        } catch (e) {
            console.error("Failed to load system stats", e);
        } finally {
            setLoadingStats(false);
        }
    };

    const handleSave = async () => {
        await setBaseUrl(url, true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert('Saved', 'Server URL has been updated. Please restart the app for full effect.');
        if (onBack) onBack();
    };

    const handleClearAppCache = async () => {
        Alert.alert(
            "Clear App Cache",
            "This will remove local data and thumbnails. You will need to reload data from the server. Continue?",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Clear",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            // Clear stored cache keys
                            await AsyncStorage.removeItem('lumina_cache_home');
                            // Clear SQLite Cache
                            const { clearStaticCache } = await import('../utils/api');
                            await clearStaticCache();

                            // We don't remove URL, just data
                            Alert.alert("Success", t('msg.cache_cleared') || "Local cache cleared.");
                            // Attempt to reload stats
                            loadStats();
                        } catch (e) {
                            Alert.alert("Error", "Failed to clear cache.");
                        }
                    }
                }
            ]
        );
    };

    const formatBytes = (bytes: number) => {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

                {/* Appearance */}
                <View className="mb-8">
                    <View className="flex-row items-center mb-4 gap-2">
                        <Moon color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('settings.appearance')}</Text>
                    </View>
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
                </View>

                {/* Language */}
                <View className="mb-8">
                    <View className="flex-row items-center mb-4 gap-2">
                        <Globe color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('settings.language')}</Text>
                    </View>
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
                </View>

                {/* Carousel Configuration */}
                <View className="mb-8">
                    <View className="flex-row items-center mb-4 gap-2">
                        <Layout color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('settings.carousel')}</Text>
                    </View>
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
                    </View>
                </View>

                {/* System Monitoring */}
                <View className="mb-8">
                    <View className="flex-row items-center mb-4 gap-2">
                        <HardDrive color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('section.system')}</Text>
                    </View>

                    <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800">
                        {loadingStats ? (
                            <ActivityIndicator color={mode === 'dark' ? "#fff" : "#000"} />
                        ) : stats ? (
                            <View className="gap-4">
                                <View className="flex-row justify-between border-b border-gray-200 dark:border-zinc-800 pb-2">
                                    <Text className="text-gray-500 dark:text-gray-400">{t('stats.total_media')}</Text>
                                    <Text className="font-bold text-gray-900 dark:text-white">{stats.mediaStats?.totalFiles || 0}</Text>
                                </View>
                                <View className="flex-row justify-between border-b border-gray-200 dark:border-zinc-800 pb-2">
                                    <Text className="text-gray-500 dark:text-gray-400">{t('stats.cache_size')}</Text>
                                    <Text className="font-bold text-gray-900 dark:text-white">{formatBytes(stats.storage)}</Text>
                                </View>
                                <View className="flex-row justify-between border-b border-gray-200 dark:border-zinc-800 pb-2">
                                    <Text className="text-gray-500 dark:text-gray-400">{t('stats.cache_items')}</Text>
                                    <Text className="font-bold text-gray-900 dark:text-white">{stats.cacheCount}</Text>
                                </View>
                                <View className="flex-row justify-between">
                                    <Text className="text-gray-500 dark:text-gray-400">{t('stats.scan_mode')}</Text>
                                    <Text className="font-bold text-gray-900 dark:text-white capitalize">{stats.mode}</Text>
                                </View>
                            </View>
                        ) : (
                            <Text className="text-gray-400 text-center italic">{t('msg.load_error')}</Text>
                        )}
                        {/* Reload Stats Button */}
                        <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); loadStats(); }} className="mt-4 self-center px-4 py-2 bg-gray-200 dark:bg-zinc-800 rounded-full">
                            <Text className="text-xs font-bold text-gray-600 dark:text-gray-300">{t('action.refresh')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Security */}
                <View className="mb-8">
                    <View className="flex-row items-center mb-4 gap-2">
                        <Lock color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('settings.security') || 'Security'}</Text>
                    </View>
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
                </View>

                {/* Cache Management */}
                <View className="mb-8">
                    <View className="flex-row items-center mb-4 gap-2">
                        <Database color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('section.cache')}</Text>
                    </View>
                    <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800">
                        <Text className="text-sm text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                            {t('msg.cache_desc')}
                        </Text>
                        <TouchableOpacity
                            onPress={() => {
                                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                                handleClearAppCache();
                            }}
                            className="bg-white dark:bg-zinc-800 border border-red-200 dark:border-red-900 flex-row items-center justify-center py-3 rounded-lg active:bg-red-50 dark:active:bg-red-900/10"
                        >
                            <Trash2 color="#ef4444" size={18} className="mr-2" />
                            <Text className="text-red-500 font-bold">{t('label.clear_cache')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Server Configuration */}
                <View className="mb-8">
                    <View className="flex-row items-center mb-4 gap-2">
                        <Server color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('settings.server')}</Text>
                    </View>

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
                            <Save color={useTheme().mode === 'dark' ? 'black' : 'white'} size={18} className="mr-2" />
                            <Text className="text-white dark:text-black font-bold">{t('action.save')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* User Account */}
                <View className="mb-10">
                    <View className="flex-row items-center mb-4 gap-2">
                        <User color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('section.user')}</Text>
                    </View>
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
                </View>

                {/* Version Info */}
                <View className="mb-10 items-center">
                    <Text className="text-gray-400 text-xs">Lumina Gallery 移动版 v1.0.0</Text>
                </View>

            </ScrollView>

            <ItemPicker
                visible={isPickerOpen.visible}
                mode={isPickerOpen.mode}
                onClose={() => setIsPickerOpen({ ...isPickerOpen, visible: false })}
                onSelect={async (value, name) => {
                    await setCarouselConfig({
                        sourceType: isPickerOpen.mode,
                        sourceValue: value,
                        sourceName: name
                    });
                    setIsPickerOpen({ ...isPickerOpen, visible: false });
                }}
            />
        </View>
    );
};
