import React, { useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Image, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import Animated, { FadeInUp, Layout } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { login, setBaseUrl, API_URL } from '../utils/api';
import { LogIn, Server, Moon, Sun, Globe } from 'lucide-react-native';
import { useAppTheme } from '../utils/ThemeContext';
import { useLanguage } from '../utils/i18n';
import { useToast } from '../utils/ToastContext';

interface LoginScreenProps {
    onLoginSuccess: (data: any) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
    const { showToast } = useToast();
    const insets = useSafeAreaInsets();
    const scrollViewRef = useRef<ScrollView>(null);
    const { mode, setMode, isDark } = useAppTheme();
    const { language, setLanguage, t } = useLanguage();

    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [serverUrl, setServerUrl] = useState(API_URL);
    const [showServerConfig, setShowServerConfig] = useState(false);
    const [loading, setLoading] = useState(false);

    const toggleServerConfig = () => {
        setShowServerConfig(!showServerConfig);
    };

    const handleLogin = async () => {
        if (!username || !password) {
            showToast(t('login.error_missing'), 'error');
            return;
        }

        setLoading(true);
        try {
            // Update base URL and persist it immediately so it's not lost on restart
            await setBaseUrl(serverUrl, true);

            const data = await login(username, password);
            onLoginSuccess(data);
        } catch (e: any) {
            showToast(e.message || t('login.error_failed'), 'error');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View className="flex-1 bg-white dark:bg-black" style={{ paddingTop: insets.top }}>
            {/* Theme & Language Toggles */}
            <View
                className="absolute right-8 z-10 flex-row gap-6"
                style={{ top: insets.top + 20 }}
            >
                <TouchableOpacity onPress={() => setLanguage(language === 'zh' ? 'en' : 'zh')}>
                    <Globe color={isDark ? "white" : "black"} size={24} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setMode(isDark ? 'light' : 'dark')}>
                    {isDark ? <Sun color="white" size={24} /> : <Moon color="black" size={24} />}
                </TouchableOpacity>
            </View>

            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
                className="flex-1"
            >
                <ScrollView
                    ref={scrollViewRef}
                    contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 32, paddingBottom: 100 }}
                    keyboardShouldPersistTaps="handled"
                >

                    <Animated.View
                        layout={Layout.springify()}
                        className="items-center mb-12"
                    >
                        {/* Placeholder Logo */}
                        <View className="w-20 h-20 bg-black dark:bg-zinc-800 rounded-3xl mb-4 items-center justify-center transform rotate-3">
                            <Text className="text-white text-4xl font-bold italic">L</Text>
                        </View>
                        <Text className="text-4xl font-black text-gray-900 dark:text-white tracking-tighter text-center">
                            Lumina Gallery
                        </Text>
                        <Text className="text-gray-500 dark:text-gray-400 font-medium text-center mt-2">
                            {t('login.subtitle')}
                        </Text>
                    </Animated.View>

                    <Animated.View layout={Layout.springify()} className="gap-4">
                        <View>
                            <Text className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 ml-1">{t('login.username')}</Text>
                            <TextInput
                                className="bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4 text-gray-900 dark:text-white font-medium text-lg"
                                value={username}
                                onChangeText={setUsername}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                        </View>

                        <View>
                            <Text className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 ml-1">{t('login.password')}</Text>
                            <TextInput
                                className="bg-gray-50 dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 rounded-xl p-4 text-gray-900 dark:text-white font-medium text-lg"
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry
                                autoCapitalize="none"
                            />
                        </View>

                        <TouchableOpacity
                            onPress={handleLogin}
                            disabled={loading}
                            className={`bg-black dark:bg-zinc-800 rounded-xl p-4 items-center justify-center mt-4 shadow-sm ${loading ? 'opacity-70' : ''}`}
                        >
                            {loading ? (
                                <ActivityIndicator color="white" />
                            ) : (
                                <View className="flex-row items-center gap-2">
                                    <LogIn color="white" size={20} />
                                    <Text className="text-white font-bold text-lg">{t('login.signin')}</Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    </Animated.View>

                    {/* Server Config Toggle */}
                    <TouchableOpacity
                        onPress={toggleServerConfig}
                        className="mt-8 items-center flex-row justify-center gap-2 opacity-60"
                    >
                        <Server color="gray" size={14} />
                        <Text className="text-gray-500 text-xs font-medium">{t('login.server_config')}</Text>
                    </TouchableOpacity>

                    {showServerConfig && (
                        <Animated.View
                            entering={FadeInUp.duration(300)}
                            layout={Layout.springify()}
                            className="mt-4 bg-gray-50 dark:bg-zinc-900 p-4 rounded-xl border border-gray-100 dark:border-zinc-800"
                        >
                            <Text className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('login.backend_url')}</Text>
                            <TextInput
                                className="bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg p-3 text-gray-800 dark:text-white text-sm"
                                value={serverUrl}
                                onChangeText={setServerUrl}
                                autoCapitalize="none"
                                autoCorrect={false}
                                onFocus={() => {
                                    setTimeout(() => {
                                        scrollViewRef.current?.scrollToEnd({ animated: true });
                                    }, 300);
                                }}
                            />
                        </Animated.View>
                    )}

                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
};
