import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL, setBaseUrl } from '../utils/api';
import { ArrowLeft, Save, Trash2, Activity, Server, Database, User, Moon, Globe, HardDrive } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'react-native';
import { Header } from './Header';
import { useLanguage } from '../utils/i18n';
import { useTheme } from '../utils/ThemeContext';

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
    const [url, setUrl] = useState(API_URL);
    const [stats, setStats] = useState<SystemStatus | null>(null);
    const [loadingStats, setLoadingStats] = useState(false);

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
        const cleanUrl = url.trim().replace(/\/$/, '');
        setBaseUrl(cleanUrl);
        await AsyncStorage.setItem('lumina_api_url', cleanUrl);
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
                            // We don't remove URL, just data
                            Alert.alert("Success", "Local cache cleared.");
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

                {/* User Account */}
                <View className="mb-8">
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

                {/* Appearance */}
                <View className="mb-8">
                    <View className="flex-row items-center mb-4 gap-2">
                        <Moon color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('settings.appearance')}</Text>
                    </View>
                    <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800 flex-row justify-between items-center">
                        <Text className="text-gray-800 dark:text-gray-100 font-medium">{t('settings.dark_mode')}</Text>
                        <TouchableOpacity
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                setMode(mode === 'dark' ? 'light' : 'dark');
                            }}
                            className={`px-4 py-2 rounded-full ${mode === 'dark' ? 'bg-black border border-white/20' : 'bg-gray-200'}`}
                        >
                            <Text className={`${mode === 'dark' ? 'text-white' : 'text-gray-800'} font-bold capitalize`}>
                                {mode === 'dark' ? t('status_on') : t('status_off')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Language */}
                <View className="mb-8">
                    <View className="flex-row items-center mb-4 gap-2">
                        <Globe color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800 dark:text-gray-100">{t('settings.language')}</Text>
                    </View>
                    <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800 flex-row justify-between items-center">
                        <Text className="text-gray-800 dark:text-gray-100 font-medium">{language === 'zh' ? '简体中文' : 'English'}</Text>
                        <TouchableOpacity
                            onPress={() => {
                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                setLanguage(language === 'zh' ? 'en' : 'zh');
                            }}
                            className="px-4 py-2 bg-black rounded-full"
                        >
                            <Text className="text-white font-bold">{t('action.switch')}</Text>
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

                {/* Cache Management */}
                <View className="mb-10">
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

                {/* Version Info */}
                <View className="mb-10 items-center">
                    <Text className="text-gray-400 text-xs">Lumina Gallery 移动版 v1.0.0</Text>
                </View>

            </ScrollView>
        </View>
    );
};
