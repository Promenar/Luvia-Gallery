import React from 'react';
import { View, Text, TouchableOpacity, Dimensions } from 'react-native';
import { Folder } from 'lucide-react-native';

interface FolderCardProps {
    name: string;
    onPress: () => void;
}

export const FolderCard: React.FC<FolderCardProps> = ({ name, onPress }) => {
    return (
        <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.7}
            className="w-full"
        >
            <View className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-2xl border border-gray-100/80 dark:border-zinc-800 shadow-sm aspect-[4/3] justify-between relative overflow-hidden group">
                {/* Decorative background circle */}
                <View className="absolute -right-4 -top-4 w-20 h-20 bg-blue-50/50 dark:bg-blue-900/20 rounded-full blur-xl" />

                <View className="bg-white dark:bg-zinc-800 w-12 h-12 rounded-xl items-center justify-center shadow-sm border border-gray-50 dark:border-zinc-700">
                    <Folder size={24} color="#3b82f6" fill="#bfdbfe" />
                </View>

                <View>
                    <Text className="font-semibold text-gray-900 dark:text-gray-100 text-base leading-tight" numberOfLines={2}>
                        {name}
                    </Text>
                    <Text className="text-gray-400 dark:text-gray-500 text-xs mt-1">Folder</Text>
                </View>
            </View>
        </TouchableOpacity>
    );
};
