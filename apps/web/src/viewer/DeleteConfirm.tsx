import { useEffect, useRef } from 'react';

/**
 * 查看器内的删除确认。放在查看器 <dialog> 内部而不是另开 portal，
 * 保证它始终位于顶层模态之上，并把焦点限制在“取消 / 删除”两个按钮之间。
 */
export function DeleteConfirm({ open, name, pending, error, onCancel, onConfirm }: {
  open: boolean;
  name: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="lv-confirm-scrim"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !pending) onCancel();
      }}
    >
      <div
        className="lv-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="lv-delete-title"
        aria-describedby="lv-delete-desc"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!pending) onCancel();
          } else if (event.key === 'Tab') {
            event.preventDefault();
            event.stopPropagation();
            const next = document.activeElement === cancelRef.current ? confirmRef.current : cancelRef.current;
            next?.focus();
          }
        }}
      >
        <h2 id="lv-delete-title">删除这个文件？</h2>
        <p className="lv-confirm-name">{name}</p>
        <p id="lv-delete-desc">将从磁盘永久删除，无法撤销。原图的缓存会按清理规则回收。</p>
        {error && <p className="lv-confirm-error" role="alert">{error}</p>}
        <div className="lv-confirm-actions">
          <button ref={cancelRef} type="button" className="lv-btn ghost" disabled={pending} onClick={onCancel}>取消</button>
          <button ref={confirmRef} type="button" className="lv-btn danger" disabled={pending} onClick={onConfirm}>
            {pending ? '正在删除…' : '删除文件'}
          </button>
        </div>
      </div>
    </div>
  );
}
