import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL, setBaseUrl } from '../utils/api';
import { ArrowLeft, Save, Trash2, Activity, Server, Database } from 'lucide-react-native';
import { Image } from 'react-native';

interface SettingsScreenProps {
    onBack?: () => void;
    onLogout?: () => void;
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

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onBack, onLogout }) => {
    const insets = useSafeAreaInsets();
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
        <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
            {/* Standardized Header */}
            <View className="px-6 pt-6 pb-4 bg-white border-b border-gray-100 flex-row items-center">
                {onBack && (
                    <TouchableOpacity onPress={onBack} className="mr-4">
                        <ArrowLeft color="#000" size={24} />
                    </TouchableOpacity>
                )}
                <View>
                    <Text className="text-3xl font-bold text-gray-900 tracking-tighter">Settings</Text>
                    <Text className="text-gray-500 font-medium">Configuration & Status</Text>
                </View>
            </View>

            <ScrollView className="flex-1 px-6 pt-6">

                {/* Server Configuration */}
                <View className="mb-8">
                    <View className="flex-row items-center mb-4 gap-2">
                        <Server color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800">Server Connection</Text>
                    </View>

                    <View className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <Text className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Backend URL</Text>
                        <TextInput
                            className="bg-white border border-gray-200 rounded-lg p-3 text-gray-800 mb-4"
                            value={url}
                            onChangeText={setUrl}
                            placeholder="http://192.168.1.100:3001"
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                        <TouchableOpacity
                            onPress={handleSave}
                            className="bg-black flex-row items-center justify-center py-3 rounded-lg active:opacity-80 disabled:opacity-50"
                        >
                            <Save color="white" size={18} className="mr-2" />
                            <Text className="text-white font-bold">Save Configuration</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* System Monitoring */}
                <View className="mb-8">
                    <View className="flex-row items-center mb-4 gap-2">
                        <Activity color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800">System Monitor</Text>
                    </View>

                    <View className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                        {loadingStats ? (
                            <ActivityIndicator color="#000" />
                        ) : stats ? (
                            <View className="gap-4">
                                <View className="flex-row justify-between border-b border-gray-200 pb-2">
                                    <Text className="text-gray-500">Total Media</Text>
                                    <Text className="font-bold text-gray-900">{stats.mediaStats?.totalFiles || 0}</Text>
                                </View>
                                <View className="flex-row justify-between border-b border-gray-200 pb-2">
                                    <Text className="text-gray-500">Cache Size</Text>
                                    <Text className="font-bold text-gray-900">{formatBytes(stats.storage)}</Text>
                                </View>
                                <View className="flex-row justify-between border-b border-gray-200 pb-2">
                                    <Text className="text-gray-500">Cache Items</Text>
                                    <Text className="font-bold text-gray-900">{stats.cacheCount}</Text>
                                </View>
                                <View className="flex-row justify-between">
                                    <Text className="text-gray-500">Scan Mode</Text>
                                    <Text className="font-bold text-gray-900 capitalize">{stats.mode}</Text>
                                </View>
                            </View>
                        ) : (
                            <Text className="text-gray-400 text-center italic">Failed to load stats. Check connection.</Text>
                        )}
                        {/* Reload Stats Button */}
                        <TouchableOpacity onPress={loadStats} className="mt-4 self-center px-4 py-2 bg-gray-200 rounded-full">
                            <Text className="text-xs font-bold text-gray-600">Refresh Stats</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Cache Management */}
                <View className="mb-10">
                    <View className="flex-row items-center mb-4 gap-2">
                        <Database color="#4b5563" size={20} />
                        <Text className="text-lg font-bold text-gray-800">Cache Management</Text>
                    </View>
                    <View className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <Text className="text-sm text-gray-600 mb-4 leading-relaxed">
                            Clear the local application cache. This removes stored thumbnails and temporary data to free up space. server cache is managed automatically.
                        </Text>
                        <TouchableOpacity
                            onPress={handleClearAppCache}
                            className="bg-white border border-red-200 flex-row items-center justify-center py-3 rounded-lg active:bg-red-50"
                        >
                            <Trash2 color="#ef4444" size={18} className="mr-2" />
                            <Text className="text-red-500 font-bold">Clear Local Cache</Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Version Info */}
                <View className="mb-10 items-center">
                    <Text className="text-gray-400 text-xs">Lumina Gallery Mobile v1.0.0</Text>
                </View>

            </ScrollView>
        </View>
    );
};
