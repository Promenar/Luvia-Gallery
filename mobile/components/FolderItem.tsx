import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';


// Note: lucide-react-native needs to be installed if we use icons.
// If not, I'll use a text fallback or simple View.
// I haven't installed lucide-react-native. I'll use simple Text "Folder".

interface FolderItemProps {
    name: string;
    onPress: () => void;
}

export const FolderItem: React.FC<FolderItemProps> = ({ name, onPress }) => {
    return (
        <TouchableOpacity onPress={onPress} className="mr-4 items-center">
            <View className="w-16 h-16 bg-blue-100 rounded-xl items-center justify-center mb-1">
                <Text className="text-2xl">📁</Text>
            </View>
            <Text className="text-sm font-medium text-gray-700" numberOfLines={1}>{name}</Text>
        </TouchableOpacity>
    );
};
