import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { useNavigate } from '@tanstack/react-router';
import { create } from 'zustand';
import {
  Frame, Grid2x2, LayoutGrid, Moon, Palette, Search, Sparkles, Sun, BookOpen, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useIsAdmin, usePreferences, useUpdatePreferences } from '@/stores/session';
import { useIsDark } from '@/theme/ThemeProvider';
import { ADMIN_NAV, EDITOR_NAV, PRIMARY_NAV } from './nav';

/** 全局 ⌘K 命令面板开关。 */
export const useCommandPalette = create<{
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));

interface PaletteAction {
  id: string;
  group: '导航' | '外观与皮肤' | '检索';
  label: string;
  hint?: string;
  keywords: string;
  icon: React.ReactNode;
  active?: boolean;
  run: () => void;
}

export function CommandPalette({ onOpenStudio }: { onOpenStudio: () => void }) {
  const open = useCommandPalette((s) => s.open);
  const setOpen = useCommandPalette((s) => s.setOpen);
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const prefs = usePreferences();
  const dark = useIsDark();
  const updatePrefs = useUpdatePreferences();

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // 全局注册 ⌘K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        useCommandPalette.getState().toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const closeAnd = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const trimmed = query.trim();
  const style = prefs.theme?.style ?? 'cinema';

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [];

    if (trimmed) {
      list.push({
        id: 'search-photos',
        group: '检索',
        label: `在全部照片中搜索「${trimmed}」`,
        hint: '回车跳转',
        keywords: trimmed,
        icon: <Search className="size-4" strokeWidth={1.7} />,
        run: () => closeAnd(() => void navigate({ to: '/photos', search: { q: trimmed } })),
      });
    }

    const navItems = [...PRIMARY_NAV, ...(isAdmin ? [EDITOR_NAV, ADMIN_NAV] : [])];
    for (const item of navItems) {
      const Icon = item.icon;
      list.push({
        id: `nav-${item.to}`,
        group: '导航',
        label: `前往 ${item.label}`,
        hint: item.to,
        keywords: `${item.label} ${item.to} nav`,
        icon: <Icon className="size-4" strokeWidth={1.7} />,
        run: () => closeAnd(() => void navigate({ to: item.to })),
      });
    }

    list.push(
      {
        id: 'skin-cinema',
        group: '外观与皮肤',
        label: '切换皮肤：液态光场（Cinema）',
        hint: style === 'cinema' ? '当前' : '悬浮光学暗房',
        keywords: 'skin cinema 液态光场 暗房 皮肤 b',
        active: style === 'cinema',
        icon: <Sparkles className="size-4" strokeWidth={1.7} />,
        run: () => closeAnd(() => updatePrefs.mutate({ theme: { style: 'cinema' } })),
      },
      {
        id: 'skin-monograph',
        group: '外观与皮肤',
        label: '切换皮肤：美术馆画册（Monograph）',
        hint: style === 'monograph' ? '当前' : '纸与光影展墙',
        keywords: 'skin monograph 美术馆 画册 皮肤 a',
        active: style === 'monograph',
        icon: <BookOpen className="size-4" strokeWidth={1.7} />,
        run: () => closeAnd(() => updatePrefs.mutate({ theme: { style: 'monograph' } })),
      },
      {
        id: 'toggle-mode',
        group: '外观与皮肤',
        label: dark ? '切换为浅色模式' : '切换为深色模式',
        hint: dark ? '明亮展厅' : '沉浸暗房',
        keywords: 'dark light 深色 浅色 夜间 日间 主题 mode',
        icon: dark ? <Sun className="size-4" strokeWidth={1.7} /> : <Moon className="size-4" strokeWidth={1.7} />,
        run: () => closeAnd(() => updatePrefs.mutate({ theme: { mode: dark ? 'light' : 'dark' } })),
      },
      {
        id: 'grid-mat',
        group: '外观与皮肤',
        label: prefs.gridStyle === 'mat' ? '切换照片排列：保留原比例' : '切换照片排列：画册装裱',
        hint: prefs.gridStyle === 'mat' ? '紧凑等比行' : '无酸纸留白',
        keywords: 'grid mat justified 装裱 排列 网格',
        icon: prefs.gridStyle === 'mat' ? <LayoutGrid className="size-4" strokeWidth={1.7} /> : <Frame className="size-4" strokeWidth={1.7} />,
        run: () => closeAnd(() => updatePrefs.mutate({ gridStyle: prefs.gridStyle === 'mat' ? 'justified' : 'mat' })),
      },
      {
        id: 'grid-square',
        group: '外观与皮肤',
        label: '切换照片排列：方格网格',
        hint: prefs.gridStyle === 'square' ? '当前' : '整齐等宽',
        keywords: 'grid square 方格 网格',
        active: prefs.gridStyle === 'square',
        icon: <Grid2x2 className="size-4" strokeWidth={1.7} />,
        run: () => closeAnd(() => updatePrefs.mutate({ gridStyle: 'square' })),
      },
      {
        id: 'open-studio',
        group: '外观与皮肤',
        label: '打开外观工坊',
        hint: '完整皮肤与色彩设置',
        keywords: 'appearance studio 外观 主题 设置 颜色',
        icon: <Palette className="size-4" strokeWidth={1.7} />,
        run: () => closeAnd(onOpenStudio),
      },
    );

    if (!trimmed) return list;
    const q = trimmed.toLowerCase();
    return list.filter(
      (item) =>
        item.id === 'search-photos' ||
        item.label.toLowerCase().includes(q) ||
        item.keywords.toLowerCase().includes(q) ||
        (item.hint?.toLowerCase().includes(q) ?? false),
    );
  }, [trimmed, isAdmin, style, dark, prefs.gridStyle, navigate, updatePrefs, onOpenStudio]);

  const safeCursor = actions.length ? Math.min(cursor, actions.length - 1) : 0;

  const grouped = useMemo(() => {
    const map = new Map<PaletteAction['group'], Array<{ action: PaletteAction; index: number }>>();
    actions.forEach((action, index) => {
      const bucket = map.get(action.group) ?? [];
      bucket.push({ action, index });
      map.set(action.group, bucket);
    });
    return [...map.entries()];
  }, [actions]);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-scrim backdrop-blur-[6px] transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Popup
          aria-label="全局命令面板"
          className={cn(
            'glass fixed top-[min(14vh,108px)] left-1/2 z-50 w-[min(600px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-[var(--r3)] text-fg outline-none',
            'transition-[opacity,transform] duration-200 ease-[var(--ease-cinema)] data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
          )}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setCursor((c) => (actions.length ? (c + 1) % actions.length : 0));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setCursor((c) => (actions.length ? (c - 1 + actions.length) % actions.length : 0));
            } else if (e.key === 'Enter') {
              const target = actions[safeCursor];
              if (target) {
                e.preventDefault();
                target.run();
              }
            }
          }}
        >
          <Dialog.Title className="sr-only">快速搜索与命令面板</Dialog.Title>
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <Search className="size-[18px] shrink-0 text-muted" strokeWidth={1.7} aria-hidden />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
              placeholder="搜索照片、跳转页面，或切换皮肤与深浅模式…"
              aria-label="输入搜索词或命令"
              className="min-w-0 flex-1 bg-transparent text-[14.5px] text-fg outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
              style={{ outline: 'none' }}
            />
            <kbd className="rounded-md border border-line-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted">ESC</kbd>
          </div>
          <div className="max-h-[min(56vh,420px)] overflow-y-auto p-2.5">
            {grouped.map(([group, entries]) => (
              <div key={group} className="mb-2 last:mb-0">
                <div className="px-2.5 pt-1.5 pb-1 font-mono text-[10.5px] tracking-[0.12em] text-muted uppercase">
                  {group}
                </div>
                {entries.map(({ action, index }) => {
                  const focused = index === safeCursor;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={action.run}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-[var(--r2)] px-2.5 py-2 text-left text-[13.5px] text-fg-2 transition-colors',
                        focused && 'bg-accent-soft text-fg',
                      )}
                    >
                      <span className={cn('grid size-7 shrink-0 place-items-center rounded-[var(--r1)] bg-sunken text-muted', focused && 'text-accent')}>
                        {action.icon}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-medium">{action.label}</span>
                      {action.hint && (
                        <span className={cn('shrink-0 font-mono text-[11px] text-muted', action.active && 'text-accent')}>
                          {action.hint}
                        </span>
                      )}
                      {focused && <ArrowRight className="size-3.5 shrink-0 text-accent" strokeWidth={1.8} />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
