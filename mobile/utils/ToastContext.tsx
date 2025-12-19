import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from './ThemeContext';

type ToastType = 'success' | 'error' | 'info' | 'progress';

interface ToastContextType {
    showToast: (message: string, type?: ToastType, progress?: number, onCancel?: () => void) => void;
    hideToast: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toast, setToast] = useState<{
        message: string;
        type: ToastType;
        visible: boolean;
        progress?: number;
        onCancel?: () => void;
    }>({
        message: '',
        type: 'info',
        visible: false,
        progress: 0,
    });

    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const isVisibleRef = useRef(false);
    const lastVibratedTypeRef = useRef<ToastType | null>(null);

    const hideToast = useCallback(() => {
        setToast(prev => ({ ...prev, visible: false }));
        isVisibleRef.current = false;
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    const showToast = useCallback((message: string, type: ToastType = 'info', progress?: number, onCancel?: () => void) => {
        if (timerRef.current) clearTimeout(timerRef.current);

        // SYNC LOCK (Ref-based): Synchronously determine if we should vibrate before state updates
        const shouldVibrate = !isVisibleRef.current || lastVibratedTypeRef.current !== type;

        setToast({ message, type, visible: true, progress, onCancel });
        isVisibleRef.current = true;
        lastVibratedTypeRef.current = type;

        if (shouldVibrate) {
            if (type === 'success') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else if (type === 'error') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            } else if (type === 'progress') {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            } else {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
        }

        if (type !== 'progress') {
            timerRef.current = setTimeout(() => {
                setToast(prev => ({ ...prev, visible: false }));
                isVisibleRef.current = false;
            }, 2500);
        }
    }, []);

    return (
        <ToastContext.Provider value={{ showToast, hideToast }}>
            {children}
            <ToastComponent
                message={toast.message}
                type={toast.type}
                visible={toast.visible}
                progress={toast.progress}
                onCancel={toast.onCancel}
                onHide={hideToast}
            />
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

// Internal Toast Component
import Animated, { FadeInUp, FadeOutUp, Layout } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { CheckCircle, AlertCircle, Info, Download, X } from 'lucide-react-native';
import { Portal } from 'react-native-paper';

const ToastComponent = ({
    message,
    type,
    visible,
    progress,
    onCancel,
    onHide
}: {
    message: string,
    type: ToastType,
    visible: boolean,
    progress?: number,
    onCancel?: () => void,
    onHide: () => void
}) => {
    const insets = useSafeAreaInsets();
    const { isDark } = useAppTheme();
    if (!visible) return null;

    const getIcon = () => {
        switch (type) {
            case 'success': return <CheckCircle size={14} color="#4ade80" />;
            case 'error': return <AlertCircle size={14} color="#f87171" />;
            case 'progress': return <Download size={14} color="#60a5fa" />;
            default: return <Info size={14} color="#60a5fa" />;
        }
    };

    const topPosition = insets.top + 34;

    return (
        <Portal>
            <View
                className="absolute top-0 left-0 right-0 items-center pointer-events-none"
                style={{ zIndex: 99999, elevation: 100 }}
            >
                <Animated.View
                    entering={FadeInUp.springify().damping(20).stiffness(120)}
                    exiting={FadeOutUp.duration(300)}
                    layout={Layout.springify().damping(25)}
                    className="overflow-hidden rounded-full border border-white/20 shadow-2xl"
                    style={{
                        top: topPosition,
                        backgroundColor: isDark ? 'rgba(30,30,30,0.7)' : 'rgba(255,255,255,0.85)',
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 12 },
                        shadowOpacity: 0.4,
                        shadowRadius: 20,
                        elevation: 15,
                        minWidth: 160,
                        maxWidth: '85%',
                    }}
                >
                    <BlurView intensity={Platform.OS === 'ios' ? 80 : 100} tint={isDark ? "dark" : "light"} className="flex-row items-center justify-center px-6 py-3">
                        <View className="mr-3">
                            {getIcon()}
                        </View>

                        <View className="flex-row items-center">
                            <Text className={`font-semibold tracking-wide text-[13px] ${isDark ? 'text-white' : 'text-gray-900'}`} numberOfLines={1}>
                                {message}
                            </Text>

                            {type === 'progress' && progress !== undefined && (
                                <View style={{ minWidth: 45, marginLeft: 4 }}>
                                    <Text className={`font-mono text-[12px] font-bold ${isDark ? 'text-white/60' : 'text-gray-500'}`}>
                                        {Math.round(progress)}%
                                    </Text>
                                </View>
                            )}
                        </View>

                        {type === 'progress' && onCancel && (
                            <TouchableOpacity
                                onPress={onCancel}
                                className={`ml-4 pl-3 border-l ${isDark ? 'border-white/10' : 'border-black/5'} pointer-events-auto h-5 justify-center`}
                                activeOpacity={0.6}
                            >
                                <X size={16} color={isDark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)"} />
                            </TouchableOpacity>
                        )}
                        {/* Balance padding for visual centering when no cancel button exists */}
                        {!onCancel && <View className="w-2" />}
                    </BlurView>
                </Animated.View>
            </View>
        </Portal>
    );
};
