/**
 * 控制台（仅管理员）：概览、媒体库、扫描与处理、用户、客户端接入。
 * 当前分区由搜索参数 tab 决定，便于刷新与分享链接时保持位置。
 */
import { lazy, Suspense, useRef } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { adminSearch } from '@/router';
import { cn } from '@/lib/cn';
import { formatUptime, formatWhen } from './format';
import { overviewQuery } from './hooks';
import { AdminKeyframes } from './ui';

const OverviewTab = lazy(() => import('./OverviewTab'));
const LibrariesTab = lazy(() => import('./LibrariesTab'));
const ProcessingTab = lazy(() => import('./ProcessingTab'));
const UsersTab = lazy(() => import('./UsersTab'));
const ClientsTab = lazy(() => import('./ClientsTab'));

type Tab = NonNullable<z.infer<typeof adminSearch>['tab']>;
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: '概览' },
  { id: 'libraries', label: '媒体库' },
  { id: 'processing', label: '扫描与处理' },
  { id: 'users', label: '用户' },
  { id: 'clients', label: '客户端接入' },
];
const PANES: Record<Tab, React.ComponentType> = { overview: OverviewTab, libraries: LibrariesTab, processing: ProcessingTab, users: UsersTab, clients: ClientsTab };

function Subtitle() {
  const { data } = useQuery(overviewQuery);
  if (!data) return <div className="mt-0.5 h-5 text-[13px] text-muted" aria-hidden />;
  const scan = formatWhen(data.lastScanAt);
  return (
    <div className="mt-0.5 text-[13px] text-muted">
      已连续运行 {formatUptime(data.uptimeSec)}，{scan ? `最近一次扫描在${/^\d/.test(scan) ? ' ' : ''}${scan}` : '还没有扫描过'}
    </div>
  );
}

export default function AdminPage() {
  const { tab = 'overview' } = useSearch({ from: '/app/admin' });
  const navigate = useNavigate({ from: '/admin' });
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const go = (t: Tab) => navigate({ search: { tab: t === 'overview' ? undefined : t }, replace: true });
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : d ? (i + d + TABS.length) % TABS.length : -1;
    if (to < 0) return;
    e.preventDefault();
    refs.current[to]?.focus();
    go(TABS[to]!.id);
  };
  const Pane = PANES[tab];

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <AdminKeyframes />
      <div className="mx-auto grid max-w-[1440px] gap-[18px] px-4 pt-8 pb-24 md:px-11 md:pt-12 md:pb-20">
        <header>
          <h1 className="m-0 text-[28px] font-semibold tracking-[-0.02em] md:text-[34px]">控制台</h1>
          <Subtitle />
        </header>
        <nav role="tablist" aria-label="控制台分区" className="scrollbar-none -mt-0.5 flex gap-0.5 overflow-x-auto border-b border-line">
          {TABS.map((t, i) => {
            const on = t.id === tab;
            return (
              <button
                key={t.id}
                ref={(el) => { refs.current[i] = el; }}
                id={`admin-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls="admin-pane"
                tabIndex={on ? 0 : -1}
                onClick={() => go(t.id)}
                onKeyDown={(e) => onKey(e, i)}
                className={cn(
                  'relative h-[42px] shrink-0 px-3.5 text-[14px] whitespace-nowrap text-muted hover:text-fg',
                  on && 'font-semibold text-fg after:absolute after:right-2.5 after:-bottom-px after:left-2.5 after:h-0.5 after:rounded-sm after:bg-accent',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
        <div id="admin-pane" role="tabpanel" aria-labelledby={`admin-tab-${tab}`} className="grid min-w-0 gap-[18px]">
          <Suspense fallback={<div className="text-[13px] text-muted">正在加载…</div>}>
            <Pane />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
