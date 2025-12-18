import React from 'react';
import { View, Text, Pressable, Dimensions } from 'react-native';
import { Folder, Heart } from 'lucide-react-native';

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
            <View className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-gray-100 dark:border-zinc-800 aspect-[4/3] justify-between relative overflow-hidden">
                {/* Simplified decorative highlight instead of blur-xl */}
                <View className="absolute -right-4 -top-4 w-24 h-24 bg-blue-100/30 dark:bg-blue-900/10 rounded-full" />

                <View className="bg-blue-50/50 dark:bg-zinc-800 w-12 h-12 rounded-xl items-center justify-center">
                    <Folder size={24} color="#3b82f6" fill="#bfdbfe" />
                </View>

                {isFavorite && (
                    <View className="absolute top-3 right-3 bg-white/50 dark:bg-black/20 p-1.5 rounded-full">
                        <Heart size={14} color="#ef4444" fill="#ef4444" />
                    </View>
                )}

                <View>
                    <Text className="font-semibold text-gray-900 dark:text-gray-100 text-base leading-tight" numberOfLines={2}>
                        {name}
                    </Text>
                    <Text className="text-gray-400 dark:text-gray-500 text-xs mt-1">Folder</Text>
                </View>
            </View>
        </Pressable>
    );
};
