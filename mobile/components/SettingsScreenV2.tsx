import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Switch, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
    ChevronRight,
    ArrowLeft,
    Globe,
    Zap,
    Database,
    User,
    LogOut,
    Plus,
    X,
    AlertTriangle,
    Layout
} from 'lucide-react-native';
import Animated, {
    FadeIn
} from 'react-native-reanimated';
import { ItemPicker } from './ItemPicker';
import { useLanguage } from '../utils/i18n';
import { fetchStats, fetchSystemMaintenance, fetchUsers, adminFetch, getToken } from '../utils/api';
import { useToast } from '../utils/ToastContext';

interface SettingsScreenV2Props {
    onBack?: () => void;
    onLogout?: () => void;
    username?: string;
    isAdmin?: boolean;
}

const SettingsScreenV2 = ({ onBack, onLogout: onAppLogout, username: currentUsername, isAdmin: currentIsAdmin }: SettingsScreenV2Props) => {
    const insets = useSafeAreaInsets();
    const { t, language, setLanguage } = useLanguage();
    const { showToast } = useToast();
    const isDark = true; // For now

    const [activeTab, setActiveTab] = useState<'app' | 'server'>('app');
    const [serverConfig, setServerConfig] = useState<any>(null);
    const [stats, setStats] = useState<any>(null);
    const [users, setUsers] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const [isPickerOpen, setIsPickerOpen] = useState({ visible: false, mode: 'folder' as 'folder' | 'file' });
    const [showUserModal, setShowUserModal] = useState(false);
    const [userForm, setUserForm] = useState({
        username: '',
        password: '',
        isAdmin: false,
        allowedPaths: [] as string[],
        isEditing: false,
        originalUsername: ''
    });

    const [confirmDialog, setConfirmDialog] = useState<{
        visible: boolean;
        title: string;
        message: string;
        onConfirm?: () => void;
        isDestructive?: boolean;
    }>({ visible: false, title: '', message: '' });

    const triggerHaptic = useCallback((style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
        setTimeout(() => {
            Haptics.impactAsync(style).catch(() => { });
        }, 10);
    }, []);

    const fetchData = useCallback(async () => {
        setIsLoading(true);
        try {
            const [s, m, u, c] = await Promise.all([
                fetchStats(),
                fetchSystemMaintenance(),
                fetchUsers(),
                adminFetch('/api/config')
            ]);
            setStats(s);
            setUsers(u);
            setServerConfig(c);
        } catch (e: any) {
            showToast(e.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        if (activeTab === 'server') {
            fetchData();
        }
    }, [activeTab, fetchData]);

    const handleSaveUser = async () => {
        if (!userForm.username || (!userForm.isEditing && !userForm.password)) return;
        try {
            const payload = userForm.isEditing ? {
                newUsername: userForm.username,
                newPassword: userForm.password || undefined,
                isAdmin: userForm.isAdmin,
                allowedPaths: userForm.allowedPaths
            } : {
                username: userForm.username,
                password: userForm.password,
                isAdmin: userForm.isAdmin,
                allowedPaths: userForm.allowedPaths
            };

            const endpoint = userForm.isEditing
                ? `/api/users/${userForm.originalUsername}`
                : '/api/users';

            await adminFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });
            setShowUserModal(false);
            fetchData();
            showToast(t('common.success'), 'success');
        } catch (e: any) {
            showToast(e.message, 'error');
        }
    };

    const handleUpdateConcurrency = async (delta: number) => {
        if (!serverConfig) return;
        const current = serverConfig.threadCount || 2;
        const newValue = Math.max(1, Math.min(64, current + delta));
        if (newValue === current) return;

        const performUpdate = async (val: number) => {
            triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
            try {
                const newConfig = { ...serverConfig, threadCount: val };
                await adminFetch('/api/config', {
                    method: 'POST',
                    body: JSON.stringify(newConfig)
                });
                setServerConfig(newConfig);
                showToast(t('admin.concurrency_updated', { count: val }), 'success');
            } catch (e: any) {
                showToast(e.message, 'error');
            }
        };

        if (newValue > 16 && newValue > current) {
            setConfirmDialog({
                visible: true,
                title: t('common.warning'),
                message: t('admin.concurrency_warning', { count: 16 }),
                isDestructive: true,
                onConfirm: () => performUpdate(newValue)
            });
        } else {
            performUpdate(newValue);
        }
    };

    const renderConfirmDialog = useMemo(() => {
        if (!confirmDialog.visible) return null;
        return (
            <Modal visible={confirmDialog.visible} transparent animationType="fade" onRequestClose={() => setConfirmDialog({ ...confirmDialog, visible: false })}>
                <View className="flex-1 bg-black/60 items-center justify-center p-6">
                    <Animated.View entering={FadeIn.duration(200)} className="bg-white dark:bg-zinc-900 w-full max-w-[320px] rounded-[32px] p-6 shadow-2xl overflow-hidden border border-gray-100 dark:border-zinc-800">
                        <View className="items-center mb-4">
                            <View className={`w-16 h-16 rounded-full ${confirmDialog.isDestructive ? 'bg-red-50 dark:bg-red-900/20' : 'bg-indigo-50 dark:bg-indigo-900/20'} items-center justify-center mb-4`}>
                                <AlertTriangle size={32} color={confirmDialog.isDestructive ? '#ef4444' : '#6366f1'} />
                            </View>
                            <Text className="text-xl font-black text-gray-900 dark:text-white text-center">{confirmDialog.title}</Text>
                            <Text className="text-sm text-gray-500 dark:text-gray-400 text-center mt-2 leading-5">
                                {confirmDialog.message}
                            </Text>
                        </View>
                        <View className="gap-3 mt-2">
                            <TouchableOpacity
                                onPress={() => {
                                    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                                    setConfirmDialog({ ...confirmDialog, visible: false });
                                    setTimeout(() => confirmDialog.onConfirm?.(), 100);
                                }}
                                className={`py-4 rounded-2xl items-center ${confirmDialog.isDestructive ? 'bg-red-500' : 'bg-black dark:bg-white'}`}
                            >
                                <Text className={`font-black uppercase tracking-widest ${confirmDialog.isDestructive ? 'text-white' : 'text-white dark:text-black'}`}>
                                    {t('dialog.confirm')}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={() => setConfirmDialog({ ...confirmDialog, visible: false })}
                                className="py-4 rounded-2xl items-center bg-gray-100 dark:bg-zinc-800"
                            >
                                <Text className="text-gray-600 dark:text-gray-400 font-bold uppercase tracking-widest">{t('dialog.cancel')}</Text>
                            </TouchableOpacity>
                        </View>
                    </Animated.View>
                </View>
            </Modal>
        );
    }, [confirmDialog, t, triggerHaptic]);

    const OptionRow = ({ icon: Icon, title, subtitle, right, onPress, red }: any) => (
        <TouchableOpacity
            onPress={onPress}
            disabled={!onPress}
            className={`flex-row items-center justify-between p-4 bg-gray-50 dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 mb-2 ${onPress ? 'active:opacity-70' : ''}`}
        >
            <View className="flex-row items-center gap-3 flex-1">
                <View className={`w-10 h-10 rounded-full ${red ? 'bg-red-50 dark:bg-red-900/20' : 'bg-white dark:bg-zinc-800'} items-center justify-center border border-gray-100 dark:border-zinc-700`}>
                    <Icon size={18} color={red ? '#ef4444' : (isDark ? '#fff' : '#000')} />
                </View>
                <View className="flex-1">
                    <Text className={`font-bold ${red ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>
                        {title}
                    </Text>
                    {subtitle && (
                        <Text className="text-xs text-gray-500 dark:text-gray-400">
                            {subtitle}
                        </Text>
                    )}
                </View>
            </View>
            {right}
        </TouchableOpacity>
    );

    const SectionHeader = ({ title }: { title: string }) => (
        <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 ml-1">
            {title}
        </Text>
    );

    return (
        <View className="flex-1 bg-white dark:bg-black">
            <View className="p-6" style={{ paddingTop: insets.top }}>
                <View className="flex-row items-center justify-between mb-8">
                    <TouchableOpacity onPress={onBack} className="flex-row items-center gap-2">
                        <ArrowLeft size={24} color={isDark ? "#fff" : "#000"} />
                        <Text className="text-2xl font-black text-gray-900 dark:text-white">{t('header.settings')}</Text>
                    </TouchableOpacity>
                </View>

                <View className="flex-row bg-gray-100 dark:bg-zinc-900 p-1.5 rounded-2xl mb-8">
                    <TouchableOpacity
                        onPress={() => setActiveTab('app')}
                        className={`flex-1 py-3 rounded-xl items-center ${activeTab === 'app' ? 'bg-white dark:bg-zinc-800 shadow-sm' : ''}`}
                    >
                        <Text className={`font-bold ${activeTab === 'app' ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>{t('settings.local')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => setActiveTab('server')}
                        className={`flex-1 py-3 rounded-xl items-center ${activeTab === 'server' ? 'bg-white dark:bg-zinc-800 shadow-sm' : ''}`}
                    >
                        <Text className={`font-bold ${activeTab === 'server' ? 'text-gray-900 dark:text-white' : 'text-gray-400'}`}>{t('settings.remote')}</Text>
                    </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                    {activeTab === 'app' ? (
                        <View className="gap-8 pb-20">
                            <View>
                                <SectionHeader title={t('section.appearance')} />
                                <OptionRow
                                    icon={Layout}
                                    title={t('settings.dark_mode')}
                                    right={<ChevronRight size={18} color="#9ca3af" />}
                                />
                                <OptionRow
                                    icon={Globe}
                                    title={t('settings.language')}
                                    right={<Text className="text-indigo-500 font-bold">{language === 'zh' ? '中文' : 'English'}</Text>}
                                    onPress={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
                                />
                            </View>

                            <View>
                                <SectionHeader title={t('section.user')} />
                                <View className="bg-gray-50 dark:bg-zinc-900 p-6 rounded-[32px] border border-gray-100 dark:border-zinc-800 items-center">
                                    <View className="w-20 h-20 rounded-full bg-indigo-50 dark:bg-indigo-900/20 items-center justify-center mb-4">
                                        <User size={40} color="#6366f1" />
                                    </View>
                                    <Text className="text-xl font-black text-gray-900 dark:text-white">{currentUsername || t('guest')}</Text>
                                    <Text className="text-gray-400 text-xs uppercase tracking-widest mt-1">{currentIsAdmin ? t('admin.admin_role') : t('admin.user_role')}</Text>

                                    <TouchableOpacity
                                        onPress={onAppLogout}
                                        className="mt-6 flex-row items-center gap-2 bg-red-50 dark:bg-red-900/20 px-6 py-3 rounded-full"
                                    >
                                        <LogOut size={18} color="#ef4444" />
                                        <Text className="text-red-500 font-bold">{t('label.logout')}</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        </View>
                    ) : (
                        <View className="gap-8 pb-20">
                            {isLoading && !serverConfig ? (
                                <ActivityIndicator size="large" color="#6366f1" className="my-10" />
                            ) : (
                                <>
                                    <View>
                                        <SectionHeader title={t('section.system')} />
                                        <View className="flex-row gap-4 mb-4">
                                            <View className="flex-1 bg-gray-50 dark:bg-zinc-900 p-4 rounded-2xl border border-gray-100 dark:border-zinc-800">
                                                <Database size={20} color="#6366f1" />
                                                <Text className="text-2xl font-black text-gray-900 dark:text-white mt-2">{stats?.mediaStats?.totalFiles || 0}</Text>
                                                <Text className="text-xs text-gray-400 font-bold uppercase mt-1">{t('stats.total_media')}</Text>
                                            </View>
                                            <View className="flex-1 bg-gray-50 dark:bg-zinc-900 p-4 rounded-2xl border border-gray-100 dark:border-zinc-800">
                                                <Zap size={20} color="#f59e0b" />
                                                <Text className="text-2xl font-black text-gray-900 dark:text-white mt-2">{serverConfig?.threadCount || 2}</Text>
                                                <Text className="text-xs text-gray-400 font-bold uppercase mt-1">Concurrency</Text>
                                            </View>
                                        </View>
                                    </View>

                                    <View>
                                        <SectionHeader title={t('admin.server_maintenance')} />
                                        <View className="bg-gray-50 dark:bg-zinc-900 rounded-2xl border border-gray-100 dark:border-zinc-800 mb-2 p-4">
                                            <View className="flex-row items-center justify-between gap-4">
                                                <View className="flex-row items-center gap-3 flex-1">
                                                    <View className="w-10 h-10 rounded-full bg-white dark:bg-zinc-800 items-center justify-center border border-gray-100 dark:border-zinc-700">
                                                        <Zap size={18} color={isDark ? '#fff' : '#000'} />
                                                    </View>
                                                    <Text className="font-bold text-gray-900 dark:text-white flex-1">{t('admin.thumb_concurrency')}</Text>
                                                </View>
                                                <View className="flex-row items-center gap-3 bg-gray-100 dark:bg-zinc-800 p-1 rounded-xl">
                                                    <TouchableOpacity
                                                        onPress={() => handleUpdateConcurrency(-1)}
                                                        className="w-8 h-8 items-center justify-center rounded-lg bg-white dark:bg-zinc-700 shadow-sm"
                                                    >
                                                        <X size={14} color={isDark ? "#fff" : "#000"} />
                                                    </TouchableOpacity>
                                                    <View className="w-6 items-center">
                                                        <Text className="text-sm font-black text-gray-900 dark:text-white">
                                                            {serverConfig?.threadCount || 2}
                                                        </Text>
                                                    </View>
                                                    <TouchableOpacity
                                                        onPress={() => handleUpdateConcurrency(1)}
                                                        className="w-8 h-8 items-center justify-center rounded-lg bg-white dark:bg-zinc-700 shadow-sm"
                                                    >
                                                        <Plus size={14} color={isDark ? "#fff" : "#000"} />
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                            <View className="mt-3 pl-[52px]">
                                                <Text className="text-[11px] text-gray-500 dark:text-zinc-500 leading-4">
                                                    {t('admin.thumb_concurrency_desc')}
                                                </Text>
                                            </View>
                                        </View>
                                    </View>

                                    <View>
                                        <View className="flex-row items-center justify-between mb-4">
                                            <SectionHeader title={t('admin.users')} />
                                            <TouchableOpacity
                                                onPress={() => {
                                                    setUserForm({ username: '', password: '', isAdmin: false, allowedPaths: [], isEditing: false, originalUsername: '' });
                                                    setShowUserModal(true);
                                                }}
                                                className="bg-indigo-600 px-4 py-2 rounded-full"
                                            >
                                                <Text className="text-white text-xs font-bold">{t('admin.add_user')}</Text>
                                            </TouchableOpacity>
                                        </View>
                                        {users.map(u => (
                                            <OptionRow
                                                key={u.username}
                                                icon={User}
                                                title={u.username}
                                                subtitle={u.isAdmin ? t('admin.admin_role') : t('admin.user_role')}
                                                onPress={() => {
                                                    setUserForm({ ...u, isEditing: true, originalUsername: u.username, password: '' });
                                                    setShowUserModal(true);
                                                }}
                                            />
                                        ))}
                                    </View>
                                </>
                            )}
                        </View>
                    )}
                </ScrollView>
            </View>

            <Modal visible={showUserModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowUserModal(false)}>
                <View className="flex-1 bg-white dark:bg-black p-6" style={{ paddingTop: insets.top }}>
                    <View className="flex-row items-center justify-between mb-8">
                        <Text className="text-2xl font-black text-gray-900 dark:text-white">{userForm.isEditing ? t('admin.edit_user') : t('admin.add_user')}</Text>
                        <TouchableOpacity onPress={() => setShowUserModal(false)} className="p-2 bg-gray-100 dark:bg-zinc-800 rounded-full">
                            <X size={20} color={isDark ? "#fff" : "#000"} />
                        </TouchableOpacity>
                    </View>

                    <ScrollView>
                        <View className="gap-6">
                            <View>
                                <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">{t('admin.username')}</Text>
                                <TextInput
                                    className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-2xl border border-gray-100 dark:border-zinc-800 text-gray-900 dark:text-white"
                                    value={userForm.username}
                                    onChangeText={v => setUserForm({ ...userForm, username: v })}
                                />
                            </View>
                            <View>
                                <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 ml-1">{t('admin.password')}</Text>
                                <TextInput
                                    className="bg-gray-50 dark:bg-zinc-900 p-4 rounded-2xl border border-gray-100 dark:border-zinc-800 text-gray-900 dark:text-white"
                                    value={userForm.password}
                                    onChangeText={v => setUserForm({ ...userForm, password: v })}
                                    secureTextEntry
                                    placeholder={userForm.isEditing ? t('admin.pwd_placeholder') : ''}
                                />
                            </View>

                            <View>
                                <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4 ml-1">{t('admin.allowed_paths')}</Text>
                                <View className="gap-2 mb-4">
                                    {userForm.allowedPaths.map((p, idx) => (
                                        <View key={idx} className="flex-row items-center justify-between bg-gray-50 dark:bg-zinc-900 p-3 rounded-xl">
                                            <Text className="text-gray-600 dark:text-gray-400">{p}</Text>
                                            <TouchableOpacity onPress={() => setUserForm({ ...userForm, allowedPaths: userForm.allowedPaths.filter((_, i) => i !== idx) })}>
                                                <X size={14} color="#ef4444" />
                                            </TouchableOpacity>
                                        </View>
                                    ))}
                                </View>
                                <TouchableOpacity
                                    onPress={() => setIsPickerOpen({ visible: true, mode: 'folder' })}
                                    className="flex-row items-center justify-center p-4 bg-indigo-50 dark:bg-indigo-900/10 rounded-2xl border border-dashed border-indigo-200"
                                >
                                    <Plus size={20} color="#6366f1" />
                                    <Text className="ml-2 font-bold text-indigo-600">{t('admin.add_path')}</Text>
                                </TouchableOpacity>
                            </View>

                            <View className="flex-row items-center justify-between p-4 bg-gray-50 dark:bg-zinc-900 rounded-2xl">
                                <Text className="font-bold text-gray-900 dark:text-white">{t('admin.admin_role')}</Text>
                                <Switch value={userForm.isAdmin} onValueChange={v => setUserForm({ ...userForm, isAdmin: v })} />
                            </View>

                            <TouchableOpacity
                                onPress={handleSaveUser}
                                className="bg-black dark:bg-white py-4 rounded-2xl items-center mt-4"
                            >
                                <Text className="text-white dark:text-black font-black uppercase tracking-widest">{t('admin.save')}</Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                </View>
            </Modal>

            <ItemPicker
                visible={isPickerOpen.visible}
                mode={isPickerOpen.mode}
                onClose={() => setIsPickerOpen({ ...isPickerOpen, visible: false })}
                onSelect={(p) => {
                    if (!userForm.allowedPaths.includes(p)) {
                        setUserForm({ ...userForm, allowedPaths: [...userForm.allowedPaths, p] });
                    }
                    setIsPickerOpen({ ...isPickerOpen, visible: false });
                }}
            />

            {renderConfirmDialog}
        </View>
    );
};

export default SettingsScreenV2;
