import { useEffect, useState } from 'react';

/** 选择保存方式；覆盖原图需要单独确认。 */
export function SaveCopyDialog({ open, defaultName, originalName, canReplace, replaceReason, pending, error, onCancel, onSave, onReplace }: {
  open: boolean;
  defaultName: string;
  originalName: string;
  canReplace: boolean;
  replaceReason?: string | null;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (name: string) => void;
  onReplace: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [mode, setMode] = useState<'copy' | 'replace'>('copy');
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { if (open) { setName(defaultName); setMode('copy'); setConfirmed(false); } }, [open, defaultName]);
  if (!open) return null;
  const submit = () => {
    const value = name.trim();
    if (pending) return;
    if (mode === 'replace') { if (canReplace && confirmed) onReplace(); }
    else if (value) onSave(value);
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
        <h2 id="lv-save-title">保存修复结果</h2>
        <div className="lv-save-modes" role="radiogroup" aria-label="保存方式">
          <label><input type="radio" name="save-mode" checked={mode === 'copy'} disabled={pending} onChange={() => setMode('copy')} />保存副本</label>
          <label><input type="radio" name="save-mode" checked={mode === 'replace'} disabled={pending || !canReplace} onChange={() => setMode('replace')} />覆盖原图</label>
        </div>
        {mode === 'copy' ? <><label className="lv-confirm-field">
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
        <p>副本会保存到同一文件夹，原图不会被修改。同名文件会自动追加序号。</p></> : <>
          <p>将用修复结果覆盖「{originalName}」，并更新媒体库和缩略图。此操作不可撤销；图片会按原格式重新编码，文件系统扩展属性可能变化。</p>
          <label className="lv-save-confirm"><input type="checkbox" checked={confirmed} disabled={pending} onChange={(event) => setConfirmed(event.target.checked)} />我确认覆盖原图</label>
        </>}
        {!canReplace && <p>{replaceReason || '覆盖仅支持可写媒体库中的单帧 JPEG、PNG 或 WebP 图片。'}</p>}
        {error && <p className="lv-confirm-error" role="alert">{error}</p>}
        <div className="lv-confirm-actions">
          <button type="button" className="lv-btn ghost" disabled={pending} onClick={onCancel}>取消</button>
          <button type="submit" className={mode === 'replace' ? 'lv-btn danger' : 'lv-btn'} disabled={pending || (mode === 'copy' ? !name.trim() : !confirmed)}>{pending ? '正在保存…' : mode === 'copy' ? '保存副本' : '确认覆盖'}</button>
        </div>
      </form>
    </div>
  );
}
