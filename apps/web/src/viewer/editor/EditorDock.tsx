import type { ReactNode } from 'react';
import { Eraser, RotateCcw, Save, Trash2, Undo2 } from 'lucide-react';
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
  onAuto?: () => void;
  canAuto?: boolean;
  onAdjust?: () => void;
  adjusting?: boolean;
  onContinue?: () => void;
  continuing?: boolean;
  onCancelAdjust?: () => void;
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
  const done = !busy && job?.status === 'succeeded';
  const indeterminate = createPending || job?.status === 'queued';
  const progress = Math.round(Math.max(0, Math.min(1, job?.progress ?? 0)) * 100);
  const stage = createPending ? '正在提交作业' : job?.status === 'queued' ? '排队中' : job?.stage ?? '正在推理';
  const resultText = props.savedName
    ? props.savedText ?? `已保存 ${props.savedName}`
    : props.unsavedText ?? '修复预览 · 未保存';

  return (
    <div className="lv-editor" role="toolbar" aria-label="图像修复工具栏">
      {(busy || done) && (
        <div className={cn('lv-ed-progress', indeterminate && 'indeterminate')}
          role={busy ? 'progressbar' : undefined} aria-label={busy ? stage : undefined}
          aria-valuenow={busy && !indeterminate ? progress : undefined} aria-hidden={busy ? undefined : true}>
          <i style={{ width: `${progress}%` }} />
        </div>
      )}

      {done && job?.outcome === 'no_detection' ? (
        <div className="lv-ed-row">
          <span className="lv-ed-result">未检测到水印</span>
          <button type="button" className="lv-ed-tool" onClick={props.onReset}>手动涂抹</button>
        </div>
      ) : done ? (
        <div className="lv-ed-row">
          <span className="lv-ed-result"><i aria-hidden />{resultText}</span>
          {job?.resultUrl && props.onContinue && <button type="button" className="lv-ed-tool" onClick={props.onContinue}>继续修复</button>}
          <button type="button" className="lv-ed-tool" onClick={props.onReset}><RotateCcw />重新生成</button>
          {job?.maskUrl && props.onAdjust && <button type="button" className="lv-ed-tool" onClick={props.onAdjust}>调整蒙版</button>}
          <button
            type="button"
            className={cn('lv-ed-tool', props.comparing && 'on')}
            aria-pressed={props.comparing}
            onPointerDown={() => props.onCompare(true)}
            onPointerUp={() => props.onCompare(false)}
            onPointerLeave={() => props.onCompare(false)}
            onPointerCancel={() => props.onCompare(false)}
            onKeyDown={(event) => {
              if (event.key !== ' ' && event.key !== 'Enter') return;
              event.preventDefault();
              if (!event.repeat) props.onCompare(true);
            }}
            onKeyUp={(event) => {
              if (event.key !== ' ' && event.key !== 'Enter') return;
              event.preventDefault();
              props.onCompare(false);
            }}
            onBlur={() => { if (props.comparing) props.onCompare(false); }}
          >
            {props.comparing ? '正在看原图' : '按住对比'}
          </button>
          {props.showDone !== false && props.onDone && (
            <button type="button" className="lv-ed-tool" onClick={props.onDone}>完成</button>
          )}
          <button type="button" className="lv-ed-primary" disabled={!props.writeAvailable} title={props.writeReason ?? undefined} onClick={props.onSave}>
            {props.resultActionIcon ?? <Save />}{props.resultActionLabel ?? '保存副本'}
          </button>
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
                  disabled={busy || !model.available}
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
              className="luvia-range"
              disabled={busy}
              aria-label="笔刷大小"
              onChange={(event) => props.onBrush(Number(event.target.value))}
            />
            <output>{props.brush}</output>
          </label>
          <button
            type="button"
            className={cn('lv-ed-tool', props.erase && 'on')}
            aria-pressed={props.erase}
            disabled={busy}
            title={props.erase ? '切回涂抹' : '擦除蒙版'}
            onClick={() => props.onErase(!props.erase)}
          >
            <Eraser />擦除
          </button>
          <button type="button" className="lv-ed-tool" disabled={busy || !props.hasMask} onClick={props.onUndo}><Undo2 />撤销</button>
          <button type="button" className="lv-ed-tool" disabled={busy || !props.hasMask} onClick={props.onClear}><Trash2 />清除</button>
          {(props.adjusting || props.continuing) && props.onCancelAdjust && <button type="button" className="lv-ed-tool" disabled={busy} onClick={props.onCancelAdjust}>返回预览</button>}
          {props.onAuto && !props.adjusting && !props.continuing && (
            <button type="button" className="lv-ed-tool" disabled={busy || !props.canAuto} onClick={props.onAuto}>SLBR 自动修复</button>
          )}
          <button
            type="button"
            className="lv-ed-primary lv-ed-generate"
            disabled={!busy && (!props.hasMask || !props.canGenerate)}
            aria-disabled={createPending || undefined}
            title={busy ? stage : props.generateHint ?? undefined}
            onClick={busy ? (createPending ? undefined : props.onCancel) : props.onGenerate}
          >
            {busy ? <>取消{!indeterminate && <span aria-hidden className="lv-ed-pct">{progress}%</span>}</>
              : props.adjusting ? '应用蒙版' : '生成预览'}
          </button>
        </div>
      )}

      {props.error && <p className="lv-ed-error" role="alert">{props.error}</p>}
    </div>
  );
}
