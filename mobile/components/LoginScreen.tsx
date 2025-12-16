import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Image, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { login, setBaseUrl, API_URL } from '../utils/api';
import { LogIn, Server } from 'lucide-react-native';

interface LoginScreenProps {
    onLoginSuccess: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
    const insets = useSafeAreaInsets();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [serverUrl, setServerUrl] = useState(API_URL);
    const [showServerConfig, setShowServerConfig] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        if (!username || !password) {
            Alert.alert('Error', 'Please enter both username and password.');
            return;
        }

        setLoading(true);
        try {
            // Update base URL just in case
            setBaseUrl(serverUrl.trim());

            await login(username, password);
            onLoginSuccess();
        } catch (e: any) {
            Alert.alert('Login Failed', e.message || 'Invalid credentials or server error.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View className="flex-1 bg-white" style={{ paddingTop: insets.top }}>
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                className="flex-1"
            >
                <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 32 }}>

                    <View className="items-center mb-12">
                        {/* Placeholder Logo */}
                        <View className="w-20 h-20 bg-black rounded-3xl mb-4 items-center justify-center transform rotate-3">
                            <Text className="text-white text-4xl font-bold italic">L</Text>
                        </View>
                        <Text className="text-4xl font-black text-gray-900 tracking-tighter text-center">
                            Lumina Gallery
                        </Text>
                        <Text className="text-gray-500 font-medium text-center mt-2">
                            Secure your memories.
                        </Text>
                    </View>

                    <View className="gap-4">
                        <View>
                            <Text className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 ml-1">Username</Text>
                            <TextInput
                                className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-900 font-medium text-lg"
                                placeholder="admin"
                                value={username}
                                onChangeText={setUsername}
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                        </View>

                        <View>
                            <Text className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 ml-1">Password</Text>
                            <TextInput
                                className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-gray-900 font-medium text-lg"
                                placeholder="••••••••"
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry
                                autoCapitalize="none"
                            />
                        </View>

                        <TouchableOpacity
                            onPress={handleLogin}
                            disabled={loading}
                            className={`bg-black rounded-xl p-4 items-center justify-center mt-4 shadow-sm ${loading ? 'opacity-70' : ''}`}
                        >
                            {loading ? (
                                <ActivityIndicator color="white" />
                            ) : (
                                <View className="flex-row items-center gap-2">
                                    <LogIn color="white" size={20} />
                                    <Text className="text-white font-bold text-lg">Sign In</Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    </View>

                    {/* Server Config Toggle */}
                    <TouchableOpacity
                        onPress={() => setShowServerConfig(!showServerConfig)}
                        className="mt-8 items-center flex-row justify-center gap-2 opacity-60"
                    >
                        <Server color="gray" size={14} />
                        <Text className="text-gray-500 text-xs font-medium">Server Configuration</Text>
                    </TouchableOpacity>

                    {showServerConfig && (
                        <View className="mt-4 bg-gray-50 p-4 rounded-xl border border-gray-100">
                            <Text className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Backend URL</Text>
                            <TextInput
                                className="bg-white border border-gray-200 rounded-lg p-3 text-gray-800 text-sm"
                                value={serverUrl}
                                onChangeText={setServerUrl}
                                placeholder="http://..."
                                autoCapitalize="none"
                                autoCorrect={false}
                            />
                        </View>
                    )}

                </ScrollView>
            </KeyboardAvoidingView>
        </View>
    );
};
