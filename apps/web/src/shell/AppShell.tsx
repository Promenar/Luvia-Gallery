import { Suspense, useEffect } from 'react';
import { Link, Outlet, useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router';
import { ArrowLeft, ArrowUp, BookOpen, Moon, Search, Sparkles, Sun } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '@/lib/cn';
import { startEvents, stopEvents } from '@/lib/events';
import { useAuthState, useIsAdmin, usePreferences, useUpdatePreferences, useUser } from '@/stores/session';
import { useViewer } from '@/stores/viewer';
import { useIsDark } from '@/theme/ThemeProvider';
import { BrandMark } from '@/components/BrandMark';
import { Viewer } from '@/viewer/Viewer';
import { AppearanceStudio } from '@/pages/appearance/AppearanceStudio';
import { AmbientBackdrop } from './AmbientBackdrop';
import { CommandPalette, useCommandPalette } from './CommandPalette';
import { ADMIN_NAV, AppearanceIcon, EDITOR_NAV, PRIMARY_NAV, type NavItem } from './nav';
import { thumbMemory } from '@/components/media/thumb-memory';
import { parentPath } from '@/pages/folders/paths';

/** 外观面板开关（右侧抽屉，不是独立页面）。 */
export const useStudio = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function isActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/');
}

function initialsOf(username?: string) {
  const clean = (username ?? 'LV').trim();
  return clean.slice(0, 2).toUpperCase() || 'LV';
}

/** 液态光场（cinema）：左侧悬浮光学胶囊 Dock 的圆形导航项。 */
function DockOrb({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative grid size-[42px] place-items-center rounded-full text-muted transition-all duration-200 hover:bg-accent-soft hover:text-fg',
        active && 'bg-accent text-accent-fg shadow-[0_6px_20px_-4px_color-mix(in_srgb,var(--accent)_68%,transparent)] hover:bg-accent hover:text-accent-fg',
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.7} />
      <span className="glass pointer-events-none absolute top-1/2 left-[56px] z-30 -translate-x-1 -translate-y-1/2 rounded-full px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap text-fg opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100">
        {item.label}
      </span>
    </Link>
  );
}

/** 美术馆画册（monograph）：左侧 224px 编目边栏的条目。 */
function CatalogItem({ item, active, indexLabel }: { item: NavItem; active: boolean; indexLabel?: string }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative mb-0.5 flex h-[38px] items-center gap-2.5 rounded-[var(--r2)] px-2.5 text-[13.5px] text-fg-2 transition-all hover:bg-accent-soft hover:text-fg',
        active && 'bg-raised font-medium text-fg shadow-[inset_0_0_0_1px_var(--line-2),var(--shadow-card)] before:absolute before:top-2 before:bottom-2 before:-left-[15px] before:w-[2.5px] before:bg-accent',
      )}
    >
      <Icon className={cn('size-[17px] shrink-0', active ? 'text-accent' : 'text-muted')} strokeWidth={1.65} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {indexLabel && (
        <span className={cn('font-mono text-[10.5px] text-muted/75', active && 'text-accent opacity-100')}>
          {indexLabel}
        </span>
      )}
    </Link>
  );
}

export function AppShell() {
  const location = useRouterState({ select: (s) => s.location });
  const { pathname } = location;
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const folderPath = typeof location.search.path === 'string' ? location.search.path : '';
  const isAdmin = useIsAdmin();
  const user = useUser();
  const siteName = useAuthState().data?.siteName ?? 'Luvia';
  const prefs = usePreferences();
  const dark = useIsDark();
  const updatePrefs = useUpdatePreferences();
  const viewerOpen = useViewer((s) => s.open);
  const setStudio = useStudio((s) => s.setOpen);
  const setPalette = useCommandPalette((s) => s.setOpen);

  const style = prefs.theme?.style ?? 'cinema';
  const toggleSkin = () => updatePrefs.mutate({ theme: { style: style === 'cinema' ? 'monograph' : 'cinema' } });
  const toggleMode = () => updatePrefs.mutate({ theme: { mode: dark ? 'light' : 'dark' } });
  const initials = initialsOf(user?.username);

  useEffect(() => { startEvents(); return stopEvents; }, []);
  useEffect(() => () => { thumbMemory.clear(); }, [user?.id]);

  const dockIconBtn = 'group relative grid size-[40px] place-items-center rounded-full text-muted transition-colors hover:bg-accent-soft hover:text-fg disabled:pointer-events-none disabled:opacity-35';

  return (
    <>
      <AmbientBackdrop />

      <div className="lv-shell">
        {/* 皮肤 B（液态光场）：桌面端左侧悬浮光学胶囊 Dock */}
        <nav aria-label="主导航" className="lv-cinema-dock">
          <Link
            to="/"
            aria-label={siteName}
            className="mb-1.5 grid size-[42px] place-items-center border-b border-line pb-2 text-fg"
          >
            <BrandMark size={26} />
          </Link>
          {PRIMARY_NAV.map((n) => <DockOrb key={n.to} item={n} active={isActive(pathname, n.to)} />)}

          <div className="my-1 h-px w-6 bg-line" aria-hidden />

          <button type="button" aria-label="快速搜索与命令面板" onClick={() => setPalette(true)} className={dockIconBtn}>
            <Search className="size-[17px]" strokeWidth={1.7} />
            <span className="glass pointer-events-none absolute top-1/2 left-[56px] z-30 -translate-x-1 -translate-y-1/2 rounded-full px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap text-fg opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100">
              搜索与命令 · {isMac ? '⌘K' : 'Ctrl K'}
            </span>
          </button>

          {isAdmin && <DockOrb item={EDITOR_NAV} active={isActive(pathname, EDITOR_NAV.to)} />}
          {isAdmin && <DockOrb item={ADMIN_NAV} active={isActive(pathname, ADMIN_NAV.to)} />}

          {pathname === '/folders' && (
            <>
              <button
                type="button"
                aria-label="上一级文件夹"
                title="上一级文件夹"
                className={dockIconBtn}
                disabled={!folderPath}
                onClick={() => void router.navigate({ to: '/folders', search: { path: parentPath(folderPath) } })}
              >
                <ArrowUp className="size-[17px]" strokeWidth={1.7} />
              </button>
              <button
                type="button"
                aria-label="返回上一页"
                title="返回上一页"
                className={dockIconBtn}
                disabled={!canGoBack}
                onClick={() => router.history.back()}
              >
                <ArrowLeft className="size-[17px]" strokeWidth={1.7} />
              </button>
            </>
          )}

          <div className="mt-1 flex flex-col items-center gap-1 border-t border-line pt-2">
            <button type="button" aria-label="切换皮肤" onClick={toggleSkin} className={dockIconBtn}>
              <BookOpen className="size-[17px]" strokeWidth={1.7} />
              <span className="glass pointer-events-none absolute top-1/2 left-[56px] z-30 -translate-x-1 -translate-y-1/2 rounded-full px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap text-fg opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100">
                切换至画册皮肤
              </span>
            </button>
            <button type="button" aria-label="外观" onClick={() => setStudio(true)} className={dockIconBtn}>
              <AppearanceIcon className="size-[17px]" strokeWidth={1.7} />
              <span className="glass pointer-events-none absolute top-1/2 left-[56px] z-30 -translate-x-1 -translate-y-1/2 rounded-full px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap text-fg opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100">
                外观工坊
              </span>
            </button>
            <div
              aria-label={user?.username}
              title={user?.username}
              className="mt-0.5 grid size-[32px] place-items-center rounded-full border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-accent-soft font-mono text-[11px] font-semibold tracking-wider text-accent"
            >
              {initials}
            </div>
          </div>
        </nav>

        {/* 皮肤 A（美术馆画册）：桌面端左侧 224px 策展编目侧栏 */}
        <nav aria-label="主导航" className="lv-monograph-sidebar">
          <Link to="/" className="mb-4 flex items-center gap-2.5 border-b border-line px-2 pb-4">
            <BrandMark size={28} />
            <div className="min-w-0">
              <div className="truncate font-serif text-[23px] leading-none text-fg">{siteName}</div>
              <div className="mt-1 font-mono text-[9.5px] tracking-[0.16em] text-muted uppercase">ARCHIVE</div>
            </div>
          </Link>

          <button
            type="button"
            onClick={() => setPalette(true)}
            className="mb-3 flex h-9 items-center gap-2 rounded-[var(--r2)] border border-line-2 bg-bg/60 px-2.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-fg"
          >
            <Search className="size-3.5 shrink-0" strokeWidth={1.7} />
            <span className="min-w-0 flex-1 truncate text-left">快速检索…</span>
            <kbd className="rounded border border-line-2 px-1 py-px font-mono text-[10px]">
              {isMac ? '⌘K' : 'Ctrl K'}
            </kbd>
          </button>

          <div className="px-2.5 pt-1 pb-1.5 font-mono text-[10px] tracking-[0.15em] text-muted uppercase">
            典藏 · COLLECTION
          </div>
          {PRIMARY_NAV.map((n, i) => (
            <CatalogItem key={n.to} item={n} active={isActive(pathname, n.to)} indexLabel={String(i + 1).padStart(2, '0')} />
          ))}

          {isAdmin && (
            <>
              <div className="mt-3 px-2.5 pt-1 pb-1.5 font-mono text-[10px] tracking-[0.15em] text-muted uppercase">
                工作室 · STUDIO
              </div>
              <CatalogItem item={EDITOR_NAV} active={isActive(pathname, EDITOR_NAV.to)} />
              <CatalogItem item={ADMIN_NAV} active={isActive(pathname, ADMIN_NAV.to)} />
            </>
          )}

          {pathname === '/folders' && (
            <div className="mt-3 flex gap-1.5 px-1">
              <button
                type="button"
                aria-label="上一级文件夹"
                disabled={!folderPath}
                onClick={() => void router.navigate({ to: '/folders', search: { path: parentPath(folderPath) } })}
                className="flex h-8 flex-1 items-center justify-center gap-1 rounded-[var(--r2)] border border-line text-[12px] text-fg-2 hover:bg-accent-soft hover:text-fg disabled:opacity-35"
              >
                <ArrowUp className="size-3.5" />上一级
              </button>
              <button
                type="button"
                aria-label="返回上一页"
                disabled={!canGoBack}
                onClick={() => router.history.back()}
                className="flex h-8 flex-1 items-center justify-center gap-1 rounded-[var(--r2)] border border-line text-[12px] text-fg-2 hover:bg-accent-soft hover:text-fg disabled:opacity-35"
              >
                <ArrowLeft className="size-3.5" />返回
              </button>
            </div>
          )}

          <div className="mt-auto grid gap-1 border-t border-line pt-3">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={toggleSkin}
                title="切换至液态光场皮肤"
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[var(--r2)] border border-line text-[12px] text-fg-2 hover:bg-accent-soft hover:text-fg"
              >
                <Sparkles className="size-3.5 text-accent" />液态光场
              </button>
              <button
                type="button"
                aria-label={dark ? '切换浅色模式' : '切换深色模式'}
                onClick={toggleMode}
                className="grid size-8 shrink-0 place-items-center rounded-[var(--r2)] border border-line text-fg-2 hover:bg-accent-soft hover:text-fg"
              >
                {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setStudio(true)}
              className="flex h-9 items-center gap-2.5 rounded-[var(--r2)] px-2.5 text-[13px] text-fg-2 hover:bg-accent-soft hover:text-fg"
            >
              <AppearanceIcon className="size-4 text-muted" strokeWidth={1.65} />
              <span>外观工坊</span>
            </button>
            <div className="mt-0.5 flex items-center gap-2.5 rounded-[var(--r2)] px-2 py-1.5 text-[12.5px] text-fg-2">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-accent-soft font-mono text-[10.5px] font-semibold text-accent">
                {initials}
              </span>
              <span className="min-w-0 flex-1 truncate">{user?.username ?? '访客'}</span>
              {isAdmin && <span className="font-mono text-[10px] text-muted">ADMIN</span>}
            </div>
          </div>
        </nav>

        {/* 主内容舞台 */}
        <main className="luvia-page relative h-full min-h-0 min-w-0 overflow-hidden pb-[calc(60px+env(safe-area-inset-bottom))] md:pb-0">
          <Suspense fallback={<div className="lv-page-inset py-12 text-sm text-muted">正在加载…</div>}>
            <Outlet />
          </Suspense>
        </main>

        {/* 移动端底部悬浮玻璃导航栏（双皮肤统一适配） */}
        <nav
          aria-label="主导航"
          className="glass fixed inset-x-2 bottom-2 z-20 flex rounded-[calc(var(--r3)+2px)] px-1 pb-[env(safe-area-inset-bottom)] md:hidden"
        >
          {PRIMARY_NAV.map((n) => {
            const Icon = n.icon;
            const active = isActive(pathname, n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-[54px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[var(--r2)] text-[10.5px] text-muted transition-colors',
                  active && 'font-medium text-accent',
                )}
              >
                <Icon className="size-[19px]" strokeWidth={active ? 2 : 1.7} />
                <span className="truncate">{n.label}</span>
              </Link>
            );
          })}
          {isAdmin && (
            <Link
              to={EDITOR_NAV.to}
              aria-current={isActive(pathname, EDITOR_NAV.to) ? 'page' : undefined}
              className={cn(
                'flex h-[54px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[var(--r2)] text-[10.5px] text-muted transition-colors',
                isActive(pathname, EDITOR_NAV.to) && 'font-medium text-accent',
              )}
            >
              <EDITOR_NAV.icon className="size-[19px]" strokeWidth={isActive(pathname, EDITOR_NAV.to) ? 2 : 1.7} />
              <span className="truncate">{EDITOR_NAV.label}</span>
            </Link>
          )}
          <button
            type="button"
            onClick={() => setStudio(true)}
            className="flex h-[54px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[var(--r2)] text-[10.5px] text-muted"
          >
            <AppearanceIcon className="size-[19px]" strokeWidth={1.7} />
            <span className="truncate">外观</span>
          </button>
        </nav>

        {viewerOpen && <Viewer />}
        <CommandPalette onOpenStudio={() => setStudio(true)} />
        <AppearanceStudio />
      </div>
    </>
  );
}
