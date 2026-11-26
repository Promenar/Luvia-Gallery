import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Radio } from '@base-ui/react/radio';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import type { Preferences, PreferencesPatch } from '@luvia/contracts';
import { cn } from '@/lib/cn';
import { useStudio } from '@/shell/AppShell';
import { usePreferences, useUpdatePreferences } from '@/stores/session';
import { BASES } from '@/theme/engine';
import { HeroSourcePicker } from '@/pages/memories/HeroSourcePicker';
import { Field, Group, Seg, SwitchRow } from './controls';
import {
  ACCENT_KEYS, accentKeyOf, accentName, accentSwatch, BACKDROP_OPTIONS, baseSwatch, clampInterval, DEFAULT_CUSTOM, DENSITY_LABELS,
  GRID_OPTIONS, INTERVAL_MAX, INTERVAL_MIN, INTERVAL_PRESETS, MODE_OPTIONS, ORDER_OPTIONS, RADIUS_OPTIONS, REDUCE_OPTIONS, START_OPTIONS,
  STYLE_OPTIONS, type AccentKey,
} from './studio';

function useSave() {
  const m = useUpdatePreferences();
  return (patch: PreferencesPatch) => m.mutate(patch, { onError: (e) => toast.error(`设置没有保存：${e.message}。已恢复为原来的设置。`) });
}

/** 一级皮肤可视化选择卡：内置微缩版式预览，点击全站实时切换。 */
function SkinPicker({ value, onChange, labelledBy }: {
  value: Preferences['theme']['style'];
  onChange: (v: Preferences['theme']['style']) => void;
  labelledBy: string;
}) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(v) => onChange(v as Preferences['theme']['style'])}
      aria-labelledby={labelledBy}
      className="grid grid-cols-2 gap-2.5"
    >
      {STYLE_OPTIONS.map((opt) => {
        const isCinema = opt.value === 'cinema';
        const active = value === opt.value;
        return (
          <Radio.Root
            key={opt.value}
            value={opt.value}
            className={cn(
              'group/skin relative flex flex-col overflow-hidden rounded-[var(--r2)] border border-line-2 bg-sunken text-left transition-all hover:border-fg/35',
              active && 'border-accent ring-1 ring-accent',
            )}
          >
            {/* 皮肤视觉微缩预览 */}
            <div
              aria-hidden
              className="relative h-[68px] w-full overflow-hidden border-b border-line p-2"
              style={{
                background: isCinema
                  ? 'radial-gradient(circle at 22% 18%, rgb(86 140 245 / 0.42), transparent 58%), radial-gradient(circle at 85% 85%, rgb(218 120 72 / 0.34), transparent 55%), #0c0e15'
                  : '#171512',
              }}
            >
              {isCinema ? (
                <div className="flex h-full items-center gap-2">
                  <div className="flex h-10 w-3 flex-col items-center justify-center gap-1 rounded-full border border-white/20 bg-white/10">
                    <span className="size-1.5 rounded-full bg-sky-400" />
                    <span className="size-1 rounded-full bg-white/40" />
                    <span className="size-1 rounded-full bg-white/40" />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="h-2.5 w-16 rounded-full border border-white/15 bg-white/12" />
                    <div className="flex h-8 gap-1.5">
                      <div className="flex-1 rounded-lg border border-white/15 bg-white/10" />
                      <div className="w-4 rounded-lg border border-white/12 bg-white/8" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full gap-2">
                  <div className="flex w-7 flex-col gap-1 border-r border-stone-500/25 pr-1.5">
                    <div className="h-1.5 w-4 rounded-xs bg-amber-200/80" />
                    <div className="mt-1 h-1 w-full rounded-xs bg-stone-400/50" />
                    <div className="h-1 w-3/4 rounded-xs bg-stone-500/40" />
                  </div>
                  <div className="grid flex-1 grid-cols-2 gap-1.5">
                    <div className="rounded-[2px] border border-stone-500/30 bg-[#23201c] p-1">
                      <div className="h-full w-full rounded-[1px] bg-stone-400/35" />
                    </div>
                    <div className="rounded-[2px] border border-stone-500/30 bg-[#23201c] p-1">
                      <div className="h-full w-full rounded-[1px] bg-amber-200/25" />
                    </div>
                  </div>
                </div>
              )}
              {active && (
                <span className="absolute top-1.5 right-1.5 grid size-4 place-items-center rounded-full bg-accent text-accent-fg">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
              )}
            </div>
            <div className="px-2.5 py-2">
              <div className="text-[12.5px] font-semibold text-fg">{opt.label}</div>
              <div className="mt-0.5 line-clamp-1 text-[10.5px] text-muted">{opt.desc}</div>
            </div>
          </Radio.Root>
        );
      })}
    </RadioGroup>
  );
}

/** 底色家族：四个色块。 */
function BasePicker({ value, onChange, labelledBy }: { value: keyof typeof BASES; onChange: (v: keyof typeof BASES) => void; labelledBy: string }) {
  return (
    <RadioGroup value={value} onValueChange={(v) => onChange(v as keyof typeof BASES)} aria-labelledby={labelledBy} className="grid grid-cols-4 gap-2">
      {(Object.keys(BASES) as (keyof typeof BASES)[]).map((k) => (
        <Radio.Root
          key={k}
          value={k}
          className="overflow-hidden rounded-[var(--r2)] border border-line-2 text-left text-[11.5px] data-[checked]:outline-2 data-[checked]:outline-offset-1 data-[checked]:outline-accent"
        >
          <i aria-hidden className="block h-10" style={{ background: baseSwatch(k) }} />
          <span className="block bg-surface px-[7px] py-[5px] text-fg-2">{BASES[k].name}</span>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

/** 强调色：随照片、无彩、7 个预设与自定义取色。 */
function AccentPicker({ accent, onChange, labelledBy }: { accent: string; onChange: (accent: string) => void; labelledBy: string }) {
  const key = accentKeyOf(accent);
  const [custom, setCustom] = useState(accent.startsWith('#') ? accent : DEFAULT_CUSTOM);
  const colorRef = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (accent.startsWith('#')) setCustom(accent); }, [accent]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // 拖动取色器时连续触发，合并为一次保存
  const pickCustom = (hex: string) => {
    setCustom(hex);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(hex), 200);
  };
  const select = (k: AccentKey) => {
    if (k === 'custom') { onChange(custom); return; }
    onChange(k);
  };

  return (
    <div>
      <RadioGroup value={key} onValueChange={(v) => select(v as AccentKey)} aria-labelledby={labelledBy} className="grid grid-cols-5 gap-x-2.5 gap-y-3">
        {ACCENT_KEYS.map((k) => (
          <Radio.Root
            key={k}
            value={k}
            onClick={() => { if (k === 'custom') colorRef.current?.click(); }}
            className="group/acc flex min-w-0 flex-col items-center gap-[5px] text-[11px] text-muted data-[checked]:text-fg"
          >
            <i
              aria-hidden
              className="block size-[34px] rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,.18)] group-data-[checked]/acc:outline-2 group-data-[checked]/acc:outline-offset-[3px] group-data-[checked]/acc:outline-fg"
              style={{ background: accentSwatch(k, custom) }}
            />
            <span className="max-w-full truncate">{accentName(k)}</span>
          </Radio.Root>
        ))}
      </RadioGroup>
      <label className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span>自定义颜色</span>
        <input
          ref={colorRef}
          type="color"
          value={custom}
          onChange={(e) => pickCustom(e.target.value)}
          className="h-7 w-10 cursor-pointer rounded-md border border-line-2 bg-transparent p-0.5"
        />
        <span className="font-mono text-[11px]">{custom.toUpperCase()}</span>
      </label>
    </div>
  );
}

/** 幻灯片间隔：常用档位 + 自定义秒数。 */
function IntervalField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = clampInterval(text);
    if (v == null) { setText(String(value)); return; }
    setText(String(v));
    if (v !== value) onChange(v);
  };
  const preset = (INTERVAL_PRESETS as readonly number[]).includes(value) ? String(value) : null;
  return (
    <Field label="每张停留" hint={`图片按此间隔切换，视频播放完再切换。可填 ${INTERVAL_MIN}–${INTERVAL_MAX} 秒。`}>
      {(id) => (
        <div className="grid gap-2">
          <Seg labelledBy={id} value={preset} onChange={(v) => onChange(Number(v))} options={INTERVAL_PRESETS.map((s) => ({ value: String(s), label: `${s} 秒` }))} />
          <label className="flex items-center gap-2 text-xs text-muted">
            其他时长
            <input
              type="number"
              inputMode="numeric"
              min={INTERVAL_MIN}
              max={INTERVAL_MAX}
              step={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
              className="h-8 w-[72px] rounded-[var(--r2)] border border-line-2 bg-sunken px-2 text-[13px] text-fg"
            />
            秒
          </label>
        </div>
      )}
    </Field>
  );
}

/** 外观工坊：右侧抽屉（手机为底部抽屉），所有改动即时生效并按账号保存。 */
export function AppearanceStudio() {
  const open = useStudio((s) => s.open);
  const setOpen = useStudio((s) => s.setOpen);
  const prefs = usePreferences();
  const save = useSave();
  const theme = (patch: NonNullable<PreferencesPatch['theme']>) => save({ theme: patch });
  const slideshow = (patch: NonNullable<PreferencesPatch['slideshow']>) => save({ slideshow: patch });

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/15 backdrop-blur-[4px] transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 max-md:bg-scrim" />
        <Dialog.Popup
          className={cn(
            'glass fixed top-3.5 right-3.5 bottom-3.5 z-50 w-[356px] overflow-auto overscroll-contain rounded-[calc(var(--r3)+4px)] px-[18px] pt-[18px] pb-[22px] text-fg outline-none',
            'transition-transform duration-[380ms] ease-[var(--ease-cinema)] data-[ending-style]:translate-x-[calc(100%+30px)] data-[starting-style]:translate-x-[calc(100%+30px)]',
            'max-md:top-auto max-md:right-2 max-md:bottom-2 max-md:left-2 max-md:max-h-[82vh] max-md:w-auto max-md:pb-[calc(22px+env(safe-area-inset-bottom))]',
            'max-md:data-[ending-style]:translate-x-0 max-md:data-[ending-style]:translate-y-[calc(100%+30px)] max-md:data-[starting-style]:translate-x-0 max-md:data-[starting-style]:translate-y-[calc(100%+30px)]',
          )}
        >
          <header className="mb-1.5 flex items-center gap-2">
            <Dialog.Title className="m-0 flex-1 text-[17px] font-semibold">外观工坊</Dialog.Title>
            <Dialog.Close aria-label="关闭外观设置" className="grid size-9 place-items-center rounded-full text-fg hover:bg-accent-soft">
              <X className="size-[18px]" strokeWidth={1.7} />
            </Dialog.Close>
          </header>
          <Dialog.Description className="m-0 mb-3.5 text-[12.5px] text-muted">
            双皮肤与全部视觉参数均即时生效并按账号持久化。
          </Dialog.Description>

          <Group title="视觉皮肤">
            <Field label="界面气质">
              {(id) => <SkinPicker labelledBy={id} value={prefs.theme.style ?? 'cinema'} onChange={(style) => theme({ style })} />}
            </Field>
          </Group>

          <Group title="主题">
            <Field label="模式">{(id) => <Seg labelledBy={id} value={prefs.theme.mode} options={MODE_OPTIONS} onChange={(mode) => theme({ mode })} />}</Field>
            <Field label="底色">{(id) => <BasePicker labelledBy={id} value={prefs.theme.base} onChange={(base) => theme({ base })} />}</Field>
            <Field label="强调色">{(id) => <AccentPicker labelledBy={id} accent={prefs.theme.accent} onChange={(accent) => theme({ accent })} />}</Field>
            <Field label="圆角">{(id) => <Seg labelledBy={id} value={prefs.theme.radius} options={RADIUS_OPTIONS} onChange={(radius) => theme({ radius })} />}</Field>
            <Field label="查看器背景">{(id) => <Seg labelledBy={id} value={prefs.theme.viewerBackdrop} options={BACKDROP_OPTIONS} onChange={(viewerBackdrop) => theme({ viewerBackdrop })} />}</Field>
          </Group>

          <Group title="网格">
            <Field label="照片排列">{(id) => <Seg labelledBy={id} value={prefs.gridStyle} options={GRID_OPTIONS} onChange={(gridStyle) => save({ gridStyle })} />}</Field>
            <Field label="密度">
              {(id) => (
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={prefs.density}
                    aria-labelledby={id}
                    aria-valuetext={DENSITY_LABELS[prefs.density]}
                    onChange={(e) => { const density = Number(e.target.value); if (density !== prefs.density) save({ density }); }}
                    className="luvia-range min-w-0 flex-1"
                  />
                  <span className="w-8 shrink-0 text-right text-xs text-muted">{DENSITY_LABELS[prefs.density]}</span>
                </div>
              )}
            </Field>
            <SwitchRow label="悬停时预览视频" checked={prefs.hoverPreview} onChange={(hoverPreview) => save({ hoverPreview })} />
            <Field label="减少动态效果" hint="开启后关闭过渡动画、缓慢推近和首页自动轮播。">
              {(id) => <Seg labelledBy={id} value={prefs.reduceMotion} options={REDUCE_OPTIONS} onChange={(reduceMotion) => save({ reduceMotion })} />}
            </Field>
          </Group>

          <Group title="幻灯片">
            <IntervalField value={prefs.slideshow.intervalSec} onChange={(intervalSec) => slideshow({ intervalSec })} />
            <Field label="顺序">{(id) => <Seg labelledBy={id} value={prefs.slideshow.order} options={ORDER_OPTIONS} onChange={(order) => slideshow({ order })} />}</Field>
            <SwitchRow label="播放时缓慢推近画面" checked={prefs.slideshow.kenBurns} onChange={(kenBurns) => slideshow({ kenBurns })} />
            <SwitchRow label="播完后从头循环" checked={prefs.slideshow.loop} onChange={(loop) => slideshow({ loop })} />
          </Group>

          <Group title="首页">
            <Field label="轮播内容">{() => <div className="-mx-1"><HeroSourcePicker compact /></div>}</Field>
            <Field label="登录后先打开">{(id) => <Seg labelledBy={id} value={prefs.startPage} options={START_OPTIONS} onChange={(startPage) => save({ startPage })} />}</Field>
          </Group>

          <Group title="文件夹">
            <SwitchRow
              label="默认包含子文件夹里的内容"
              hint="打开文件夹时，照片网格同时显示各级子文件夹里的照片和视频。"
              checked={prefs.folderIncludeSubfolders}
              onChange={(folderIncludeSubfolders) => save({ folderIncludeSubfolders })}
            />
          </Group>

          <p className="mt-[22px] mb-0 text-xs leading-relaxed text-muted">
            “随照片”会从当前照片提取 OKLCH 主色与副氛围色，在深浅两种模式下自动校准文字对比度。
          </p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
