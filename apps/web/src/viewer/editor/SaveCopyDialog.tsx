import { useEffect, useState } from 'react';

/** 保存副本的命名确认；不覆盖原图，重名时后端会自动追加序号。 */
export function SaveCopyDialog({ open, defaultName, pending, error, onCancel, onSave }: {
  open: boolean;
  defaultName: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  useEffect(() => { if (open) setName(defaultName); }, [open, defaultName]);
  if (!open) return null;
  const submit = () => {
    const value = name.trim();
    if (value && !pending) onSave(value);
  };
  return (
    <div className="lv-confirm-scrim" onPointerDown={(event) => {
      if (event.target === event.currentTarget && !pending) onCancel();
    }}>
      <form
        className="lv-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lv-save-title"
        onSubmit={(event) => { event.preventDefault(); submit(); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!pending) onCancel(); }
        }}
      >
        <h2 id="lv-save-title">保存副本</h2>
        <label className="lv-confirm-field">
          <span>文件名</span>
          <input
            className="lv-confirm-input"
            value={name}
            autoFocus
            disabled={pending}
            onChange={(event) => setName(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <p>副本会保存到同一文件夹，原图不会被修改。同名文件会自动追加序号。</p>
        {error && <p className="lv-confirm-error" role="alert">{error}</p>}
        <div className="lv-confirm-actions">
          <button type="button" className="lv-btn ghost" disabled={pending} onClick={onCancel}>取消</button>
          <button type="submit" className="lv-btn" disabled={pending || !name.trim()}>{pending ? '正在保存…' : '保存副本'}</button>
        </div>
      </form>
    </div>
  );
}
