import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { ChevronRight, Folder, Heart, Shuffle } from 'lucide-react';
import { toast } from 'sonner';
import type { PreferencesPatch } from '@luvia/contracts';
import { cn } from '@/lib/cn';
import { q } from '@/lib/query';
import { usePreferences, useUpdatePreferences } from '@/stores/session';
import { ancestorsOf, HERO_OPTIONS, type HeroSource } from './heroSource';

/** 保存首页轮播偏好；失败时提示（乐观更新会自动撤回）。 */
export function useSaveHome() {
  const m = useUpdatePreferences();
  return (home: NonNullable<PreferencesPatch['home']>) =>
    m.mutate({ home }, { onError: (e) => toast.error(`轮播内容没有保存：${e.message}`) });
}

const countFmt = (n: number) => n.toLocaleString('zh-CN');

function FolderRow({ path, name, count, favorite, depth, selected, onSelect, expand }: {
  path: string; name: string; count: number; favorite: boolean; depth: number; selected: boolean;
  onSelect: (path: string) => void;
  expand?: { open: boolean; toggle: () => void } | null;
}) {
  return (
    <div className="flex items-center" style={{ paddingLeft: depth * 14 }}>
      {expand ? (
        <button
          type="button"
          aria-label={expand.open ? `收起「${name}」` : `展开「${name}」`}
          aria-expanded={expand.open}
          onClick={expand.toggle}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-accent-soft hover:text-fg"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', expand.open && 'rotate-90')} />
        </button>
      ) : <span className="w-7 shrink-0" />}
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(path)}
        title={path}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-fg-2 hover:bg-accent-soft hover:text-fg',
          selected && 'bg-accent-soft font-medium text-fg',
        )}
      >
        <Folder className="size-3.5 shrink-0" strokeWidth={1.8} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {favorite && <Heart className="size-3 shrink-0 fill-current text-accent" strokeWidth={0} aria-label="已收藏" />}
        <span className="shrink-0 text-xs text-muted">{countFmt(count)}</span>
      </button>
    </div>
  );
}

function TreeLevel({ path, depth, selected, onSelect, expanded, toggle }: {
  path: string; depth: number; selected: string | null; onSelect: (p: string) => void;
  expanded: ReadonlySet<string>; toggle: (p: string) => void;
}) {
  const { data, isPending, isError } = useQuery(q('folderTree', { query: path ? { path } : {} }));
  if (isPending) return <div className="py-1.5 text-xs text-muted" style={{ paddingLeft: depth * 14 + 36 }}>正在读取文件夹…</div>;
  if (isError) return <div className="py-1.5 text-xs text-bad" style={{ paddingLeft: depth * 14 + 36 }}>文件夹列表读取失败，请稍后再展开一次。</div>;
  return (
    <>
      {data.nodes.map((n) => {
        const open = expanded.has(n.path);
        return (
          <div key={n.path}>
            <FolderRow
              path={n.path} name={n.name} count={n.mediaCount} favorite={n.favorite} depth={depth}
              selected={selected === n.path} onSelect={onSelect}
              expand={n.childCount > 0 ? { open, toggle: () => toggle(n.path) } : null}
            />
            {open && <TreeLevel path={n.path} depth={depth + 1} selected={selected} onSelect={onSelect} expanded={expanded} toggle={toggle} />}
          </div>
        );
      })}
    </>
  );
}

/** 文件夹选择：收藏的文件夹置顶，下方为可展开的完整目录树。 */
export function FolderPicker({ selected, onSelect, className }: { selected: string | null; onSelect: (path: string) => void; className?: string }) {
  const favQ = useQuery(q('favoriteFolders'));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(ancestorsOf(selected)));
  const toggle = (p: string) => setExpanded((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const favs = favQ.data?.folders ?? [];
  return (
    <div className={cn('max-h-[260px] overflow-auto overscroll-contain', className)} role="group" aria-label="选择文件夹">
      {favs.length > 0 && (
        <>
          <div className="px-2 pt-1.5 pb-1 text-xs font-semibold text-muted">收藏的文件夹</div>
          {favs.map((f) => (
            <FolderRow key={f.path} path={f.path} name={f.name} count={f.mediaCount} favorite depth={0} selected={selected === f.path} onSelect={onSelect} />
          ))}
          <div className="px-2 pt-2.5 pb-1 text-xs font-semibold text-muted">全部文件夹</div>
        </>
      )}
      <TreeLevel path="" depth={0} selected={selected} onSelect={onSelect} expanded={expanded} toggle={toggle} />
    </div>
  );
}

/**
 * 首页轮播内容选择：四个来源 + 指定文件夹时的文件夹列表。首页弹层与外观面板共用，写入 preferences.home。
 * onDone：用鼠标或回车选中非文件夹来源后调用（弹层据此关闭）。
 */
export function HeroSourcePicker({ onDone, onReroll, compact }: { onDone?: () => void; onReroll?: () => void; compact?: boolean }) {
  const home = usePreferences().home;
  const save = useSaveHome();
  // 选了“指定文件夹”但尚未挑文件夹时，先只在本地展开列表，不写偏好
  const [pendingFolder, setPendingFolder] = useState(false);
  const value: HeroSource = pendingFolder ? 'folder' : home.heroSource;
  const showFolders = value === 'folder';

  const choose = (v: HeroSource) => {
    if (v === 'folder') {
      if (home.heroFolder) { setPendingFolder(false); save({ heroSource: 'folder' }); }
      else setPendingFolder(true);
      return;
    }
    setPendingFolder(false);
    save({ heroSource: v });
  };

  return (
    <div>
      <RadioGroup value={value} onValueChange={(v) => choose(v as HeroSource)} aria-label="首页轮播内容" className="grid gap-0.5">
        {HERO_OPTIONS.map((o) => (
          <Radio.Root
            key={o.value}
            value={o.value}
            onClick={() => { if (o.value !== 'folder') onDone?.(); }}
            className={cn(
              'group/opt grid w-full grid-cols-[22px_1fr] items-center gap-x-2.5 rounded-[var(--r2)] text-left hover:bg-accent-soft',
              compact ? 'px-2.5 py-2' : 'px-2.5 py-[9px]',
            )}
          >
            <span aria-hidden className="row-span-2 size-4 justify-self-center rounded-full border-[1.5px] border-line-2 group-data-[checked]/opt:border-[5px] group-data-[checked]/opt:border-accent" />
            <span className="text-[13.5px] font-semibold text-fg">{o.label}</span>
            <span className="text-xs leading-snug text-muted">{o.hint}</span>
          </Radio.Root>
        ))}
      </RadioGroup>
      {showFolders && (
        <div className="mt-1 border-t border-line pt-1.5">
          {pendingFolder && !home.heroFolder && <p className="px-2 pb-1 text-xs text-muted">挑一个文件夹，首页会从它和它的子文件夹里随机挑选。</p>}
          <FolderPicker
            selected={home.heroSource === 'folder' ? home.heroFolder : null}
            onSelect={(p) => { setPendingFolder(false); save({ heroSource: 'folder', heroFolder: p }); }}
          />
        </div>
      )}
      {onReroll && home.heroSource !== 'memories' && (
        <div className="mt-1.5 flex gap-1.5 border-t border-line px-0.5 pt-2">
          <button
            type="button"
            onClick={onReroll}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-line-2 px-[11px] text-[12.5px] text-fg-2 hover:bg-accent-soft hover:text-fg"
          >
            <Shuffle className="size-3.5" />换一组
          </button>
        </div>
      )}
    </div>
  );
}
