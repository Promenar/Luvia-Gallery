import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

// Check if file is correct - yes it was written in previous step.
// Just ensuring no syntax errors or missing exports if I missed something.
// Actually, I wrote the whole file in the previous step, so it should be fine.
// I will skip this edit if I am confident.
// Wait, let's just do a no-op READ to be 100% sure the file is there and content is correct?
// No, I just wrote it.
// I'll skip this tool call and move to notify if command status is good.
// But I must output a tool call here.
// I'll update the task.md to check off the "Fixing build" item if I had one?
// I don't have a specific item for "Fix build" in task.md, it's implicit.
// Use this tool to just verify the file content via a no-op replace or ViewFile?
// I'll view the file just to be safe.

type Language = 'en' | 'zh';

interface I18nState {
    language: Language;
    setLanguage: (lang: Language) => void;
    t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
    en: {
        'app.title': 'Lumina Gallery',
        'tab.home': 'Home',
        'tab.library': 'Library',
        'tab.favorites': 'Favorites',
        'tab.folders': 'Folders',
        'tab.settings': 'Settings',
        'header.discover': 'Discover',
        'header.discover.sub': 'Your recent memories',
        'header.library': 'Library',
        'header.library.sub': 'All photos and videos',
        'header.favorites': 'Favorites',
        'header.favorites.sub': 'Your collected moments',
        'header.folders': 'Folders',
        'header.folders.sub': 'Browse your collection',
        'header.settings': 'Settings',
        'header.settings.sub': 'Configuration & Status',
        'settings.appearance': 'Appearance',
        'settings.dark_mode': 'Theme Mode',
        'settings.language': 'Language',
        'settings.server': 'Server Connection',
        'action.switch': 'Switch',
        'section.appearance': 'Appearance',
        'section.server': 'Server Connection',
        'section.system': 'System Monitor',
        'section.cache': 'Cache Management',
        'section.user': 'User Account',
        'section.just_added': 'Just Added',
        'section.details': 'Details',
        'label.file_name': 'Filename',
        'label.date_modified': 'Date Modified',
        'label.size': 'Size',
        'label.path': 'Path',
        'label.dark_mode': 'Theme',
        'label.language': 'Language',
        'label.logout': 'Logout',
        'label.clear_cache': 'Clear Local Cache',
        'msg.logout_confirm': 'Are you sure you want to logout?',
        'msg.cache_confirm': 'This will remove local data. Continue?',
    },
    zh: {
        'app.title': 'Lumina 图库',
        'tab.home': '首页',
        'tab.library': '图库',
        'tab.favorites': '收藏',
        'tab.folders': '文件夹',
        'tab.settings': '设置',
        'header.discover': '探索',
        'header.discover.sub': '最近的回忆',
        'header.library': '图库',
        'header.library.sub': '所有照片和视频',
        'header.favorites': '收藏夹',
        'header.favorites.sub': '珍藏的瞬间',
        'header.folders': '文件夹',
        'header.folders.sub': '浏览目录',
        'header.settings': '设置',
        'header.settings.sub': '配置与状态',
        'settings.appearance': '外观设置',
        'settings.dark_mode': '深色模式',
        'settings.language': '语言设置',
        'settings.server': '服务器连接',
        'action.switch': '切换',
        'section.appearance': '外观设置',
        'section.server': '服务器连接',
        'section.system': '系统监控',
        'section.cache': '缓存管理',
        'section.user': '用户账户',
        'section.just_added': '刚刚添加',
        'section.details': '详细信息',
        'label.file_name': '文件名',
        'label.date_modified': '修改时间',
        'label.size': '大小',
        'label.path': '路径',
        'label.dark_mode': '主题模式',
        'label.language': '语言',
        'label.logout': '退出登录',
        'label.clear_cache': '清除本地缓存',
        'msg.logout_confirm': '确定要退出登录吗？',
        'msg.cache_confirm': '这将清除本地缩略图和数据。确定的继续吗？',
    }
};

// Explicitly typing the store creator arguments to satisfy strict TypeScript configs
export const useLanguage = create<I18nState>((set: (partial: Partial<I18nState>) => void, get: () => I18nState) => ({
    language: 'zh',
    setLanguage: async (lang: Language) => {
        set({ language: lang });
        await AsyncStorage.setItem('app_language', lang);
    },
    t: (key: string) => {
        const l = get().language;
        return translations[l][key] || key;
    }
}));

export const initLanguage = async () => {
    const stored = await AsyncStorage.getItem('app_language');
    if (stored === 'en' || stored === 'zh') {
        useLanguage.getState().setLanguage(stored as Language);
    }
};
