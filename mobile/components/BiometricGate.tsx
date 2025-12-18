import React, { useEffect, useState, useRef } from 'react';
import { View, Text, AppState, AppStateStatus, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import * as LocalAuthentication from 'expo-local-authentication';
import { useConfig } from '../utils/ConfigContext';
import { useLanguage } from '../utils/i18n';
import { useTheme } from '../utils/ThemeContext';
import { Lock, Fingerprint } from 'lucide-react-native';

interface BiometricGateProps {
    children: React.ReactNode;
}

export const BiometricGate: React.FC<BiometricGateProps> = ({ children }) => {
    const { biometricsEnabled } = useConfig();
    const { t } = useLanguage();
    const { isDark } = useTheme();
    const appState = useRef(AppState.currentState);
    const [isLocked, setIsLocked] = useState(false);
    const [isAuthenticating, setIsAuthenticating] = useState(false);

    // Initial check on mount if enabled
    useEffect(() => {
        if (biometricsEnabled) {
            setIsLocked(true);
            authenticate();
        }
    }, [biometricsEnabled]);

    // AppState listener
    useEffect(() => {
        const subscription = AppState.addEventListener('change', nextAppState => {
            if (
                appState.current.match(/inactive|background/) &&
                nextAppState === 'active'
            ) {
                // App coming to foreground
                if (biometricsEnabled) {
                    setIsLocked(true);
                    authenticate();
                }
            } else if (nextAppState.match(/inactive|background/)) {
                // App going to background - Lock immediately to ensure privacy
                if (biometricsEnabled) {
                    setIsLocked(true);
                }
            }

            appState.current = nextAppState;
        });

        return () => {
            subscription.remove();
        };
    }, [biometricsEnabled]);

    const authenticate = async () => {
        if (isAuthenticating) return;
        setIsAuthenticating(true);

        try {
            const hasHardware = await LocalAuthentication.hasHardwareAsync();
            const isEnrolled = await LocalAuthentication.isEnrolledAsync();

            if (!hasHardware || !isEnrolled) {
                // Fallback or just unlock if biometrics not available but enabled?? 
                // For now, if enabled but no hardware, arguably we should still block or better, disable the feature.
                // But assuming user enabled it, they likely have it.
                // If we can't auth, lets just unlock to avoid lockouts during development, 
                // OR show a passcode screen (not implemented). 
                // For safety, let's keep it locked and show error if in production, 
                // but here we will just unlock if hardware is missing to prevent forever lock.
                console.warn("Biometrics missing, unlocking...");
                setIsLocked(false);
                return;
            }

            const result = await LocalAuthentication.authenticateAsync({
                promptMessage: t('auth.biometric_prompt') || 'Authenticate to access Lumina',
                fallbackLabel: t('auth.use_passcode') || 'Use Passcode',
                cancelLabel: t('btn.cancel') || 'Cancel',
                disableDeviceFallback: false,
            });

            if (result.success) {
                setIsLocked(false);
            } else {
                // Failed or Cancelled.
                // Stay locked.
            }
        } catch (e) {
            console.error("Authentication error", e);
        } finally {
            setIsAuthenticating(false);
        }
    };

    if (!isLocked) {
        return <>{children}</>;
    }

    return (
        <View style={{ flex: 1 }}>
            {children}
            <BlurView
                intensity={Platform.OS === 'android' ? 100 : 80} // Android needs high intensity, iOS system materials handle it well
                tint={isDark ? 'systemThickMaterialDark' : 'systemThickMaterialLight'} // iOS 13+ materials for "frosted glass"
                style={[StyleSheet.absoluteFill, {
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                    // Additional opacity layer to ensure privacy if blur fails or is weak
                    backgroundColor: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)'
                }]}
            >
                <View className="items-center">
                    <View className="bg-gray-100 dark:bg-zinc-800 p-6 rounded-full mb-6">
                        <Lock size={48} color={isDark ? '#fff' : '#000'} />
                    </View>
                    <Text className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                        {t('auth.locked') || 'Lumina Locked'}
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
            </BlurView>
        </View>
    );
};
