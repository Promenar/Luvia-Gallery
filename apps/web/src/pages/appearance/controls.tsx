import { useId } from 'react';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { Switch } from '@/components/kit/switch';
import { cn } from '@/lib/cn';

/** 设置项：标题 + 控件。标题通过 labelId 关联到控件。 */
export function Field({ label, children, hint }: { label: string; hint?: string; children: (labelId: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="mt-[18px]">
      <div id={id} className="mb-2 text-[12.5px] font-semibold text-fg-2">{label}</div>
      {children(id)}
      {hint && <p className="mt-1.5 mb-0 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** 分段选择（单选），键盘左右方向键切换。 */
export function Seg<T extends string>({ value, options, onChange, labelledBy }: {
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  labelledBy: string;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as T)}
      aria-labelledby={labelledBy}
      className="grid auto-cols-fr grid-flow-col gap-[3px] rounded-[calc(var(--r2)+2px)] border border-line bg-sunken p-[3px]"
    >
      {options.map((o) => (
        <Radio.Root
          key={o.value}
          value={o.value}
          className="inline-flex h-8 min-w-0 items-center justify-center rounded-[var(--r2)] px-1 text-[12.5px] whitespace-nowrap text-muted hover:text-fg data-[checked]:bg-raised data-[checked]:text-fg data-[checked]:shadow-[0_1px_0_var(--line-2),0_0_0_1px_var(--line)]"
        >
          {o.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

/** 开关行：左侧说明，右侧开关。 */
export function SwitchRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="mt-[18px]">
      <div className="flex items-center justify-between gap-2.5 text-[13px] text-fg-2">
        <label htmlFor={id} className="cursor-pointer">{label}</label>
        <Switch id={id} checked={checked} onCheckedChange={(v) => onChange(v)} />
      </div>
      {hint && <p className="mt-1 mb-0 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** 分组标题。 */
export function Group({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('mt-6 border-t border-line pt-4 first-of-type:mt-2 first-of-type:border-t-0 first-of-type:pt-0', className)} aria-label={title}>
      <h3 className="m-0 text-[13px] font-semibold tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}
