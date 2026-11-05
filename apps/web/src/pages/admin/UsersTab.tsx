/** 用户：列表、新建、编辑（角色、可访问目录、重置密码）与删除。 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { Role, User } from '@luvia/contracts';
import { call } from '@/lib/api';
import { q } from '@/lib/query';
import { useUser } from '@/stores/session';
import { FolderPicker } from './FolderPicker';
import { folderLabel, formatWhen } from './format';
import { callWith, useLibraryNames } from './hooks';
import { Chip, Confirm, Field, Modal, Pill, QueryState, Section, Seg, inputClass, useFieldId, useSave } from './ui';

const ROLE_OPTIONS = [{ value: 'user', label: '成员' }, { value: 'admin', label: '管理员' }] as const;

function UserDialog({ user, open, onOpenChange }: { user: User | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const me = useUser();
  const isSelf = !!user && user.id === me?.id;
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(user?.role ?? 'user');
  const [all, setAll] = useState(user ? user.allowedPaths === null : false);
  const [paths, setPaths] = useState<string[]>(user?.allowedPaths ?? []);
  const ids = { u: useFieldId('uu'), p: useFieldId('up') };

  const pwInvalid = user ? password.length > 0 && password.length < 8 : password.length < 8;
  const pathsInvalid = role === 'user' && !all && paths.length === 0;
  const allowedPaths = role === 'admin' || all ? null : paths;

  const save = useSave({
    fn: () => (user
      ? callWith('updateUser', { id: user.id }, { body: { role, allowedPaths, ...(password ? { password } : {}) } })
      : call('createUser', { body: { username: username.trim(), password, role, allowedPaths } })),
    success: (u) => (user ? `已保存「${u.username}」${password ? '，原有登录已全部退出' : ''}` : `已添加用户「${u.username}」`),
    invalidate: [['listUsers'], ['authState']],
    onSuccess: () => onOpenChange(false),
  });

  const canSubmit = (user || username.trim()) && !pwInvalid && !pathsInvalid && !save.isPending;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={user ? `编辑「${user.username}」` : '添加用户'}
      desc={user ? undefined : '每个人有自己的收藏、相册和外观设置。'}
      footer={<>
        <Chip onClick={() => onOpenChange(false)}>取消</Chip>
        <Chip variant="primary" disabled={!canSubmit} onClick={() => save.mutate(undefined)}>{save.isPending ? '正在保存…' : user ? '保存' : '添加用户'}</Chip>
      </>}
    >
      <form className="grid gap-3.5" onSubmit={(e) => { e.preventDefault(); if (canSubmit) save.mutate(undefined); }}>
        {!user && (
          <Field label="用户名" htmlFor={ids.u}>
            <input id={ids.u} className={inputClass} value={username} maxLength={64} autoComplete="off" onChange={(e) => setUsername(e.target.value)} />
          </Field>
        )}
        <Field
          label={user ? '重置密码' : '初始密码'}
          htmlFor={ids.p}
          hint={user ? '留空则不修改。重置后，这个用户在所有设备上的登录都会失效。' : '至少 8 位，对方登录后可以自己修改。'}
        >
          <input id={ids.p} type="password" autoComplete="new-password" className={inputClass} aria-invalid={(password.length > 0 && pwInvalid) || undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
          {password.length > 0 && pwInvalid && <small className="text-[12px] text-warn">还差 {8 - password.length} 位</small>}
        </Field>
        <div className="grid gap-1.5">
          <span className="text-[12.5px] font-semibold text-fg-2">角色</span>
          <Seg label="角色" value={role} onChange={setRole} options={ROLE_OPTIONS} disabled={isSelf} />
          <small className="text-[12px] text-muted">{isSelf ? '不能修改自己的角色。' : role === 'admin' ? '管理员可以进入控制台，能看到全部目录。' : '成员只能看到分配给他的目录。'}</small>
        </div>
        {role === 'user' && (
          <div className="grid gap-1.5">
            <span className="text-[12.5px] font-semibold text-fg-2">可访问目录</span>
            <label className="flex items-center gap-2 text-[13px] text-fg-2">
              <input type="checkbox" className="size-3.5 accent-[var(--accent)]" checked={all} onChange={(e) => setAll(e.target.checked)} />
              全部目录（包括以后新增的媒体库）
            </label>
            {!all && <FolderPicker multiple label="可访问目录" value={paths} onChange={setPaths} />}
            {pathsInvalid && <small className="text-[12px] text-warn">至少选择一个目录，或勾选“全部目录”。</small>}
            {!all && paths.length > 0 && <small className="text-[12px] text-muted">勾选的目录及其所有子目录可见。</small>}
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export default function UsersTab() {
  const users = useQuery(q('listUsers'));
  const me = useUser();
  const libNames = useLibraryNames();
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const del = useSave({
    fn: (u: User) => callWith('deleteUser', { id: u.id }),
    success: (_d, u) => `已删除用户「${u.username}」`,
    invalidate: [['listUsers']],
    onSuccess: () => setDeleting(null),
  });
  const pathsText = (u: User) => (u.allowedPaths === null ? '全部目录' : u.allowedPaths.length ? u.allowedPaths.map((p) => folderLabel(p, libNames)).join('，') : '没有可访问的目录');

  return (
    <Section
      title="用户"
      desc="每个人有自己的收藏、相册和外观设置。成员只能看到分配给他的目录。"
      action={<Chip onClick={() => setEditing('new')}><Plus />添加用户</Chip>}
    >
      <QueryState loading={users.isLoading} error={users.error} onRetry={() => void users.refetch()}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-muted">
              <th className="border-b border-line px-3 py-2.5 font-medium md:px-[18px]">用户名</th>
              <th className="border-b border-line px-3 py-2.5 font-medium md:px-[18px]">角色</th>
              <th className="border-b border-line px-3 py-2.5 font-medium max-md:hidden md:px-[18px]">可访问目录</th>
              <th className="border-b border-line px-3 py-2.5 font-medium max-md:hidden md:px-[18px]">最近登录</th>
              <th className="border-b border-line px-3 py-2.5 md:px-[18px]"><span className="sr-only">操作</span></th>
            </tr>
          </thead>
          <tbody>
            {users.data?.users.map((u) => {
              const self = u.id === me?.id;
              return (
                <tr key={u.id} className="[&:last-child>td]:border-b-0">
                  <td className="border-b border-line px-3 py-[11px] md:px-[18px]">
                    <b className="font-semibold">{u.username}</b>{self && <span className="ml-1.5 text-[12px] text-muted">（你）</span>}
                    <small className="block text-[12px] text-muted md:hidden">{pathsText(u)}</small>
                  </td>
                  <td className="border-b border-line px-3 py-[11px] md:px-[18px]"><Pill tone={u.role === 'admin' ? 'accent' : 'muted'}>{u.role === 'admin' ? '管理员' : '成员'}</Pill></td>
                  <td className="border-b border-line px-3 py-[11px] text-fg-2 max-md:hidden md:px-[18px]">{pathsText(u)}</td>
                  <td className="border-b border-line px-3 py-[11px] text-fg-2 max-md:hidden md:px-[18px]">{self ? '正在使用' : formatWhen(u.lastLoginAt) ?? '还没有登录过'}</td>
                  <td className="border-b border-line px-3 py-[11px] text-right md:px-[18px]">
                    <div className="flex justify-end gap-1.5">
                      <Chip size="sm" onClick={() => setEditing(u)} aria-label={`编辑「${u.username}」`}>编辑</Chip>
                      {!self && <Chip size="sm" variant="danger" onClick={() => setDeleting(u)} aria-label={`删除「${u.username}」`}>删除</Chip>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </QueryState>
      {editing && <UserDialog key={editing === 'new' ? 'new' : editing.id} user={editing === 'new' ? null : editing} open onOpenChange={(v) => { if (!v) setEditing(null); }} />}
      <Confirm
        open={!!deleting}
        onOpenChange={(v) => { if (!v) setDeleting(null); }}
        title={`删除用户「${deleting?.username ?? ''}」？`}
        desc="这个账号会立即退出登录，之后无法再登录。媒体文件本身不受影响。这一步不能撤回。"
        action="删除用户"
        pending={del.isPending}
        onConfirm={() => { if (deleting) del.mutate(deleting); }}
      />
    </Section>
  );
}
