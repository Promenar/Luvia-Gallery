import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { call, ApiError } from '@/lib/api';
import { queryClient } from '@/lib/query';
import { authStateQuery, useAuthState } from '@/stores/session';
import { Button } from '@/components/kit/button';
import { Input } from '@/components/kit/input';
import { Label } from '@/components/kit/label';

function AuthFrame({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  const site = useAuthState().data?.siteName ?? 'Luvia';
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-4">
      <div className="w-full max-w-[380px]">
        <div aria-hidden className="relative mb-8 size-11 rounded-[14px] bg-[conic-gradient(from_210deg,var(--accent),color-mix(in_oklab,var(--accent)_30%,var(--bg)),var(--accent))] after:absolute after:inset-3 after:rounded-full after:bg-bg" />
        <p className="mb-1 text-[13px] text-muted">{site}</p>
        <h1 className="mb-1.5 text-[26px] font-semibold tracking-tight">{title}</h1>
        <p className="mb-7 text-[13.5px] text-muted">{hint}</p>
        {children}
      </div>
    </div>
  );
}

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : '无法连接服务器，请检查网络后重试');

export function LoginPage() {
  const navigate = useNavigate();
  const { next } = useSearch({ from: '/login' });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => call('login', { body: { username, password, remember: true } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authStateQuery.queryKey });
      navigate({ to: next && next.startsWith('/') ? next : '/' });
    },
  });
  return (
    <AuthFrame title="登录" hint="使用管理员为你创建的账号。">
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); login.mutate(); }}>
        <div className="grid gap-1.5"><Label htmlFor="u">用户名</Label><Input id="u" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="p">密码</Label><Input id="p" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {login.isError && <p role="alert" className="text-[13px] text-bad">{errorText(login.error)}</p>}
        <Button type="submit" size="lg" disabled={login.isPending}>{login.isPending ? '正在登录…' : '登录'}</Button>
      </form>
    </AuthFrame>
  );
}

export function SetupPage() {
  const navigate = useNavigate();
  const [siteName, setSiteName] = useState('Luvia');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const setup = useMutation({
    mutationFn: () => call('setup', { body: { username, password, siteName } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authStateQuery.queryKey });
      navigate({ to: '/admin', search: { tab: 'libraries' } });
    },
  });
  return (
    <AuthFrame title="创建管理员" hint="这是第一次启动。创建管理员账号后，到控制台启用媒体库目录。">
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); setup.mutate(); }}>
        <div className="grid gap-1.5"><Label htmlFor="s">站点名称</Label><Input id="s" required value={siteName} onChange={(e) => setSiteName(e.target.value)} /></div>
        <div className="grid gap-1.5"><Label htmlFor="u">管理员用户名</Label><Input id="u" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} /></div>
        <div className="grid gap-1.5">
          <Label htmlFor="p">密码</Label>
          <Input id="p" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="text-[12px] text-muted">至少 8 位。</p>
        </div>
        {setup.isError && <p role="alert" className="text-[13px] text-bad">{errorText(setup.error)}</p>}
        <Button type="submit" size="lg" disabled={setup.isPending}>{setup.isPending ? '正在创建…' : '创建并进入控制台'}</Button>
      </form>
    </AuthFrame>
  );
}
