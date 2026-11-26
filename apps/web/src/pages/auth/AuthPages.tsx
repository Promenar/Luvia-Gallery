import { useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { Aperture, Layers, ShieldCheck } from 'lucide-react';
import { call, ApiError } from '@/lib/api';
import { queryClient } from '@/lib/query';
import { authStateQuery, useAuthState } from '@/stores/session';
import { BrandMark } from '@/components/BrandMark';
import { AmbientBackdrop } from '@/shell/AmbientBackdrop';
import { Button } from '@/components/kit/button';
import { Input } from '@/components/kit/input';
import { Label } from '@/components/kit/label';

function AuthFrame({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  const site = useAuthState().data?.siteName ?? 'Luvia';
  return (
    <div className="relative grid min-h-dvh grid-cols-1 bg-bg lg:grid-cols-[1.15fr_0.85fr]">
      <AmbientBackdrop />

      {/* 左侧展厅视觉氛围面板 */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-[#0b0c10] p-12 text-white lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 22% 24%, color-mix(in srgb, var(--accent) 34%, transparent), transparent 56%), radial-gradient(circle at 82% 78%, color-mix(in srgb, var(--ambient-2) 32%, transparent), transparent 54%), linear-gradient(155deg, #101218 0%, #090a0e 100%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.5) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />

        <div className="relative z-[2] flex items-center gap-3">
          <BrandMark size={34} className="text-white" />
          <div>
            <div className="font-serif text-[26px] leading-none tracking-tight text-white">{site}</div>
            <div className="mt-1 font-mono text-[10px] tracking-[0.2em] text-white/55 uppercase">PRIVATE VISUAL ARCHIVE</div>
          </div>
        </div>

        <div className="relative z-[2] max-w-[460px]">
          <p className="mb-3 font-mono text-[11px] tracking-[0.18em] text-white/60 uppercase">CURATED LIGHT & MEMORY</p>
          <h2 className="m-0 font-serif text-[46px] leading-[1.12] font-normal tracking-tight text-white">
            私藏光影，静谧如展
          </h2>
          <p className="mt-4 mb-0 text-[14px] leading-relaxed text-white/68">
            双皮肤自由切换——沉浸于随照片呼吸的液态光场，或驻足于克制留白的美术馆画册。全部媒体始终留在你的私有存储中。
          </p>
        </div>

        <div className="relative z-[2] grid grid-cols-3 gap-4 border-t border-white/12 pt-6 text-[12px] text-white/70">
          <div className="flex items-center gap-2">
            <Aperture className="size-4 text-accent" strokeWidth={1.6} />
            <span>OKLCH 动态光场</span>
          </div>
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-accent" strokeWidth={1.6} />
            <span>百万级时间线</span>
          </div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-accent" strokeWidth={1.6} />
            <span>私有目录只读挂载</span>
          </div>
        </div>
      </aside>

      {/* 右侧登录/初始化表单 */}
      <div className="relative z-[2] grid place-items-center px-5 py-10">
        <div className="lv-panel w-full max-w-[400px] p-7 md:p-8">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <BrandMark size={30} />
            <span className="font-serif text-[24px] leading-none text-fg">{site}</span>
          </div>
          <p className="mb-1 hidden font-mono text-[11px] tracking-[0.14em] text-muted uppercase lg:block">{site}</p>
          <h1 className="lv-page-title mb-1.5 text-[28px]!">{title}</h1>
          <p className="mb-6 text-[13.5px] text-muted">{hint}</p>
          {children}
        </div>
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
    <AuthFrame title="登录" hint="使用管理员为你创建的账号进入图库。">
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); login.mutate(); }}>
        <div className="grid gap-1.5">
          <Label htmlFor="u">用户名</Label>
          <Input id="u" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} className="h-10 rounded-[var(--r2)] bg-sunken" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="p">密码</Label>
          <Input id="p" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-10 rounded-[var(--r2)] bg-sunken" />
        </div>
        {login.isError && <p role="alert" className="text-[13px] text-bad">{errorText(login.error)}</p>}
        <Button type="submit" size="lg" disabled={login.isPending} className="mt-1 h-10 rounded-full">
          {login.isPending ? '正在登录…' : '登录'}
        </Button>
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
        <div className="grid gap-1.5">
          <Label htmlFor="s">站点名称</Label>
          <Input id="s" required value={siteName} onChange={(e) => setSiteName(e.target.value)} className="h-10 rounded-[var(--r2)] bg-sunken" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="u">管理员用户名</Label>
          <Input id="u" autoComplete="username" required value={username} onChange={(e) => setUsername(e.target.value)} className="h-10 rounded-[var(--r2)] bg-sunken" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="p">密码</Label>
          <Input id="p" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="h-10 rounded-[var(--r2)] bg-sunken" />
          <p className="text-[12px] text-muted">至少 8 位。</p>
        </div>
        {setup.isError && <p role="alert" className="text-[13px] text-bad">{errorText(setup.error)}</p>}
        <Button type="submit" size="lg" disabled={setup.isPending} className="mt-1 h-10 rounded-full">
          {setup.isPending ? '正在创建…' : '创建并进入控制台'}
        </Button>
      </form>
    </AuthFrame>
  );
}
