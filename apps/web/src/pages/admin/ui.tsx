/**
 * 控制台共用的展示组件：分区卡片、设置行、分段选择、状态标签、可复制输出框、对话框外壳。
 * 视觉对照原型 .aset / .ash / .srow / .seg / .pill / .chip / .outbox / .modal。
 */
import { useId, useRef, useState, type ReactNode } from 'react';
import { useMutation, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { queryClient } from '@/lib/query';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/kit/dialog';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/kit/alert-dialog';
import { errMsg, type Tone } from './format';

/* ---------- 按钮 ---------- */

type ChipVariant = 'outline' | 'primary' | 'ghost' | 'danger';
export function chipClass(variant: ChipVariant = 'outline', size: 'md' | 'sm' = 'md') {
  return cn(
    'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
    size === 'md' ? 'h-[34px] px-[13px] text-[13px]' : 'h-[30px] px-[11px] text-[12.5px] [&_svg]:size-[15px]',
    variant === 'outline' && 'border border-line-2 text-fg-2 hover:bg-accent-soft hover:text-fg',
    variant === 'primary' && 'bg-accent font-semibold text-accent-fg hover:brightness-110',
    variant === 'ghost' && 'text-fg-2 hover:bg-accent-soft hover:text-fg',
    variant === 'danger' && 'border border-[color-mix(in_oklab,var(--bad)_45%,transparent)] text-bad hover:bg-[color-mix(in_oklab,var(--bad)_14%,transparent)]',
  );
}

export function Chip({ variant, size, className, type = 'button', ...props }: React.ComponentProps<'button'> & { variant?: ChipVariant; size?: 'md' | 'sm' }) {
  return <button type={type} className={cn(chipClass(variant, size), className)} {...props} />;
}

export function IconButton({ label, className, children, ...props }: React.ComponentProps<'button'> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={cn('grid size-8 shrink-0 place-items-center rounded-[var(--r2)] text-fg-2 transition-colors hover:bg-accent-soft hover:text-fg disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4', className)} {...props}>
      {children}
    </button>
  );
}

/* ---------- 输入 ---------- */

export const inputClass = 'h-[34px] w-full min-w-0 rounded-[var(--r2)] border border-line-2 bg-sunken px-2.5 text-[13px] text-fg placeholder:text-muted focus-visible:border-transparent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent disabled:opacity-50 aria-invalid:border-bad';

/* ---------- 版面 ---------- */

export function Section({ title, desc, action, children, className }: { title: ReactNode; desc?: ReactNode; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-[var(--r3)] border border-line bg-surface', className)}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2.5 border-b border-line px-[18px] py-4 last:border-b-0">
        <div className="min-w-0 flex-1 basis-[260px]">
          <h2 className="m-0 text-[15px] font-semibold">{title}</h2>
          {desc && <p className="mt-[3px] mb-0 max-w-[72ch] text-[12.5px] text-muted">{desc}</p>}
        </div>
        {action && <div className="flex flex-wrap gap-2 max-sm:w-full">{action}</div>}
      </div>
      {children}
    </section>
  );
}

export function Panel({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-[var(--r3)] border border-line bg-surface', className)}>
      <div className="flex items-center gap-2.5 border-b border-line px-[18px] py-3.5 font-semibold">
        <h2 className="m-0 text-[14px] font-semibold">{title}</h2>
        {aside && <span className="ml-auto flex items-center gap-1.5 text-[12px] font-normal text-muted">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

/** 设置行：左侧标题与说明，右侧控件；手机宽度上下排列。 */
export function SettingRow({ title, desc, children, htmlFor }: { title: ReactNode; desc?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid grid-cols-1 items-center gap-x-4 gap-y-2.5 border-b border-line px-[18px] py-3.5 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
      <div className="min-w-0">
        {htmlFor ? <label htmlFor={htmlFor} className="block font-medium">{title}</label> : <b className="block font-medium">{title}</b>}
        {desc && <small className="mt-0.5 block text-[12.5px] text-muted">{desc}</small>}
      </div>
      <div className="flex min-w-0 items-center justify-start gap-2.5 md:justify-end">{children}</div>
    </div>
  );
}

export function LiveDot({ tone = 'ok' }: { tone?: Tone }) {
  return (
    <i
      aria-hidden
      className={cn(
        'inline-block size-[7px] shrink-0 rounded-full motion-safe:animate-[luvia-pulse_2s_infinite] [:root[data-reduce-motion=on]_&]:animate-none',
        tone === 'ok' && 'bg-ok [--pulse:var(--ok)]', tone === 'warn' && 'bg-warn [--pulse:var(--warn)]', tone === 'bad' && 'bg-bad [--pulse:var(--bad)]',
        (tone === 'muted' || tone === 'accent') && 'bg-muted [--pulse:var(--muted)]',
      )}
    />
  );
}

const PILL: Record<Tone, string> = {
  accent: 'bg-accent-soft text-fg',
  ok: 'bg-[color-mix(in_oklab,var(--ok)_18%,transparent)] text-ok',
  warn: 'bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] text-warn',
  bad: 'bg-[color-mix(in_oklab,var(--bad)_18%,transparent)] text-bad',
  muted: 'bg-line text-muted',
};
export function Pill({ tone = 'accent', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-[9px] py-[3px] text-[11.5px] leading-tight font-semibold whitespace-nowrap', PILL[tone], className)}>{children}</span>;
}

export function Tag({ children, title }: { children: ReactNode; title?: string }) {
  return <span title={title} className="ml-2 inline-block rounded-full bg-accent-soft px-[7px] py-px align-[1px] text-[11px] whitespace-nowrap text-fg-2">{children}</span>;
}

export function ProgressBar({ value, tone }: { value: number | null; tone?: Tone }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-md bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}>
      <i
        className={cn(
          'block h-full rounded-md transition-[width] duration-700',
          tone === 'ok' ? 'bg-ok' : tone === 'bad' ? 'bg-bad' : tone === 'warn' ? 'bg-warn' : 'bg-accent',
          value == null && 'w-1/3 motion-safe:animate-[luvia-indeterminate_1.6s_ease-in-out_infinite] [:root[data-reduce-motion=on]_&]:animate-none',
        )}
        style={value == null ? undefined : { width: `${value}%` }}
      />
    </div>
  );
}

/** 关键帧（原型 .live 脉冲与不确定进度）；只注入一次。 */
export function AdminKeyframes() {
  return (
    <style>{`
@keyframes luvia-pulse{0%{box-shadow:0 0 0 0 color-mix(in oklab,var(--pulse) 60%,transparent)}70%{box-shadow:0 0 0 8px transparent}100%{box-shadow:0 0 0 0 transparent}}
@keyframes luvia-indeterminate{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
`}</style>
  );
}

/* ---------- 分段选择（单选组，方向键切换） ---------- */

export function Seg<T extends string>({ value, options, onChange, label, className, disabled }: {
  value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; label: string; className?: string; disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    refs.current[n]?.focus();
    onChange(options[n]!.value);
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid min-w-0 auto-cols-fr grid-flow-col gap-[3px] rounded-[calc(var(--r2)+2px)] border border-line bg-sunken p-[3px]', disabled && 'pointer-events-none opacity-50', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn('h-8 min-w-0 truncate rounded-[var(--r2)] px-2 text-[12.5px] text-muted transition-colors', on ? 'bg-raised text-fg shadow-[0_1px_0_var(--line-2),0_0_0_1px_var(--line)]' : 'hover:text-fg')}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- 复制 ---------- */

export async function copyText(text: string, done = '已复制') {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('copy');
    }
    toast.success(done);
  } catch {
    toast.error('浏览器不允许写入剪贴板，请手动选中文本复制');
  }
}

export function OutBox({ children, copy, copyLabel, mono }: { children: ReactNode; copy?: string; copyLabel?: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-h-10 items-center gap-1.5 rounded-[var(--r2)] border border-line bg-sunken py-1 pr-1 pl-3 text-[12.5px] break-all">
      <span className={cn('min-w-0 flex-1 select-all', mono && 'font-mono text-[12px]')}>{children}</span>
      {copy != null && (
        <IconButton
          label={copyLabel ?? '复制'}
          onClick={async () => { await copyText(copy, `已复制 ${copy.length > 40 ? '' : copy}`.trim()); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        >
          {copied ? <Check /> : <Copy />}
        </IconButton>
      )}
    </div>
  );
}

export function CodeBlock({ children }: { children: string }) {
  return <pre className="m-0 mt-2 overflow-auto rounded-[var(--r2)] border border-line bg-sunken px-3 py-2.5 font-mono text-[12px] whitespace-pre text-fg-2">{children}</pre>;
}

/* ---------- 对话框 ---------- */

export function Modal({ open, onOpenChange, title, desc, children, footer, wide }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; desc?: ReactNode; children?: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn('flex max-h-[86dvh] flex-col gap-0 overflow-hidden rounded-[calc(var(--r3)+2px)] border border-line-2 bg-raised p-0 shadow-[0_40px_80px_-24px_rgba(0,0,0,.6)] ring-0', wide ? 'sm:max-w-[640px]' : 'sm:max-w-[520px]')}
      >
        <div className="flex items-start gap-3 px-[22px] pt-[22px]">
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[17px] leading-snug font-semibold">{title}</DialogTitle>
            {desc && <DialogDescription className="mt-1 text-[13px] break-words text-muted">{desc}</DialogDescription>}
          </div>
          <DialogClose render={<IconButton label="关闭" className="-mt-1 -mr-2" />}><X /></DialogClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pt-4 pb-1">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 px-[22px] pt-4 pb-[22px]">{footer}</div>}
        {!footer && <div className="h-[22px]" />}
      </DialogContent>
    </Dialog>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-[12.5px] font-semibold text-fg-2">{label}</label>
      {children}
      {hint && <small className="text-[12px] text-muted">{hint}</small>}
    </div>
  );
}

/** 不可撤回或有风险操作的确认框。 */
export function Confirm({ open, onOpenChange, title, desc, action, onConfirm, pending, danger = true }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; desc: ReactNode; action: string; onConfirm: () => void; pending?: boolean; danger?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="rounded-[calc(var(--r3)+2px)] border border-line-2 bg-raised p-[22px] ring-0 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-[440px]">
        <AlertDialogHeader className="place-items-start text-left">
          <AlertDialogTitle className="text-[17px] font-semibold">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-left text-[13px] text-muted">{desc}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mx-0 mb-0 flex-row justify-end gap-2 border-0 bg-transparent p-0 pt-2">
          <AlertDialogCancel render={<Chip />}>取消</AlertDialogCancel>
          <Chip variant={danger ? 'danger' : 'primary'} disabled={pending} onClick={onConfirm}>{pending ? '正在处理…' : action}</Chip>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ---------- 保存操作 ---------- */

/**
 * 包装一次写操作：成功 toast 并失效相关查询，失败 toast 显示服务端说明。
 * success 可以是函数，按返回值生成文案。
 */
export function useSave<TVars, TData>(opts: {
  fn: (v: TVars) => Promise<TData>;
  success?: string | ((d: TData, v: TVars) => string | null);
  invalidate?: QueryKey[];
  onSuccess?: (d: TData, v: TVars) => void;
  errorPrefix?: string;
}) {
  return useMutation({
    mutationFn: opts.fn,
    onSuccess: async (d, v) => {
      const msg = typeof opts.success === 'function' ? opts.success(d, v) : opts.success;
      if (msg) toast.success(msg);
      opts.onSuccess?.(d, v);
      await Promise.all((opts.invalidate ?? []).map((k) => queryClient.invalidateQueries({ queryKey: k })));
    },
    onError: (e) => { toast.error(opts.errorPrefix ? `${opts.errorPrefix}：${errMsg(e)}` : errMsg(e)); },
  });
}

export function useFieldId(prefix: string) {
  return `${prefix}-${useId().replace(/:/g, '')}`;
}

/** 加载、错误与空状态。 */
export function QueryState({ loading, error, onRetry, children }: { loading?: boolean; error?: unknown; onRetry?: () => void; children?: ReactNode }) {
  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 px-[18px] py-4 text-[13px] text-fg-2">
        <span className="text-bad">{errMsg(error)}</span>
        {onRetry && <Chip size="sm" onClick={onRetry}>重新加载</Chip>}
      </div>
    );
  }
  if (loading) return <div className="px-[18px] py-4 text-[13px] text-muted">正在加载…</div>;
  return <>{children}</>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-[18px] py-4 text-[13px] text-muted">{children}</div>;
}
