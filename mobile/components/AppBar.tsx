import React from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { ArrowLeft } from 'lucide-react-native';
import { BlurView } from 'expo-blur';

interface AppBarProps {
    title: string;
    canGoBack: boolean;
    onBack: () => void;
}

export const AppBar: React.FC<AppBarProps> = ({ title, canGoBack, onBack }) => {
    return (
        <View className="bg-white/80 border-b border-gray-100/50 px-6 py-4 flex-row items-center shadow-sm z-10 sticky top-0">
            {canGoBack && (
                <TouchableOpacity onPress={onBack} className="mr-4 p-2 rounded-full bg-gray-50 active:bg-gray-200">
                    <ArrowLeft size={20} color="#1f2937" strokeWidth={2.5} />
                </TouchableOpacity>
            )}
            <Text className="text-2xl font-bold text-gray-900 tracking-tight" numberOfLines={1}>
                {title}
            </Text>
        </View>
    );
};
