/**
 * 虚拟文件夹选择器（按需展开的目录树，数据来自 GET /api/v2/folders/tree）。
 * multiple：勾选多个前缀（用户可访问目录）；否则单选（壁纸文件夹）。
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder } from 'lucide-react';
import { cn } from '@/lib/cn';
import { q } from '@/lib/query';
import { num } from './format';

interface Props {
  value: string[];
  onChange: (v: string[]) => void;
  multiple?: boolean;
  label: string;
  disabled?: boolean;
}

export function FolderPicker({ value, onChange, multiple, label, disabled }: Props) {
  return (
    <div role="group" aria-label={label} className={cn('max-h-[260px] overflow-y-auto rounded-[var(--r2)] border border-line', disabled && 'pointer-events-none opacity-50')}>
      <Level path="" depth={0} value={value} onChange={onChange} multiple={multiple} />
    </div>
  );
}

function Level({ path, depth, ...rest }: { path: string; depth: number } & Omit<Props, 'label' | 'disabled'>) {
  const { data, isLoading, error } = useQuery(q('folderTree', { query: path ? { path } : {} }));
  if (isLoading) return <div className="px-3 py-2 text-[12.5px] text-muted" style={{ paddingLeft: 12 + depth * 16 }}>正在加载…</div>;
  if (error) return <div className="px-3 py-2 text-[12.5px] text-bad" style={{ paddingLeft: 12 + depth * 16 }}>目录读取失败</div>;
  return <>{data?.nodes.map((n) => <Node key={n.path} node={n} depth={depth} {...rest} />)}</>;
}

function Node({ node, depth, value, onChange, multiple }: { node: { path: string; name: string; childCount: number; mediaCount: number }; depth: number } & Omit<Props, 'label' | 'disabled'>) {
  const [open, setOpen] = useState(() => value.some((v) => v.startsWith(node.path + '/')));
  const checked = value.includes(node.path);
  const coveredByParent = multiple && value.some((v) => node.path.startsWith(v + '/'));
  const toggle = () => {
    if (multiple) {
      onChange(checked ? value.filter((v) => v !== node.path) : [...value.filter((v) => !v.startsWith(node.path + '/')), node.path]);
    } else onChange([node.path]);
  };
  return (
    <>
      <div className="flex items-center gap-1 border-b border-line text-[13px] last:border-b-0 hover:bg-accent-soft" style={{ paddingLeft: 4 + depth * 16 }}>
        {node.childCount > 0 ? (
          <button type="button" aria-label={open ? `收起 ${node.name}` : `展开 ${node.name}`} aria-expanded={open} onClick={() => setOpen(!open)} className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:text-fg">
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          </button>
        ) : <span className="size-7 shrink-0" />}
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 pr-3">
          <input
            type={multiple ? 'checkbox' : 'radio'}
            name={multiple ? undefined : 'folder-picker'}
            checked={checked || !!coveredByParent}
            disabled={!!coveredByParent}
            onChange={toggle}
            className="size-3.5 shrink-0 accent-[var(--accent)]"
          />
          <Folder className="size-3.5 shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          <small className="shrink-0 text-[12px] text-muted">{num(node.mediaCount)}</small>
        </label>
      </div>
      {open && <Level path={node.path} depth={depth + 1} value={value} onChange={onChange} multiple={multiple} />}
    </>
  );
}
