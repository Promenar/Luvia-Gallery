import React, { useEffect, useState, useRef } from 'react';
import { View, Text, AppState, AppStateStatus, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import * as ScreenCapture from 'expo-screen-capture';
import * as LocalAuthentication from 'expo-local-authentication';
import { useConfig } from '../utils/ConfigContext';
import { useLanguage } from '../utils/i18n';
import { useAppTheme } from '../utils/ThemeContext';
import { Lock, Fingerprint } from 'lucide-react-native';

interface BiometricGateProps {
    children: React.ReactNode;
}

export const BiometricGate: React.FC<BiometricGateProps> = ({ children }) => {
    const { biometricsEnabled, isConfigLoaded } = useConfig();
    const { t } = useLanguage();
    const { isDark } = useAppTheme();
    const appState = useRef(AppState.currentState);

    // Default to locked for safety during initial load
    const [isLocked, setIsLocked] = useState(true);
    const [isAuthenticating, setIsAuthenticating] = useState(false);
    const [isFocusLost, setIsFocusLost] = useState(false);

    // Initial check on mount or when config loads
    useEffect(() => {
        if (!isConfigLoaded) return;

        if (biometricsEnabled) {
            setIsLocked(true);
            authenticate();
        } else {
            setIsLocked(false);
        }
    }, [isConfigLoaded, biometricsEnabled]);

    // AppState listener
    useEffect(() => {
        const subscription = AppState.addEventListener('change', nextAppState => {
            if (nextAppState === 'active') {
                // Return to active: release focus-lost mask
                setIsFocusLost(false);
                if (biometricsEnabled && isLocked) {
                    authenticate();
                }
            } else {
                // Entering 'inactive' (App Switcher) or 'background'.
                if (biometricsEnabled) {
                    setIsLocked(true);
                    setIsFocusLost(true);
                }
            }

            appState.current = nextAppState;
        });

        return () => {
            subscription.remove();
        };
    }, [biometricsEnabled, isLocked]);

    const authenticate = async () => {
        if (isAuthenticating) return;
        setIsAuthenticating(true);

        try {
            const hasHardware = await LocalAuthentication.hasHardwareAsync();
            const isEnrolled = await LocalAuthentication.isEnrolledAsync();

            if (!hasHardware || !isEnrolled) {
                setIsLocked(false);
                return;
            }

            const result = await LocalAuthentication.authenticateAsync({
                promptMessage: t('auth.biometric_prompt') || 'Authenticate to access Luvia',
                fallbackLabel: t('auth.use_passcode') || 'Use Passcode',
                cancelLabel: t('btn.cancel') || 'Cancel',
                disableDeviceFallback: false,
            });

            if (result.success) {
                setIsLocked(false);
            }
        } catch (e) {
            console.error("Authentication error", e);
        } finally {
            setIsAuthenticating(false);
        }
    };

    // Aggressive mask: Locked or Focus is lost (App Switcher)
    const showMask = !isConfigLoaded || isLocked || isFocusLost;

    return (
        <View style={{ flex: 1, backgroundColor: isDark ? '#000' : '#fff' }}>
            {/* Content layer */}
            {children}

            {showMask && (
                <View
                    style={[
                        StyleSheet.absoluteFill,
                        {
                            zIndex: 99999,
                            backgroundColor: isDark ? '#121212' : '#f8f8f8',
                            // 确保遮罩层覆盖状态栏区域
                            marginTop: Platform.OS === 'android' ? -50 : 0,
                            height: Platform.OS === 'android' ? '120%' : '100%',
                        }
                    ]}
                >
                    <BlurView
                        intensity={Platform.OS === 'android' ? 100 : 80}
                        tint={isDark ? 'systemThickMaterialDark' : 'systemThickMaterialLight'}
                        style={[StyleSheet.absoluteFill, {
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: isDark ? 'rgba(18,18,18,0.85)' : 'rgba(248,248,248,0.85)'
                        }]}
                    >
                        {/* UI: Only show text/buttons if config is loaded and NOT just a temporary blur for App Switcher */}
                        {isConfigLoaded && !isFocusLost && (
                            <View className="items-center">
                                <View className="bg-gray-100 dark:bg-zinc-800 p-6 rounded-full mb-6">
                                    <Lock size={48} color={isDark ? '#fff' : '#000'} />
                                </View>
                                <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                                    {t('auth.locked') || 'Luvia Locked'}
                                </Text>
                                <Text className="text-gray-500 dark:text-gray-400 mb-8 text-center max-w-[250px]">
                                    {t('auth.locked_desc') || 'Unlock to view your gallery'}
                                </Text>

                                <TouchableOpacity
                                    onPress={authenticate}
                                    className="bg-black dark:bg-white px-8 py-3 rounded-full flex-row items-center"
                                >
                                    <Fingerprint size={20} color={isDark ? '#000' : '#fff'} className="mr-2" />
                                    <Text className="text-white dark:text-black font-bold text-lg">
                                        {t('auth.unlock') || 'Tap to Unlock'}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </BlurView>
                </View>
            )}
        </View>
    );
};
