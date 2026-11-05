import { useLayoutEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './icons';

export type MenuAction = 'copy' | 'link' | 'path' | 'download' | 'open' | 'reveal' | 'hero' | 'pixels';

interface Entry { a: MenuAction; icon: IconName; label: string; kbd?: string }

/** 右键菜单（原型 #ctx）。方向键/Home/End 移动，Enter 执行，Esc 或 Tab 关闭。 */
export function ContextMenu({ x, y, video, onAction, onClose }: {
  x: number;
  y: number;
  video: boolean;
  onAction: (a: MenuAction) => void;
  onClose: (restoreFocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const groups: Entry[][] = [
    [
      { a: 'copy', icon: 'copy', label: video ? '复制当前画面' : '复制图片', kbd: '⌘C' },
      { a: 'link', icon: 'link', label: '复制原图链接' },
      { a: 'path', icon: 'path', label: '复制文件路径' },
      { a: 'download', icon: 'download', label: '下载原图' },
      { a: 'open', icon: 'open', label: '在新标签页打开' },
    ],
    [
      { a: 'reveal', icon: 'folder', label: '在文件夹中显示' },
      { a: 'hero', icon: 'hero', label: '把所在文件夹设为首页轮播' },
    ],
    ...(video ? [] : [[{ a: 'pixels', icon: 'pixels', label: '查看原始像素', kbd: '1' } as Entry]]),
  ];

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setPos({ left: Math.max(8, Math.min(x, innerWidth - w - 8)), top: Math.max(8, Math.min(y, innerHeight - h - 8)) });
    el.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [x, y]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); return; }
    else if (e.key === 'Tab') { e.preventDefault(); onClose(true); return; }
    if (next >= 0) { e.preventDefault(); e.stopPropagation(); items[next]?.focus(); }
    // 其余按键（包括 ⌘C、空格）不交给查看器的全局快捷键
    if (e.key !== 'Enter' && e.key !== ' ') e.stopPropagation();
  };

  return (
    <div ref={ref} className="lv-menu" role="menu" aria-label="图片操作" style={pos} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {groups.map((g, gi) => (
        <div key={gi} role="none">
          {gi > 0 && <hr />}
          {g.map((it) => (
            <button
              key={it.a}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onPointerMove={(e) => e.currentTarget.focus({ preventScroll: true })}
              onClick={() => { onClose(false); onAction(it.a); }}
            >
              <Icon name={it.icon} />{it.label}{it.kbd && <kbd>{it.kbd}</kbd>}
            </button>
          ))}
        </div>
      ))}
      <div className="hint" role="none">按住 Shift 再右键，可打开浏览器自带菜单</div>
    </div>
  );
}
