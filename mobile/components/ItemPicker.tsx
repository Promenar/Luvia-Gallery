import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, Modal, ActivityIndicator } from 'react-native';
import { MediaItem } from '../types';
import { fetchFolders, fetchFiles } from '../utils/api';
import { FolderCard } from './FolderCard';
import { MediaCard } from './MediaCard';
import { ArrowLeft, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/* 
  Reusable Item Picker for Settings
  mode: 'folder' -> Select a folder path
  mode: 'file' -> Select a file ID (image/video only)
*/

interface ItemPickerProps {
    visible: boolean;
    mode: 'folder' | 'file';
    onSelect: (value: string, name: string) => void;
    onClose: () => void;
}

export const ItemPicker: React.FC<ItemPickerProps> = ({ visible, mode, onSelect, onClose }) => {
    const insets = useSafeAreaInsets();
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [currentPath, setCurrentPath] = useState<string>('');

    useEffect(() => {
        if (visible) {
            loadItems(currentPath);
        }
    }, [visible, currentPath, mode]);

    const loadItems = async (path: string) => {
        setLoading(true);
        try {
            if (mode === 'folder') {
                const res = await fetchFolders(path);
                const responseData = res.children || res.folders || res;
                let folderList = [];
                if (Array.isArray(responseData)) {
                    folderList = responseData;
                } else {
                    folderList = Object.values(responseData || {}).map((f: any) => ({
                        id: f.path,
                        name: f.name,
                        path: f.path,
                        coverMedia: f.coverMedia,
                        mediaCount: f.mediaCount,
                        type: 'folder'
                    }));
                }
                setItems(folderList);
            } else {
                const res = await fetchFiles({ limit: 100, mediaType: ['image', 'video'], folderPath: path || undefined });
                setItems(res.files || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handlePress = (item: any) => {
        if (mode === 'folder') {
            setCurrentPath(item.path);
        } else {
            onSelect(item.id, item.name);
            onClose();
        }
    };

    const handleBack = () => {
        if (currentPath === '') return;
        const parts = currentPath.split('/');
        parts.pop();
        setCurrentPath(parts.join('/'));
    }

    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
            <View style={{ flex: 1, backgroundColor: '#fff' }}>
                <View className="px-4 py-4 border-b border-gray-100 flex-row items-center justify-between">
                    <TouchableOpacity onPress={onClose} className="p-2 bg-gray-100 rounded-full">
                        <X size={20} color="#000" />
                    </TouchableOpacity>
                    <Text className="font-bold text-lg">
                        {mode === 'folder' ? 'Choose Folder' : 'Choose File'}
                    </Text>
                    <View style={{ width: 40 }} />
                </View>

                {mode === 'folder' && (
                    <View className="px-4 py-3 bg-gray-50 flex-row items-center justify-between border-b border-gray-200">
                        <View className="flex-1 mr-2">
                            <Text numberOfLines={1} className="text-gray-500 text-xs uppercase mb-1">Current</Text>
                            <Text numberOfLines={1} className="font-bold">{currentPath || 'Root'}</Text>
                        </View>

                        <View className="flex-row gap-2">
                            {currentPath !== '' && (
                                <TouchableOpacity onPress={handleBack} className="bg-gray-200 px-3 py-2 rounded-lg">
                                    <ArrowLeft size={16} color="black" />
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity
                                onPress={() => {
                                    onSelect(currentPath, currentPath || 'Root');
                                    onClose();
                                }}
                                className="bg-black px-4 py-2 rounded-lg"
                            >
                                <Text className="text-white font-bold text-xs">Select This</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {loading ? (
                    <View className="flex-1 justify-center items-center">
                        <ActivityIndicator size="large" color="black" />
                    </View>
                ) : (
                    <FlatList
                        key={mode} // Force re-render when mode changes
                        data={items}
                        keyExtractor={(item) => item.id || item.path}
                        numColumns={mode === 'file' ? 3 : 2}
                        contentContainerStyle={{ padding: 12, gap: 12 }}
                        columnWrapperStyle={mode !== 'folder' && mode !== 'file' ? undefined : { gap: 12 }}
                        renderItem={({ item }) => (
                            mode === 'folder' ? (
                                <View style={{ flex: 1 }}>
                                    <FolderCard
                                        name={item.name}
                                        onPress={() => handlePress(item)}
                                    />
                                </View>
                            ) : (
                                <View className="flex-1 aspect-square">
                                    <MediaCard
                                        item={item}
                                        onPress={() => handlePress(item)}
                                    />
                                </View>
                            )
                        )}
                    />
                )}
            </View>
        </Modal>
    );
};
