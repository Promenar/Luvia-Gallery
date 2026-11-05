import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ChevronRight, CornerLeftUp, Folder as FolderIcon } from 'lucide-react';
import type { Album, MediaType } from '@luvia/contracts';
import { toast } from 'sonner';
import { call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { invalidate, q, queryClient } from '@/lib/query';
import { Button } from '@/components/kit/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/kit/dialog';
import { Input } from '@/components/kit/input';
import { Switch } from '@/components/kit/switch';
import { folderTreeQuery, foldersQuery } from '@/pages/folders/favorite';
import { parentPath } from '@/pages/folders/paths';
import { chip } from '@/pages/folders/ui';
import { idParams } from './params';
import { emptySmartForm, fromFilter, rangeError, toFilter, type SmartForm } from './format';

const TYPES: [MediaType, string][] = [['image', '照片'], ['video', '视频'], ['audio', '音频']];
const fieldLabel = 'grid gap-1.5 text-[12.5px] font-semibold text-fg-2';
const hint = 'text-[12px] font-normal text-muted';

/** 相册改动后需要刷新的查询：列表、详情与相册范围的媒体。 */
export function invalidateAlbum() {
  void invalidate('listAlbums', 'getAlbum');
  void queryClient.invalidateQueries({
    predicate: (qq) => qq.queryKey[0] === 'listMedia' && (qq.queryKey[2] as { scope?: string } | null)?.scope === 'album',
  });
}

/** 智能相册的“文件夹”条件：逐级浏览目录树，选中后匹配该文件夹及其子文件夹。 */
function FolderPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<string | undefined>(undefined);
  const tree = useQuery({ ...folderTreeQuery(at), enabled: open });
  const here = useQuery({ ...foldersQuery(at), enabled: open && !!at });
  const crumbs = here.data?.breadcrumbs ?? [];
  const valueName = value?.split('/').at(-1);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 text-[13px] font-normal break-all text-fg">{value ? `「${valueName}」及子文件夹` : '不限文件夹'}</span>
        <button type="button" className={chip(false, true)} onClick={() => { setAt(value ? parentPath(value) : undefined); setOpen(true); }}>
          {value ? '更换文件夹' : '选择文件夹'}
        </button>
        {value && <button type="button" className={chip(false, true)} onClick={() => onChange(null)}>不限文件夹</button>}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-[var(--r2)] border border-line font-normal">
      <div className="flex items-center gap-2 border-b border-line bg-sunken/50 px-3 py-2 text-[12.5px]">
        {at ? (
          <button type="button" aria-label="上一级" className="grid size-6 place-items-center rounded-md hover:bg-accent-soft" onClick={() => setAt(parentPath(at))}>
            <CornerLeftUp className="size-3.5" />
          </button>
        ) : null}
        <span className="min-w-0 flex-1 truncate text-muted">{at ? crumbs.map((b) => b.name).join(' / ') || at : '全部媒体库'}</span>
        {at && (
          <button type="button" className={chip(true, true)} onClick={() => { onChange(at); setOpen(false); }}>
            选这个文件夹
          </button>
        )}
        <button type="button" className={chip(false, true)} onClick={() => setOpen(false)}>收起</button>
      </div>
      <div className="max-h-[220px] overflow-auto">
        {tree.isPending && <div className="px-3 py-2.5 text-[13px] text-muted">正在加载…</div>}
        {tree.isError && <div className="px-3 py-2.5 text-[13px] text-bad">无法读取目录：{tree.error.message}</div>}
        {tree.data?.nodes.length === 0 && <div className="px-3 py-2.5 text-[13px] text-muted">这里没有子文件夹。</div>}
        {tree.data?.nodes.map((n) => (
          <button
            key={n.path}
            type="button"
            onClick={() => (n.childCount > 0 ? setAt(n.path) : (onChange(n.path), setOpen(false)))}
            className={cn('flex w-full items-center gap-2 border-b border-line px-3 py-[9px] text-left text-[13px] last:border-b-0 hover:bg-accent-soft', n.path === value && 'font-semibold')}
          >
            <FolderIcon className="size-[15px] flex-none text-muted" strokeWidth={1.7} />
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
            <small className="text-[12px] text-muted">{n.mediaCount.toLocaleString('zh-CN')}</small>
            {n.childCount > 0 && <ChevronRight className="size-3.5 text-muted" aria-label="有子文件夹" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function SmartFields({ form, setForm }: { form: SmartForm; setForm: (f: SmartForm) => void }) {
  const facets = useQuery(q('facets'));
  const cameras = facets.data?.cameras ?? [];
  const filter = toFilter(form);
  const preview = useQuery({ ...q('listMedia', { query: { ...(filter ?? {}), limit: 1 } }), enabled: !!filter });
  const err = rangeError(form);
  const fromId = useId(), toId = useId(), favId = useId();
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="grid gap-3.5 rounded-[var(--r2)] border border-line p-3.5">
      <div className={fieldLabel} role="group" aria-label="媒体类型">
        <span>类型 <span className={hint}>不选表示全部类型</span></span>
        <div className="flex flex-wrap gap-2">
          {TYPES.map(([t, name]) => (
            <button key={t} type="button" aria-pressed={form.types.includes(t)} className={chip(form.types.includes(t), true)} onClick={() => setForm({ ...form, types: toggle(form.types, t) })}>
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className={fieldLabel}>
        <span>拍摄时间 <span className={hint}>包含开始和结束当天</span></span>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 font-normal">
          <Input id={fromId} type="date" aria-label="开始日期" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          <span className="text-muted">至</span>
          <Input id={toId} type="date" aria-label="结束日期" value={form.to} aria-invalid={!!err} onChange={(e) => setForm({ ...form, to: e.target.value })} />
        </div>
        {err && <span className="text-[12px] font-normal text-bad">{err}</span>}
      </div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={favId} className="text-[12.5px] font-semibold text-fg-2">只包含收藏 <span className={hint}>含收藏文件夹中的内容</span></label>
        <Switch id={favId} checked={form.favorite} onCheckedChange={(v) => setForm({ ...form, favorite: v })} />
      </div>
      <div className={fieldLabel}>
        <span>文件夹</span>
        <FolderPicker value={form.under} onChange={(under) => setForm({ ...form, under })} />
      </div>
      <div className={fieldLabel} role="group" aria-label="相机">
        <span>相机 <span className={hint}>可多选，不选表示不限</span></span>
        {facets.isPending ? <span className={hint}>正在读取相机型号…</span>
          : cameras.length === 0 ? <span className={hint}>媒体库里还没有识别到相机型号。</span>
            : (
              <div className="flex flex-wrap gap-2">
                {cameras.map((c) => (
                  <button key={c.name} type="button" aria-pressed={form.cameras.includes(c.name)} className={chip(form.cameras.includes(c.name), true)} onClick={() => setForm({ ...form, cameras: toggle(form.cameras, c.name) })}>
                    {c.name}<span className="opacity-70">{c.count.toLocaleString('zh-CN')}</span>
                  </button>
                ))}
              </div>
            )}
      </div>
      <p className="m-0 text-[12.5px] text-muted" aria-live="polite">
        {!filter ? '至少设置一个条件。符合条件的新照片会自动出现在相册里。'
          : preview.data?.total != null ? `目前有 ${preview.data.total.toLocaleString('zh-CN')} 项符合条件。`
            : preview.isError ? '暂时无法统计符合条件的数量。' : '正在统计符合条件的数量…'}
      </p>
    </div>
  );
}

/**
 * 新建或编辑相册。新建时可选手动相册（之后从照片中加入）或智能相册（保存筛选条件，自动更新）；
 * 编辑时可改名称、说明，智能相册还可改条件。
 */
export function AlbumDialog({ open, onOpenChange, album }: { open: boolean; onOpenChange: (v: boolean) => void; album?: Album }) {
  const navigate = useNavigate();
  const editing = !!album;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'manual' | 'smart'>('manual');
  const [form, setForm] = useState<SmartForm>(emptySmartForm);
  const nameId = useId(), descId = useId();

  useEffect(() => {
    if (!open) return;
    setName(album?.name ?? '');
    setDescription(album?.description ?? '');
    setKind(album?.kind ?? 'manual');
    setForm(album ? fromFilter(album.filter) : emptySmartForm());
  }, [open, album]);

  const filter = toFilter(form);
  const invalid = !name.trim() || (kind === 'smart' && (!filter || !!rangeError(form)));

  const save = useMutation({
    mutationFn: () => {
      const desc = description.trim() || null;
      if (album) {
        return call('updateAlbum', {
          ...idParams(album.id),
          body: { name: name.trim(), description: desc, ...(album.kind === 'smart' ? { filter } : {}) },
        });
      }
      return call('createAlbum', { body: { name: name.trim(), description: desc, kind, filter: kind === 'smart' ? filter : null } });
    },
    onSuccess: (a) => {
      invalidateAlbum();
      onOpenChange(false);
      if (editing) toast.success('已保存相册');
      else {
        toast.success(`已创建相册「${a.name}」`);
        void navigate({ to: '/albums/$albumId', params: { albumId: a.id } });
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : '没能保存相册，请稍后重试'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[86vh] overflow-y-auto rounded-[calc(var(--r3)+2px)] border border-line-2 bg-raised p-[22px] ring-0 sm:max-w-[520px]">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!invalid && !save.isPending) save.mutate();
          }}
        >
          <DialogHeader className="gap-1">
            <DialogTitle className="text-[17px] font-semibold">{editing ? '编辑相册' : '新建相册'}</DialogTitle>
            <DialogDescription className="text-[13px]">
              {editing
                ? album.kind === 'smart' ? '修改名称、说明或筛选条件，相册内容会按新条件更新。' : '修改相册名称和说明。'
                : '相册只记录照片，不会移动或复制原文件。'}
            </DialogDescription>
          </DialogHeader>

          <label htmlFor={nameId} className={fieldLabel}>
            名称
            <Input id={nameId} required maxLength={120} autoFocus value={name} placeholder="例如：冰岛环岛" onChange={(e) => setName(e.target.value)} className="font-normal" />
          </label>
          <label htmlFor={descId} className={fieldLabel}>
            <span>说明 <span className={hint}>可选</span></span>
            <Input id={descId} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} className="font-normal" />
          </label>

          {!editing && (
            <div className={fieldLabel} role="radiogroup" aria-label="相册类型">
              <span>类型</span>
              <div className="grid grid-cols-2 gap-2 font-normal">
                {([['manual', '手动挑选', '之后在照片里选中并加入'], ['smart', '智能相册', '按条件自动收录']] as const).map(([k, t, d]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={kind === k}
                    onClick={() => setKind(k)}
                    className={cn('rounded-[var(--r2)] border px-3 py-2.5 text-left transition-colors', kind === k ? 'border-accent bg-accent-soft' : 'border-line-2 hover:bg-accent-soft')}
                  >
                    <span className="block text-[13px] font-semibold text-fg">{t}</span>
                    <span className="block text-[12px] text-muted">{d}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {kind === 'smart' && <SmartFields form={form} setForm={setForm} />}

          <DialogFooter className="mx-0 mb-0 border-0 bg-transparent p-0 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={invalid || save.isPending}>
              {save.isPending ? '正在保存…' : editing ? '保存修改' : kind === 'smart' ? '创建智能相册' : '创建相册'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
