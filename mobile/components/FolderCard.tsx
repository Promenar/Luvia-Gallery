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
            <View className="bg-gray-50 p-4 rounded-2xl border border-gray-100/80 shadow-sm aspect-[4/3] justify-between relative overflow-hidden group">
                {/* Decorative background circle */}
                <View className="absolute -right-4 -top-4 w-20 h-20 bg-blue-50/50 rounded-full blur-xl" />

                <View className="bg-white w-12 h-12 rounded-xl items-center justify-center shadow-sm border border-gray-50">
                    <Folder size={24} color="#3b82f6" fill="#bfdbfe" />
                </View>

                <View>
                    <Text className="font-semibold text-gray-900 text-base leading-tight" numberOfLines={2}>
                        {name}
                    </Text>
                    <Text className="text-gray-400 text-xs mt-1">Folder</Text>
                </View>
            </View>
        </TouchableOpacity>
    );
};
