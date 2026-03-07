import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface HeaderProps {
    title: string;
    subtitle?: string;
    showBack?: boolean;
    onBack?: () => void;
    rightAction?: React.ReactNode;
}

export const Header: React.FC<HeaderProps> = ({ title, showBack, onBack, rightAction }) => {
    const insets = useSafeAreaInsets();

    return (
        <View
            style={{ paddingTop: insets.top + 10 }}
            className="px-6 pb-4 bg-white dark:bg-black flex-row items-center justify-between"
        >
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
                    className="flex-1 justify-center"
                    layout={LinearTransition.springify().damping(35).stiffness(350)}
                >
                    <Text className="text-3xl font-bold text-gray-900 dark:text-white tracking-tighter mt-1" numberOfLines={1}>
                        {title}
                    </Text>
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
