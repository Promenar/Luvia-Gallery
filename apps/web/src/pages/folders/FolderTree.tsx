import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRight, Folder as FolderIcon, Heart } from 'lucide-react';
import type { FolderTreeNode } from '@luvia/contracts';
import type { z } from 'zod';
import { cn } from '@/lib/cn';
import { folderTreeQuery, foldersQuery } from './favorite';
import { ancestorsOf } from './paths';

type Node = z.infer<typeof FolderTreeNode>;

interface TreeCtx {
  current: string | undefined;
  expanded: ReadonlySet<string>;
  toggle: (path: string) => void;
}

function Row({ node, depth, ctx, after, className }: { node: Node; depth: number; ctx: TreeCtx; after?: React.ReactNode; className?: string }) {
  const on = node.path === ctx.current;
  const open = ctx.expanded.has(node.path);
  const hasKids = node.childCount > 0;
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (on) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [on]);
  return (
    <li className={className}>
      <div
        className={cn(
          'relative flex h-[30px] items-center gap-[5px] rounded-lg pr-2 text-[13px] text-fg-2 hover:bg-accent-soft hover:text-fg',
          on && 'bg-accent-soft font-semibold text-fg before:absolute before:top-[7px] before:bottom-[7px] before:left-0 before:w-[3px] before:rounded-[3px] before:bg-accent',
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
      >
        {hasKids ? (
          <button
            type="button"
            aria-label={open ? `收起 ${node.name}` : `展开 ${node.name}`}
            aria-expanded={open}
            onClick={() => ctx.toggle(node.path)}
            className="grid size-[18px] flex-none place-items-center rounded-[5px] text-muted hover:bg-line-2 hover:text-fg"
          >
            <ChevronRight className={cn('size-[13px] transition-transform duration-150', open && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-[18px] flex-none" />
        )}
        <Link
          ref={ref}
          to="/folders"
          search={{ path: node.path }}
          aria-current={on ? 'page' : undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-[5px] rounded-md focus-visible:outline-offset-0"
        >
          <FolderIcon className="size-[15px] flex-none" strokeWidth={1.7} />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {node.favorite && <Heart aria-label="已收藏" className="size-3 flex-none fill-accent text-accent" strokeWidth={0} />}
          <span className="text-[11.5px] font-normal text-muted tabular-nums">{node.mediaCount.toLocaleString('zh-CN')}</span>
        </Link>
      </div>
      {after}
      {hasKids && open && <Children path={node.path} depth={depth + 1} ctx={ctx} />}
    </li>
  );
}

function Children({ path, depth, ctx }: { path: string; depth: number; ctx: TreeCtx }) {
  const { data, isPending, isError } = useQuery(folderTreeQuery(path));
  if (isPending) return <div className="h-[30px] text-[12px] leading-[30px] text-muted" style={{ paddingLeft: 27 + depth * 14 }}>正在加载…</div>;
  if (isError) return <div className="h-[30px] text-[12px] leading-[30px] text-bad" style={{ paddingLeft: 27 + depth * 14 }}>无法加载子目录</div>;
  return (
    <ul className="m-0 list-none p-0">
      {data.nodes.map((n) => <Row key={n.path} node={n} depth={depth} ctx={ctx} />)}
    </ul>
  );
}

/**
 * 左侧目录树（原型 .ftree）：媒体库根常驻，子目录展开时按需加载；当前路径高亮且其祖先自动展开。
 * 窄屏隐藏，由顶部面包屑承担层级导航。
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

  return (
    <aside aria-label="目录树" className="hidden min-h-0 overflow-auto border-r border-line bg-surface px-2 pt-4 pb-10 [scrollbar-width:thin] md:block">
      <h2 className="mx-2.5 mt-1 mb-2 text-[12.5px] font-semibold text-muted">目录</h2>
      {roots.isError && <p className="mx-2.5 text-[12.5px] text-bad">无法加载目录树，请刷新页面重试。</p>}
      <ul className="m-0 list-none p-0">
        {roots.data?.nodes.map((n) => {
          const host = hostOf(n.path);
          return (
            <Row
                key={n.path}
                className="mb-2"
                node={n}
                depth={0}
                ctx={ctx}
                after={host && <div title="宿主机路径" className="-mt-[3px] truncate pr-2.5 pb-1 pl-[41px] text-[11.5px] text-muted">{host}</div>}
              />
          );
        })}
      </ul>
    </aside>
  );
}
