import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

interface HeaderProps {
    title: string;
    subtitle?: string;
    showBack?: boolean;
    onBack?: () => void;
    rightAction?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ title, subtitle, showBack, onBack, rightAction }) => {
    return (
        <View className="px-6 pt-6 pb-4 bg-white dark:bg-black border-b border-gray-100 dark:border-gray-800 flex-row items-center justify-between">
            <View className="flex-row items-center flex-1">
                {showBack && (
                    <Animated.View
                        entering={FadeIn.duration(150)}
                        exiting={FadeOut.duration(150)}
                        layout={LinearTransition.springify().damping(35).stiffness(350)}
                    >
                        <TouchableOpacity onPress={onBack} className="mr-4 p-1">
                            <ArrowLeft color="#9ca3af" size={24} />
                        </TouchableOpacity>
                    </Animated.View>
                )}
                <Animated.View
                    className="flex-1"
                    layout={LinearTransition.springify().damping(35).stiffness(350)}
                >
                    <Text className="text-3xl font-bold text-gray-900 dark:text-white tracking-tighter" numberOfLines={1}>
                        {title}
                    </Text>
                    {subtitle && (
                        <Text className="text-gray-500 dark:text-gray-400 font-medium text-sm" numberOfLines={1}>
                            {subtitle}
                        </Text>
                    )}
                </Animated.View>
            </View>
            {rightAction && (
                <View className="ml-4">
                    {rightAction}
                </View>
            )}
        </View>
    );
};
