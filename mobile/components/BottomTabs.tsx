import React from 'react';
import { View, TouchableOpacity, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Image as ImageIcon, Folder, Heart, Settings } from 'lucide-react-native';
import { useTheme } from '../utils/ThemeContext';
import { useLanguage } from '../utils/i18n';
import * as Haptics from 'expo-haptics';

export type Tab = 'home' | 'library' | 'folders' | 'favorites' | 'settings';

interface BottomTabsProps {
    activeTab: Tab;
    onTabChange: (tab: Tab) => void;
}

export const BottomTabs = ({ activeTab, onTabChange }: BottomTabsProps) => {
    const insets = useSafeAreaInsets();
    const { t } = useLanguage();

    const { isDark } = useTheme();

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
            case 'home': return t('tab.home');
            case 'library': return t('tab.library');
            case 'folders': return t('tab.folders');
            case 'favorites': return t('tab.favorites');
            case 'settings': return t('tab.settings');
        }
    };

    return (
        <View
            className="flex-row justify-around items-center bg-white dark:bg-black border-t border-gray-100 dark:border-white/10 pt-2 pb-2"
            style={{ paddingBottom: insets.bottom > 0 ? insets.bottom : 8 }}
        >
            {(['home', 'library', 'folders', 'favorites', 'settings'] as Tab[]).map((tab) => {
                const isActive = activeTab === tab;
                // Light mode: Active=Black, Inactive=Gray
                // Dark mode: Active=White, Inactive=Gray
                const color = isActive
                    ? (isDark ? '#fff' : '#000')
                    : '#9ca3af';

                return (
                    <TouchableOpacity
                        key={tab}
                        onPress={() => {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                            onTabChange(tab);
                        }}
                        className="items-center justify-center w-16"
                    >
                        {getIcon(tab, color)}
                        <Text
                            className={`text-[10px] mt-1 font-medium ${isActive ? 'text-black dark:text-white' : 'text-gray-400'}`}
                        >
                            {getLabel(tab)}
                        </Text>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
};
