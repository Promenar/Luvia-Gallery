import React from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Heart, Trash2, X, FolderHeart } from 'lucide-react-native';
import { MediaItem } from '../types';
import { useLanguage } from '../utils/i18n';

interface ActionMenuProps {
    visible: boolean;
    onClose: () => void;
    item: MediaItem | { type: 'folder', name: string, path: string, isFavorite?: boolean } | null;
    onToggleFavorite: () => void;
    onDelete: () => void;
}

export const ActionMenu: React.FC<ActionMenuProps> = ({ visible, onClose, item, onToggleFavorite, onDelete }) => {
    const { t } = useLanguage();
    if (!item) return null;

    const isFolder = 'type' in item && item.type === 'folder';
    const name = isFolder ? (item as any).name : (item as MediaItem).name;
    const isFavorite = isFolder ? (item as any).isFavorite : (item as MediaItem).isFavorite;

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
        >
            <Pressable
                className="flex-1 items-center justify-end pb-12"
                onPress={onClose}
            >
                <View className="bg-white dark:bg-zinc-900 w-[90%] rounded-3xl overflow-hidden shadow-2xl border border-gray-100 dark:border-zinc-800">
                    {/* Header */}
                    <View className="p-5 border-b border-gray-100 dark:border-zinc-800 flex-row justify-between items-center">
                        <View className="flex-1 mr-4">
                            <Text numberOfLines={1} className="text-gray-900 dark:text-white font-bold text-lg">
                                {name}
                            </Text>
                            <Text className="text-gray-400 text-xs mt-0.5 uppercase tracking-widest font-medium">
                                {t(isFolder ? 'menu.folder_actions' : 'menu.file_actions')}
                            </Text>
                        </View>
                        <TouchableOpacity onPress={onClose} className="bg-gray-100 dark:bg-zinc-800 p-2 rounded-full">
                            <X size={18} color="#94a3b8" />
                        </TouchableOpacity>
                    </View>

                    {/* Actions */}
                    <View className="p-2">
                        <TouchableOpacity
                            onPress={() => {
                                onToggleFavorite();
                                onClose();
                            }}
                            className="flex-row items-center p-4 rounded-2xl active:bg-gray-50 dark:active:bg-zinc-800"
                        >
                            <View className="bg-pink-50 dark:bg-pink-900/20 p-2.5 rounded-xl mr-4">
                                {isFolder ? (
                                    <FolderHeart size={22} color="#ec4899" />
                                ) : (
                                    <Heart size={22} color="#ec4899" fill={isFavorite ? "#ec4899" : "none"} />
                                )}
                            </View>
                            <Text className="text-gray-800 dark:text-gray-100 font-semibold text-base">
                                {t(isFavorite ? 'menu.remove_favorite' : 'menu.add_favorite')}
                            </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={() => {
                                onDelete();
                            }}
                            className="flex-row items-center p-4 rounded-2xl active:bg-red-50 dark:active:bg-red-900/10"
                        >
                            <View className="bg-red-50 dark:bg-red-900/20 p-2.5 rounded-xl mr-4">
                                <Trash2 size={22} color="#ef4444" />
                            </View>
                            <Text className="text-red-500 font-semibold text-base">{t('menu.delete_permanent')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Pressable>
        </Modal>
    );
};
