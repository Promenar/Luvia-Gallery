import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { FolderOpen, Heart } from 'lucide-react-native';

interface FolderCardProps {
    name: string;
    path: string;
    isFavorite?: boolean;
    onPress: () => void;
    onLongPress?: () => void;
}

export const FolderCard: React.FC<FolderCardProps> = ({ name, path, isFavorite, onPress, onLongPress }) => {
    return (
        <Pressable
            onPress={onPress}
            onLongPress={onLongPress}
            className="w-full"
        >
            <View className="bg-white dark:bg-zinc-900 overflow-hidden rounded-[28px] border border-gray-100 dark:border-zinc-800 aspect-[4/3] relative">
                <View className="p-5 flex-1 justify-between">
                    <View className="flex-row justify-between items-start">
                        {/* More organic and softer icon container */}
                        <View className="w-12 h-12 rounded-2xl bg-gray-50 dark:bg-zinc-800 items-center justify-center border border-gray-100/50 dark:border-zinc-700/50">
                            <FolderOpen size={24} color="#64748b" strokeWidth={1.5} />
                        </View>

                        {isFavorite && (
                            <View className="p-1.5">
                                <Heart size={16} color="#ef4444" fill="#ef4444" />
                            </View>
                        )}
                    </View>

                    <View className="mb-1">
                        <Text className="font-bold text-gray-900 dark:text-gray-100 text-[18px] tracking-tight" numberOfLines={1}>
                            {name}
                        </Text>
                        <Text className="text-gray-400 dark:text-gray-500 text-[11px] font-semibold uppercase tracking-widest mt-1">
                            Media Archive
                        </Text>
                    </View>
                </View>

                {/* Subtle soft accent at the bottom */}
                <View className="absolute bottom-0 left-0 right-0 h-1 bg-blue-500/5 dark:bg-blue-500/10" />
            </View>
        </Pressable>
    );
};
