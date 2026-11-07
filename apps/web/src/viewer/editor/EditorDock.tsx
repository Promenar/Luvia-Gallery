import type { ReactNode } from 'react';
import { Eraser, RotateCcw, Save, Trash2, Undo2, X } from 'lucide-react';
import type { EditorJob, EditorModel, EditorModelId } from '@luvia/contracts';
import { cn } from '@/lib/cn';
import './editor.css';

const MODEL_LABEL: Record<EditorModelId, string> = { migan: 'MI-GAN', lama: 'LaMa', slbr: 'SLBR' };

export type EditorDockProps = {
  models: EditorModel[];
  model: EditorModelId;
  onModel: (id: EditorModelId) => void;
  brush: number;
  onBrush: (value: number) => void;
  erase: boolean;
  onErase: (value: boolean) => void;
  hasMask: boolean;
  onUndo: () => void;
  onClear: () => void;
  job: EditorJob | null;
  createPending: boolean;
  error: string | null;
  canGenerate: boolean;
  generateHint: string | null;
  onGenerate: () => void;
  onCancel: () => void;
  onReset: () => void;
  onSave: () => void;
  onCompare: (down: boolean) => void;
  comparing: boolean;
  /** 已保存/已导入的结果名；用于把“未保存”改成明确的结果。 */
  savedName: string | null;
  /** 结果动作的文案与图标（查看器为保存副本，独立页为导入媒体库）。 */
  resultActionLabel?: string;
  resultActionIcon?: ReactNode;
  unsavedText?: string;
  savedText?: string;
  writeAvailable: boolean;
  writeReason: string | null;
  /** 独立页没有查看器可退出，可隐藏“完成”。 */
  showDone?: boolean;
  onDone?: () => void;
};

/** 查看器底部的修复工具栏：蒙版工具、模型、作业状态与保存副本。 */
export function EditorDock(props: EditorDockProps) {
  const { job, createPending } = props;
  const busy = createPending || job?.status === 'queued' || job?.status === 'running';
  const done = job?.status === 'succeeded';
  const progress = createPending ? 0 : Math.max(0, Math.min(1, job?.progress ?? 0));
  const stage = createPending ? '正在提交作业' : job?.status === 'queued' ? '排队中' : job?.stage ?? '正在推理';
  const resultText = props.savedName
    ? props.savedText ?? `已保存 ${props.savedName}`
    : props.unsavedText ?? '修复预览 · 未保存';

  return (
    <div className="lv-editor" role="toolbar" aria-label="图像修复工具栏">
      {(busy || done) && (
        <div className={cn('lv-ed-progress', (createPending || job?.status === 'queued') && 'indeterminate')} aria-hidden>
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}

      {busy ? (
        <div className="lv-ed-row lv-ed-status">
          <span className="lv-ed-dot" aria-hidden />
          <span className="lv-ed-stage">{stage}</span>
          <span className="lv-ed-pct" aria-hidden>{Math.round(progress * 100)}%</span>
          <button type="button" className="lv-ed-tool" onClick={props.onCancel}><X />取消</button>
        </div>
      ) : done ? (
        <div className="lv-ed-row">
          <span className="lv-ed-result"><i aria-hidden />{resultText}</span>
          <button type="button" className="lv-ed-primary" disabled={!props.writeAvailable} title={props.writeReason ?? undefined} onClick={props.onSave}>
            {props.resultActionIcon ?? <Save />}{props.resultActionLabel ?? '保存副本'}
          </button>
          <button type="button" className="lv-ed-tool" onClick={props.onReset}><RotateCcw />重新生成</button>
          <button
            type="button"
            className={cn('lv-ed-tool', props.comparing && 'on')}
            aria-pressed={props.comparing}
            onPointerDown={() => props.onCompare(true)}
            onPointerUp={() => props.onCompare(false)}
            onPointerLeave={() => props.onCompare(false)}
            onPointerCancel={() => props.onCompare(false)}
          >
            {props.comparing ? '正在看原图' : '按住对比'}
          </button>
          {props.showDone !== false && props.onDone && (
            <button type="button" className="lv-ed-tool" onClick={props.onDone}>完成</button>
          )}
        </div>
      ) : (
        <div className="lv-ed-row">
          <div className="lv-ed-models" role="radiogroup" aria-label="修复模型">
            {props.models.length ? props.models.map((model) => {
              const on = model.id === props.model;
              return (
                <button
                  key={model.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={!model.available}
                  title={model.available ? undefined : model.reason ?? '该模型不可用'}
                  className={on ? 'on' : undefined}
                  onClick={() => props.onModel(model.id)}
                >
                  {MODEL_LABEL[model.id]}
                </button>
              );
            }) : <span className="lv-ed-wait">正在检测模型…</span>}
          </div>
          <span className="lv-vsep" aria-hidden />
          <label className="lv-ed-brush">
            <span>笔刷</span>
            <input
              type="range"
              min={6}
              max={56}
              step={2}
              value={props.brush}
              aria-label="笔刷大小"
              onChange={(event) => props.onBrush(Number(event.target.value))}
            />
            <output>{props.brush}</output>
          </label>
          <button
            type="button"
            className={cn('lv-ed-tool', props.erase && 'on')}
            aria-pressed={props.erase}
            title={props.erase ? '切回涂抹' : '擦除蒙版'}
            onClick={() => props.onErase(!props.erase)}
          >
            <Eraser />擦除
          </button>
          <button type="button" className="lv-ed-tool" disabled={!props.hasMask} onClick={props.onUndo}><Undo2 />撤销</button>
          <button type="button" className="lv-ed-tool" disabled={!props.hasMask} onClick={props.onClear}><Trash2 />清除</button>
          <button
            type="button"
            className="lv-ed-primary"
            disabled={!props.hasMask || !props.canGenerate || props.createPending}
            title={props.generateHint ?? undefined}
            onClick={props.onGenerate}
          >
            {props.createPending ? '正在提交…' : '生成预览'}
          </button>
        </div>
      )}

      {props.error && <p className="lv-ed-error" role="alert">{props.error}</p>}
    </div>
  );
}
