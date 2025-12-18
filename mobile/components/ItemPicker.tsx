import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, Modal, ActivityIndicator, BackHandler, useWindowDimensions } from 'react-native';
import { MediaItem } from '../types';
import { fetchFolders, fetchFiles } from '../utils/api';
import { FolderCard } from './FolderCard';
import { MediaCard } from './MediaCard';
import { ArrowLeft, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../utils/i18n';
import { useTheme } from '../utils/ThemeContext';

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
    const { width } = useWindowDimensions();
    const { t } = useLanguage();
    const { isDark } = useTheme();
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [currentPath, setCurrentPath] = useState<string>('');

    // 计算动态列数
    const numColumns = mode === 'file'
        ? Math.max(3, Math.floor(width / 110))
        : Math.max(2, Math.floor(width / 160));

    useEffect(() => {
        if (visible) {
            loadItems(currentPath);
        }
    }, [visible, currentPath, mode]);

    // Handle Android hardware back button
    useEffect(() => {
        const handleBackPress = () => {
            if (visible) {
                if (currentPath !== '') {
                    handleBack();
                } else {
                    onClose();
                }
                return true;
            }
            return false;
        };

        const subscription = BackHandler.addEventListener('hardwareBackPress', handleBackPress);
        return () => subscription.remove();
    }, [visible, currentPath]);

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
        const parts = currentPath.split(/[/\\]/); // Support both slashes
        parts.pop();
        setCurrentPath(parts.join('/'));
    }

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onClose} // Mandatory for Android Modal
        >
            <View className="flex-1 bg-white dark:bg-black">
                <View className="px-4 py-4 border-b border-gray-100 dark:border-white/10 flex-row items-center justify-between">
                    <TouchableOpacity onPress={onClose} className="p-2 bg-gray-100 dark:bg-zinc-800 rounded-full">
                        <X size={20} color={isDark ? "white" : "black"} />
                    </TouchableOpacity>
                    <Text className="font-bold text-lg text-black dark:text-white">
                        {mode === 'folder' ? t('picker.title.folder') : t('picker.title.file')}
                    </Text>
                    <View style={{ width: 40 }} />
                </View>

                {mode === 'folder' && (
                    <View className="px-4 py-3 bg-gray-50 dark:bg-zinc-900 flex-row items-center justify-between border-b border-gray-200 dark:border-white/10">
                        <View className="flex-1 mr-2">
                            <Text numberOfLines={1} className="text-gray-500 dark:text-gray-400 text-xs uppercase mb-1">{t('picker.current')}</Text>
                            <Text numberOfLines={1} className="font-bold text-black dark:text-white">{currentPath || t('picker.root')}</Text>
                        </View>

                        <View className="flex-row gap-2">
                            {currentPath !== '' && (
                                <TouchableOpacity onPress={handleBack} className="bg-gray-200 dark:bg-zinc-800 px-3 py-2 rounded-lg">
                                    <ArrowLeft size={16} color={isDark ? "white" : "black"} />
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity
                                onPress={() => {
                                    onSelect(currentPath, currentPath || t('picker.root'));
                                    onClose();
                                }}
                                className="bg-black dark:bg-white px-4 py-2 rounded-lg"
                            >
                                <Text className="text-white dark:text-black font-bold text-xs">{t('picker.select_this')}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {loading ? (
                    <View className="flex-1 justify-center items-center">
                        <ActivityIndicator size="large" color={isDark ? "white" : "black"} />
                    </View>
                ) : (
                    <FlatList
                        key={`picker-${mode}-${numColumns}`} // 布局改变时重建列表
                        data={(() => {
                            // 补齐占位项以防止最后一项拉伸
                            const list = [...items];
                            const remainder = list.length % numColumns;
                            if (remainder !== 0) {
                                for (let i = 0; i < numColumns - remainder; i++) {
                                    list.push({ id: `placeholder-${i}`, isPlaceholder: true });
                                }
                            }
                            return list;
                        })()}
                        keyExtractor={(item) => item.id || item.path}
                        numColumns={numColumns}
                        contentContainerStyle={{ padding: 12, gap: 12 }}
                        columnWrapperStyle={{ gap: 12 }}
                        renderItem={({ item }) => {
                            if (item.isPlaceholder) {
                                return <View style={{ flex: 1 }} />;
                            }

                            return (
                                <View style={{ flex: 1 }}>
                                    {mode === 'folder' ? (
                                        <FolderCard
                                            name={item.name}
                                            path={item.path}
                                            onPress={() => handlePress(item)}
                                        />
                                    ) : (
                                        <View className="aspect-square">
                                            <MediaCard
                                                item={item}
                                                onPress={() => handlePress(item)}
                                            />
                                        </View>
                                    )}
                                </View>
                            );
                        }}
                    />
                )}
            </View>
        </Modal>
    );
};
