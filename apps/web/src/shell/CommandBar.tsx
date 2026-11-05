import { forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * 页面顶部的悬浮命令条（玻璃材质，居中悬浮在内容之上）。
 * 结构：左侧标题或范围标签（leading）→ 搜索框（可选）→ 右侧动作插槽（children）。
 * 父元素需要是定位容器（relative），命令条以 absolute 悬浮。
 */
export interface CommandBarSearch {
  value: string;
  onChange: (v: string) => void;
  /** 回车提交。 */
  onSubmit: (v: string) => void;
  /** 有值时显示清除按钮。 */
  onClear?: () => void;
  placeholder?: string;
  /** 输入框的无障碍名称，默认“搜索”。 */
  label?: string;
  /** 注册 ⌘K / Ctrl+K 聚焦搜索框，默认 true。 */
  hotkey?: boolean;
}

export interface CommandBarProps {
  /** 左侧标题或范围标签，例如“收藏”分段切换或文件夹名。 */
  leading?: ReactNode;
  search?: CommandBarSearch;
  /** 右侧动作插槽，通常放 CommandButton 与 CommandDivider。 */
  children?: ReactNode;
  className?: string;
  'aria-label'?: string;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function CommandBar({ leading, search, children, className, 'aria-label': ariaLabel = '命令条' }: CommandBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hotkey = search && search.hotkey !== false;

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hotkey]);

  return (
    <div
      role="toolbar"
      aria-label={ariaLabel}
      className={cn(
        'glass absolute top-2.5 left-1/2 z-[6] flex w-[calc(100%-24px)] -translate-x-1/2 items-center gap-1.5 rounded-[calc(var(--r3)+4px)] p-1.5 shadow-[0_18px_40px_-18px_rgba(0,0,0,.55)] md:top-3.5 md:w-[min(760px,calc(100%-140px))]',
        className,
      )}
    >
      {leading}
      {search && (
        <form
          role="search"
          className="group/q flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[var(--r3)] px-3 text-muted focus-within:bg-accent-soft focus-within:shadow-[inset_0_0_0_1.5px_var(--accent)]"
          onSubmit={(e) => {
            e.preventDefault();
            search.onSubmit(search.value.trim());
            inputRef.current?.blur();
          }}
        >
          <Search className="size-[18px] flex-none" strokeWidth={1.7} aria-hidden />
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.currentTarget.blur();
                e.stopPropagation();
              }
            }}
            placeholder={search.placeholder ?? '搜索'}
            aria-label={search.label ?? '搜索'}
            className="h-full min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
            style={{ outline: 'none' }}
          />
          {search.onClear && search.value ? (
            <button
              type="button"
              aria-label="清除搜索"
              onClick={() => {
                search.onClear!();
                inputRef.current?.focus();
              }}
              className="grid size-6 flex-none place-items-center rounded-full text-muted hover:bg-accent-soft hover:text-fg"
            >
              <X className="size-3.5" strokeWidth={2} />
            </button>
          ) : (
            hotkey && (
              <kbd className="ml-auto hidden flex-none rounded-[5px] border border-line-2 px-1.5 py-px font-sans text-[11px] md:inline group-focus-within/q:hidden">
                {isMac ? '⌘K' : 'Ctrl K'}
              </kbd>
            )
          )}
        </form>
      )}
      {children}
    </div>
  );
}

/** 命令条里的分隔线。 */
export function CommandDivider({ className }: { className?: string }) {
  return <span aria-hidden className={cn('h-5 w-px flex-none bg-line-2', className)} />;
}

export interface CommandButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 选中/开启态（强调色底）。 */
  active?: boolean;
  icon?: ReactNode;
}

/** 命令条按钮（原型 `.cb`）。只有图标时务必提供 aria-label。 */
export const CommandButton = forwardRef<HTMLButtonElement, CommandButtonProps>(function CommandButton(
  { active, icon, children, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 flex-none items-center gap-[7px] rounded-[var(--r3)] px-3 text-[13px] whitespace-nowrap text-fg-2 transition-colors hover:bg-accent-soft hover:text-fg disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-[18px] [&_svg]:flex-none',
        active && 'bg-accent text-accent-fg hover:bg-accent hover:text-accent-fg',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});
