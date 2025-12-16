import React from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Image as ImageIcon, Folder, Heart, Settings } from 'lucide-react-native';

export type Tab = 'home' | 'library' | 'folders' | 'favorites' | 'settings';

interface BottomTabsProps {
    activeTab: Tab;
    onTabChange: (tab: Tab) => void;
}

export const BottomTabs = ({ activeTab, onTabChange }: BottomTabsProps) => {
    const insets = useSafeAreaInsets();

    const getIcon = (tab: Tab, color: string) => {
        switch (tab) {
            case 'home': return <Home color={color} size={24} />;
            case 'library': return <ImageIcon color={color} size={24} />;
            case 'folders': return <Folder color={color} size={24} />;
            case 'favorites': return <Heart color={color} size={24} />;
            case 'settings': return <Settings color={color} size={24} />;
        }
    };

    const getLabel = (tab: Tab) => {
        switch (tab) {
            case 'home': return 'Discover';
            case 'library': return 'Library';
            case 'folders': return 'Folders';
            case 'favorites': return 'Favorites';
            case 'settings': return 'Settings';
        }
    };

    return (
        <View
            className="flex-row justify-around items-center bg-white border-t border-gray-100 pt-2 pb-2"
            style={{ paddingBottom: insets.bottom > 0 ? insets.bottom : 8 }}
        >
            {(['home', 'library', 'folders', 'favorites', 'settings'] as Tab[]).map((tab) => {
                const isActive = activeTab === tab;
                const color = isActive ? '#000' : '#9ca3af';

                return (
                    <TouchableOpacity
                        key={tab}
                        onPress={() => onTabChange(tab)}
                        className="items-center justify-center w-16"
                    >
                        {getIcon(tab, color)}
                        <Text
                            className={`text-[10px] mt-1 font-medium ${isActive ? 'text-black' : 'text-gray-400'}`}
                        >
                            {getLabel(tab)}
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
};
