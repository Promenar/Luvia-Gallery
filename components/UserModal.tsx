import React, { useState, useEffect } from 'react';
import { Icons } from './ui/Icon';
import { User } from '../types';
import { useLanguage } from '../contexts/LanguageContext';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './kit/dialog';
import { Button } from './kit/button';
import { Input } from './kit/input';
import { Label } from './kit/label';
import { Switch } from './kit/switch';

interface UserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (formData: any) => void;
    type: 'add' | 'reset' | 'rename';
    targetUser: User | null;
    isAdmin: boolean;
    /** 打开目录选择器；选中的路径通过 onPick 回填到本弹窗的表单 */
    onBrowsePaths: (onPick: (path: string) => void) => void;
}

/** 将新路径追加到多行路径文本末尾，已存在时不重复添加。 */
export const appendAllowedPath = (current: string, path: string): string => {
    const lines = current.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.includes(path)) return lines.join('\n');
    return [...lines, path].join('\n');
};

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

    const title = type === 'add' ? t('add_user') : (type === 'rename' ? t('edit_user') : t('change_password'));

    return (
        <Dialog open={isOpen} onOpenChange={open => { if (!open) onClose(); }}>
            <DialogContent className="sm:max-w-md">
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        onSubmit(form);
                    }}
                    className="grid gap-4"
                >
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-base font-semibold">
                            <Icons.User size={18} className="text-primary" />
                            {title}
                        </DialogTitle>
                        {targetUser && type !== 'add' && (
                            <DialogDescription>{targetUser.username}</DialogDescription>
                        )}
                    </DialogHeader>

                    {(type === 'add' || type === 'rename') && (
                        <div className="grid gap-2">
                            <Label htmlFor="user-form-username">{t('username')}</Label>
                            <Input
                                id="user-form-username"
                                required
                                autoComplete="off"
                                className="font-mono"
                                value={form.username}
                                onChange={e => setForm({ ...form, username: e.target.value })}
                            />
                        </div>
                    )}
                    {type !== 'rename' && (
                        <div className="grid gap-2">
                            <Label htmlFor="user-form-password">{t('password')}</Label>
                            <Input
                                id="user-form-password"
                                type="password"
                                required
                                autoComplete="new-password"
                                value={form.password}
                                onChange={e => setForm({ ...form, password: e.target.value })}
                            />
                        </div>
                    )}
                    {type === 'add' && isAdmin && (
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                            <Label htmlFor="user-form-admin">{t('is_admin')}</Label>
                            <Switch
                                id="user-form-admin"
                                checked={form.isAdmin}
                                onCheckedChange={checked => setForm({ ...form, isAdmin: checked })}
                            />
                        </div>
                    )}

                    {(type === 'add' || type === 'rename') && isAdmin && (
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between">
                                <Label htmlFor="user-form-paths">{t('allowed_paths')}</Label>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onBrowsePaths(path => setForm(prev => ({ ...prev, allowedPaths: appendAllowedPath(prev.allowedPaths, path) })))}
                                >
                                    <Icons.FolderOpen /> {t('browse')}
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground">{t('allowed_paths_hint')}</p>
                            <textarea
                                id="user-form-paths"
                                className="min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                                placeholder={'/data/media/user1\n/data/media/shared'}
                                value={form.allowedPaths}
                                onChange={e => setForm({ ...form, allowedPaths: e.target.value })}
                            />
                        </div>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>{t('cancel')}</Button>
                        <Button type="submit">{t('save_changes') || t('save')}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};
