import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Folder as FolderIcon, FolderOpen, Heart, Pin, PinOff } from 'lucide-react';
import type { FolderTreeNode } from '@luvia/contracts';
import type { z } from 'zod';
import { cn } from '@/lib/cn';
import { folderTreeQuery, foldersQuery } from './favorite';
import { ancestorsOf } from './paths';

type TreeNode = z.infer<typeof FolderTreeNode>;

interface TreeCtx {
  current: string | undefined;
  expanded: ReadonlySet<string>;
  toggle: (path: string) => void;
}

/** 光标停在左边缘多久才弹出：快速划向主导航时不会误触发。 */
const HOVER_OPEN_MS = 140;
/** 光标离开面板后多久收起：短暂移出再回来不会闪烁。 */
const HOVER_CLOSE_MS = 320;

function Row({ node, ctx, root, hint }: { node: TreeNode; ctx: TreeCtx; root?: boolean; hint?: string | null }) {
  const on = node.path === ctx.current;
  const open = ctx.expanded.has(node.path);
  const hasKids = node.childCount > 0;
  // 第一次展开后保留子树，收起时才能播放折叠动画
  const [mounted, setMounted] = useState(open);
  useEffect(() => { if (open) setMounted(true); }, [open]);
  const Icon = hasKids && open ? FolderOpen : FolderIcon;
  return (
    <li className={cn(root && 'mb-1.5')}>
      <div
        className={cn(
          'group/row relative flex items-center gap-1 rounded-[9px] pr-2 pl-1 text-fg-2 transition-colors duration-150 hover:bg-accent-soft hover:text-fg',
          root ? 'min-h-9 text-[13.5px] font-semibold text-fg' : 'h-8 text-[13px]',
          on && 'bg-accent-soft text-fg',
        )}
      >
        {hasKids ? (
          <button
            type="button"
            aria-label={open ? `收起 ${node.name}` : `展开 ${node.name}`}
            aria-expanded={open}
            onClick={() => ctx.toggle(node.path)}
            className="grid size-6 flex-none place-items-center rounded-md text-muted transition-colors hover:bg-line-2 hover:text-fg"
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform duration-300 ease-[var(--ease-spring)] motion-reduce:transition-none', open && 'rotate-90')}
              strokeWidth={2}
            />
          </button>
        ) : (
          <span className="size-6 flex-none" />
        )}
        <Link
          to="/folders"
          search={{ path: node.path }}
          aria-current={on ? 'page' : undefined}
          className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md py-1 focus-visible:outline-offset-0"
        >
          <Icon className={cn('size-4 flex-none transition-colors', on ? 'text-accent' : 'text-muted group-hover/row:text-fg-2')} strokeWidth={1.7} />
          <span className="min-w-0 flex-1">
            <span className={cn('block truncate', on && 'font-semibold')}>{node.name}</span>
            {hint && <span title="宿主机路径" className="block truncate text-[11px] font-normal text-muted">{hint}</span>}
          </span>
          {node.favorite && <Heart aria-label="已收藏" className="size-3 flex-none fill-accent text-accent" strokeWidth={0} />}
          <span className="flex-none rounded-full px-1.5 text-[11px] font-normal text-muted tabular-nums">{node.mediaCount.toLocaleString('zh-CN')}</span>
        </Link>
      </div>
      {hasKids && mounted && (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
          style={{ gridTemplateRows: open ? '1fr' : '0fr', opacity: open ? 1 : 0 }}
          inert={!open}
        >
          <div className="min-h-0 overflow-hidden">
            <Children path={node.path} ctx={ctx} />
          </div>
        </div>
      )}
    </li>
  );
}

function Children({ path, ctx }: { path: string; ctx: TreeCtx }) {
  const { data, isPending, isError } = useQuery(folderTreeQuery(path));
  // 缩进参考线：每一层子目录左侧一条细线，对齐上一层的展开箭头
  const guide = 'ml-[15px] border-l border-line-2 pl-1.5';
  if (isPending) {
    return (
      <div className={cn(guide, 'py-1')} aria-busy>
        <span className="sr-only">正在加载子目录</span>
        {[72, 54].map((w) => (
          <div key={w} className="flex h-8 items-center gap-2 pl-8">
            <div className="h-2.5 animate-pulse rounded-full bg-line-2" style={{ width: `${w}%` }} />
          </div>
        ))}
      </div>
    );
  }
  if (isError) return <div className={cn(guide, 'h-8 pl-8 text-[12px] leading-8 text-bad')}>无法加载子目录</div>;
  return (
    <ul className={cn(guide, 'my-0 mr-0 list-none py-0.5')}>
      {data.nodes.map((n) => <Row key={n.path} node={n} ctx={ctx} />)}
    </ul>
  );
}

/**
 * 文件夹页的目录树：浮在内容上方的抽屉，平时隐藏。
 * 光标在左边缘停留片刻弹出、离开面板后收起；点击边缘标签或面板里的图钉则固定显示，Esc 或点击面板外收起。
 * 媒体库根常驻在树顶，子目录展开时按需加载；当前路径的祖先自动展开。窄屏不显示，由顶部面包屑承担层级导航。
 */
export function FolderTree({ current }: { current: string | undefined }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!current) return;
    setExpanded((prev) => {
      const need = [...ancestorsOf(current), current].filter((p) => !prev.has(p));
      return need.length ? new Set([...prev, ...need]) : prev;
    });
  }, [current]);
  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p); else next.add(p);
      return next;
    });
  const ctx: TreeCtx = { current, expanded, toggle };
  const roots = useQuery(folderTreeQuery());
  const libs = useQuery(foldersQuery());
  const hostOf = (p: string) => libs.data?.folders.find((f) => f.path === p)?.hostPath ?? null;

  // hover：光标弹出，离开即收；pinned：点击固定，直到再次点击、Esc 或点击面板外
  const [mode, setMode] = useState<'closed' | 'hover' | 'pinned'>('closed');
  const open = mode !== 'closed';
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);
  const panelRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const focusOnOpen = useRef(false);

  const clearTimers = () => { window.clearTimeout(openTimer.current); window.clearTimeout(closeTimer.current); };
  useEffect(() => clearTimers, []);
  const peekSoon = () => {
    window.clearTimeout(closeTimer.current);
    if (mode !== 'closed') return;
    window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => setMode((m) => (m === 'closed' ? 'hover' : m)), HOVER_OPEN_MS);
  };
  const leaveSoon = () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setMode((m) => (m === 'hover' ? 'closed' : m)), HOVER_CLOSE_MS);
  };
  const close = useCallback((restoreFocus: boolean) => {
    clearTimers();
    if (restoreFocus && panelRef.current?.contains(document.activeElement)) handleRef.current?.focus();
    setMode('closed');
  }, []);
  const togglePin = (fromKeyboard: boolean) => {
    clearTimers();
    if (mode === 'pinned') { close(fromKeyboard); return; }
    focusOnOpen.current = fromKeyboard;
    setMode('pinned');
  };

  // 打开时把当前目录滚到可见处；键盘打开时把焦点移进面板
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (list && el) {
      const a = el.getBoundingClientRect(); const b = list.getBoundingClientRect();
      if (a.top < b.top || a.bottom > b.bottom) list.scrollTop += a.top - b.top - b.height / 2 + a.height / 2;
    }
    if (focusOnOpen.current) {
      focusOnOpen.current = false;
      (el ?? list?.querySelector<HTMLElement>('a'))?.focus({ preventScroll: true });
    }
  }, [open]);

  // 固定显示时：Esc、点击面板外收起
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true); };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (mode === 'pinned' && t && !panelRef.current?.contains(t) && !handleRef.current?.contains(t)) close(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true); };
  }, [open, mode, close]);

  return (
    <div className="hidden md:block">
      {/* 左边缘感应带与标签：光标停留弹出；点击（或键盘回车）固定 */}
      <div
        className="group/edge absolute inset-y-0 left-0 z-30 w-4"
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') peekSoon(); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') leaveSoon(); }}
      >
        <button
          ref={handleRef}
          type="button"
          aria-label={mode === 'pinned' ? '收起目录树' : '显示目录树'}
          aria-expanded={open}
          aria-controls="folder-tree-panel"
          onClick={(e) => togglePin(e.detail === 0)}
          className={cn(
            'absolute top-1/2 left-0 grid h-24 w-4 -translate-y-1/2 place-items-center rounded-r-lg transition-opacity duration-200',
            open ? 'pointer-events-none opacity-0' : 'opacity-100',
          )}
        >
          <span
            aria-hidden
            className="h-11 w-1 rounded-full bg-line-2 transition-[height,width,background-color] duration-300 ease-[var(--ease-spring)] group-hover/edge:h-16 group-hover/edge:w-[5px] group-hover/edge:bg-accent motion-reduce:transition-none"
          />
        </button>
      </div>

      <aside
        id="folder-tree-panel"
        ref={panelRef}
        aria-label="目录树"
        aria-hidden={!open}
        inert={!open}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') window.clearTimeout(closeTimer.current); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse' && mode === 'hover') leaveSoon(); }}
        className={cn(
          'absolute top-3 bottom-3 left-3 z-40 border border-line-2 bg-[color-mix(in_oklab,var(--raised)_90%,transparent)] backdrop-blur-xl backdrop-saturate-150 flex w-[300px] flex-col overflow-hidden rounded-[calc(var(--r3)+2px)] shadow-[0_24px_60px_-20px_rgba(0,0,0,.55),0_2px_8px_-2px_rgba(0,0,0,.25)] will-change-transform motion-reduce:transition-none',
          'origin-left transition-[transform,opacity]',
          open
            ? 'translate-x-0 scale-100 opacity-100 duration-[560ms] ease-[var(--ease-spring)]'
            : 'pointer-events-none -translate-x-[calc(100%+28px)] scale-[.97] opacity-0 duration-200 ease-[cubic-bezier(.4,0,1,1)]',
        )}
      >
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
          <h2 className="m-0 flex-1 text-[13px] font-semibold text-fg">目录</h2>
          <button
            type="button"
            aria-pressed={mode === 'pinned'}
            aria-label={mode === 'pinned' ? '取消固定目录树' : '固定目录树'}
            title={mode === 'pinned' ? '取消固定（Esc）' : '固定显示'}
            onClick={() => (mode === 'pinned' ? setMode('hover') : setMode('pinned'))}
            className={cn(
              'grid size-7 place-items-center rounded-lg text-muted transition-colors hover:bg-accent-soft hover:text-fg [&_svg]:size-3.5',
              mode === 'pinned' && 'bg-accent-soft text-fg',
            )}
          >
            {mode === 'pinned' ? <PinOff /> : <Pin />}
          </button>
        </div>
        <div
          ref={listRef}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:thin] transition-[opacity,transform] duration-300 motion-reduce:transition-none',
            open ? 'translate-x-0 opacity-100 delay-75' : '-translate-x-2 opacity-0',
          )}
        >
          {roots.isError && <p className="mx-2.5 text-[12.5px] text-bad">无法加载目录树，请刷新页面重试。</p>}
          <ul className="m-0 list-none p-0">
            {roots.data?.nodes.map((n) => <Row key={n.path} node={n} ctx={ctx} root hint={hostOf(n.path)} />)}
          </ul>
        </div>
      </aside>
    </div>
  );
}
