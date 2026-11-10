import { Suspense, useEffect } from 'react';
import { Link, Outlet, useCanGoBack, useRouter, useRouterState } from '@tanstack/react-router';
import { ArrowLeft, ArrowUp } from 'lucide-react';
import { create } from 'zustand';
import { cn } from '@/lib/cn';
import { startEvents, stopEvents } from '@/lib/events';
import { useIsAdmin, useUser } from '@/stores/session';
import { useViewer } from '@/stores/viewer';
import { Viewer } from '@/viewer/Viewer';
import { AppearanceStudio } from '@/pages/appearance/AppearanceStudio';
import { ADMIN_NAV, AppearanceIcon, EDITOR_NAV, PRIMARY_NAV, type NavItem } from './nav';
import { thumbMemory } from '@/components/media/thumb-memory';
import { parentPath } from '@/pages/folders/paths';

/** 外观面板开关（右侧抽屉，不是独立页面）。 */
export const useStudio = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

function isActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/');
}

function RailButton({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative grid size-11 place-items-center rounded-xl text-muted transition-colors hover:bg-accent-soft hover:text-fg',
        active && 'bg-accent-soft text-fg before:absolute before:top-3 before:bottom-3 before:-left-2.5 before:w-[3px] before:rounded-r before:bg-accent',
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.7} />
      <span className="pointer-events-none absolute top-1/2 left-[54px] z-20 -translate-y-1/2 rounded-md border border-line-2 bg-raised px-2 py-1 text-[12.5px] whitespace-nowrap text-fg opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {item.label}
      </span>
    </Link>
  );
}

export function AppShell() {
  const location = useRouterState({ select: (s) => s.location });
  const { pathname } = location;
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const folderPath = typeof location.search.path === 'string' ? location.search.path : '';
  const folderNavClass = 'grid size-11 place-items-center rounded-xl text-muted hover:bg-accent-soft hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted';
  const isAdmin = useIsAdmin();
  const user = useUser();
  const viewerOpen = useViewer((s) => s.open);
  const setStudio = useStudio((s) => s.setOpen);
  const EditorIcon = EDITOR_NAV.icon;

  useEffect(() => { startEvents(); return stopEvents; }, []);
  useEffect(() => () => { thumbMemory.clear(); }, [user?.id]);

  return (
    <div className="grid h-dvh grid-cols-1 md:grid-cols-[64px_minmax(0,1fr)]">
      <nav aria-label="主导航" className="z-10 hidden flex-col items-center gap-1 border-r border-line bg-surface py-3.5 md:flex">
        <div aria-hidden className="relative mb-3.5 size-[34px] rounded-[11px] bg-[conic-gradient(from_210deg,var(--accent),color-mix(in_oklab,var(--accent)_30%,var(--bg)),var(--accent))] after:absolute after:inset-[9px] after:rounded-full after:bg-surface" />
        {PRIMARY_NAV.map((n) => <RailButton key={n.to} item={n} active={isActive(pathname, n.to)} />)}
        <div className="flex-1" />
        {isAdmin && <RailButton item={EDITOR_NAV} active={isActive(pathname, EDITOR_NAV.to)} />}
        {isAdmin && <RailButton item={ADMIN_NAV} active={isActive(pathname, ADMIN_NAV.to)} />}
        <button
          type="button"
          aria-label="外观"
          onClick={() => setStudio(true)}
          className="grid size-11 place-items-center rounded-xl text-muted hover:bg-accent-soft hover:text-fg"
        >
          <AppearanceIcon className="size-[18px]" strokeWidth={1.7} />
        </button>
        {pathname === '/folders' && (
          <>
            <button type="button" aria-label="上一级文件夹" title="上一级文件夹"
              className={folderNavClass} disabled={!folderPath}
              onClick={() => void router.navigate({ to: '/folders', search: { path: parentPath(folderPath) } })}>
              <ArrowUp className="size-[18px]" strokeWidth={1.7} />
            </button>
            <button type="button" aria-label="返回上一页" title="返回上一页"
              className={folderNavClass} disabled={!canGoBack}
              onClick={() => router.history.back()}>
              <ArrowLeft className="size-[18px]" strokeWidth={1.7} />
            </button>
          </>
        )}
        <div aria-label={user?.username} title={user?.username} className="mt-2 size-[30px] rounded-full bg-[linear-gradient(140deg,#8b7660,#3d4c5c)]" />
      </nav>

      <main className="luvia-page relative min-h-0 min-w-0 overflow-hidden pb-[calc(56px+env(safe-area-inset-bottom))] md:pb-0">
        <Suspense fallback={<div className="p-8 text-muted">正在加载…</div>}>
          <Outlet />
        </Suspense>
      </main>

      <nav aria-label="主导航" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {PRIMARY_NAV.filter((n) => n.to !== '/favorites').map((n) => {
          const Icon = n.icon;
          const active = isActive(pathname, n.to);
          return (
            <Link key={n.to} to={n.to} aria-current={active ? 'page' : undefined}
              className={cn('flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-muted', active && 'text-accent')}>
              <Icon className="size-5" strokeWidth={1.7} />{n.label}
            </Link>
          );
        })}
        {isAdmin && (
          <Link to={EDITOR_NAV.to} aria-current={isActive(pathname, EDITOR_NAV.to) ? 'page' : undefined}
            className={cn('flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-muted', isActive(pathname, EDITOR_NAV.to) && 'text-accent')}>
            <EditorIcon className="size-5" strokeWidth={1.7} />{EDITOR_NAV.label}
          </Link>
        )}
        <button type="button" onClick={() => setStudio(true)} className="flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] text-muted">
          <AppearanceIcon className="size-5" strokeWidth={1.7} />外观
        </button>
      </nav>

      {viewerOpen && <Viewer />}
      <AppearanceStudio />
    </div>
  );
}
