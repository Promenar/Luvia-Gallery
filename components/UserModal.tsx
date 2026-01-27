import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icons } from './ui/Icon';
import { User } from '../types';
import { useLanguage } from '../contexts/LanguageContext';

interface UserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (formData: any) => void;
    type: 'add' | 'reset' | 'rename';
    targetUser: User | null;
    isAdmin: boolean;
    onBrowsePaths: () => void;
}

export const UserModal: React.FC<UserModalProps> = ({
    isOpen,
    onClose,
    onSubmit,
    type,
    targetUser,
    isAdmin,
    onBrowsePaths
}) => {
    const { t } = useLanguage();
    const [form, setForm] = useState({
        username: '',
        password: '',
        isAdmin: false,
        allowedPaths: ''
    });

    useEffect(() => {
        if (isOpen) {
            if (type === 'rename' && targetUser) {
                setForm({
                    username: targetUser.username,
                    password: '',
                    isAdmin: targetUser.isAdmin || false,
                    allowedPaths: (targetUser.allowedPaths || []).join('\n')
                });
            } else if (type === 'reset' && targetUser) {
                setForm({
                    username: targetUser.username,
                    password: '',
                    isAdmin: targetUser.isAdmin || false,
                    allowedPaths: ''
                });
            } else {
                setForm({ username: '', password: '', isAdmin: false, allowedPaths: '' });
            }
        }
    }, [isOpen, type, targetUser]);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.95, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.95, y: 20 }}
                    className="bg-surface-secondary backdrop-blur-3xl w-full max-w-md rounded-2xl shadow-2xl p-6 border border-transparent"
                    onClick={e => e.stopPropagation()}
                >
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                        <Icons.User size={24} className="text-primary-600" />
                        {type === 'add' ? t('add_user') : (type === 'rename' ? 'Edit User' : t('change_password'))}
                    </h3>
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            onSubmit(form);
                        }}
                        className="space-y-4"
                    >
                        {(type === 'add' || type === 'rename') && (
                            <div>
                                <label className="block text-sm font-medium mb-1">{t('username')}</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full px-4 py-2 rounded-xl input-premium outline-none focus:border-accent-500/30 transition-all font-mono text-sm"
                                    value={form.username}
                                    onChange={e => setForm({ ...form, username: e.target.value })}
                                />
                            </div>
                        )}
                        {type !== 'rename' && (
                            <div>
                                <label className="block text-sm font-medium mb-1">{t('password')}</label>
                                <input
                                    type="password"
                                    required
                                    className="w-full px-4 py-2 rounded-xl input-premium outline-none focus:border-accent-500/30 transition-all font-mono text-sm"
                                    value={form.password}
                                    onChange={e => setForm({ ...form, password: e.target.value })}
                                />
                            </div>
                        )}
                        {type === 'add' && isAdmin && (
                            <div className="flex items-center gap-2">
                                <input
                                    type="checkbox"
                                    id="isAdmin"
                                    checked={form.isAdmin}
                                    onChange={e => setForm({ ...form, isAdmin: e.target.checked })}
                                    className="w-4 h-4 rounded text-primary-600 focus:ring-primary-500"
                                />
                                <label htmlFor="isAdmin" className="text-sm font-medium">{t('is_admin')}</label>
                            </div>
                        )}

                        {(type === 'add' || type === 'rename') && isAdmin && (
                            <div>
                                <div className="flex justify-between items-center mb-1">
                                    <label className="block text-sm font-medium">Allowed Library Paths</label>
                                    <button
                                        type="button"
                                        onClick={onBrowsePaths}
                                        className="text-xs text-primary-600 hover:underline flex items-center gap-1"
                                    >
                                        <Icons.FolderOpen size={12} /> {t('browse')}
                                    </button>
                                </div>
                                <p className="text-xs text-gray-500 mb-2">Separate multiple paths with new lines. Leave empty to deny all access.</p>
                                <textarea
                                    className="w-full px-4 py-2 rounded-xl input-premium outline-none focus:border-accent-500/30 min-h-[100px] text-sm font-mono transition-all"
                                    placeholder="/data/media/user1&#10;/data/media/shared"
                                    value={form.allowedPaths}
                                    onChange={e => setForm({ ...form, allowedPaths: e.target.value })}
                                />
                            </div>
                        )}
                        <div className="flex justify-end gap-3 pt-4">
                            <button type="button" onClick={onClose} className="px-4 py-2 text-text-tertiary hover:bg-white/5 rounded-lg transition-colors">{t('cancel')}</button>
                            <button type="submit" className="px-6 py-2 bg-accent-500 hover:bg-accent-600 text-black font-bold rounded-lg transition-all hover:scale-105 active:scale-95 shadow-lg shadow-accent-500/20">{t('save_changes') || t('save')}</button>
                        </div>
                    </form>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
};
