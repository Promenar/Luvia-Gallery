import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, Pause, Play, RotateCw, WandSparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { mediaUrls, type EditorBatch, type MediaItem } from '@luvia/contracts';
import { call } from '@/lib/api';
import { q, queryClient } from '@/lib/query';
import { Chip, Field, Modal, Pill, Section, inputClass } from '@/pages/admin/ui';
import { errMsg, formatWhen } from '@/pages/admin/format';
import { MaskCanvas, type MaskCanvasHandle } from '@/viewer/editor/MaskCanvas';
import { useEditorJob } from '@/viewer/editor/useEditorJob';
import { folderProblem, normalizeFolder } from './format';

const refresh = () => {
  void queryClient.invalidateQueries({ queryKey: ['editorBatches'] });
  void queryClient.invalidateQueries({ queryKey: ['editorBatch'] });
};

export function BatchCreateDialog({ items, onClose, onCreated }: {
  items: MediaItem[]; onClose: () => void; onCreated: () => void;
}) {
  const libraries = useQuery(q('listLibraries'));
  const enabled = libraries.data?.libraries.filter((library) => library.enabled) ?? [];
  const [libraryId, setLibraryId] = useState('');
  const [folder, setFolder] = useState('');
  const [mode, setMode] = useState<'review' | 'auto'>('review');
  const [threshold, setThreshold] = useState(128);
  const [confirm, setConfirm] = useState(false);
  const target = libraryId || enabled[0]?.id || '';
  const normalized = normalizeFolder(folder);
  const problem = folderProblem(normalized);
  const create = useMutation({
    mutationFn: () => call('createEditorBatch', { body: { mode, threshold, destination: { libraryId: target, folder: normalized },
      items: items.map((item) => ({ mediaId: item.id, source: item.source! })) } }),
    onSuccess: () => { refresh(); toast.success('批量修复已加入队列'); onCreated(); },
    onError: (error) => toast.error(errMsg(error)),
  });
  const ready = !!target && !problem && items.length > 0 && items.every((item) => !!item.source);
  return (
    <>
      <Modal open onOpenChange={(open) => { if (!open && !create.isPending) onClose(); }} title="批量自动修复"
        desc={`已选择 ${items.length} 张图片，生成结果将保存为新副本。`} wide
        footer={<><Chip onClick={onClose} disabled={create.isPending}>取消</Chip>
          <Chip variant="primary" disabled={!ready || create.isPending} onClick={() => mode === 'auto' ? setConfirm(true) : create.mutate()}>
            {create.isPending ? '正在创建…' : '开始处理'}</Chip></>}>
        <div className="grid gap-4 text-[13px]">
          <Field label="处理方式">
            <label className="flex items-start gap-2"><input type="radio" name="batch-mode" checked={mode === 'review'} onChange={() => setMode('review')} />逐张审核后保存</label>
            <label className="flex items-start gap-2"><input type="radio" name="batch-mode" checked={mode === 'auto'} onChange={() => setMode('auto')} />自动保存检测到水印的结果</label>
          </Field>
          <Field label={`检测阈值 ${threshold}`} hint="较低的阈值会选中更多区域；最终效果请结合预览判断。">
            <input aria-label="检测阈值" type="range" min={1} max={254} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
          </Field>
          <Field label="保存到媒体库" htmlFor="batch-library">
            <select id="batch-library" className={inputClass} value={target} onChange={(event) => setLibraryId(event.target.value)}>
              {!enabled.length && <option value="">没有可用媒体库</option>}
              {enabled.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
            </select>
          </Field>
          <Field label="相对文件夹" htmlFor="batch-folder" hint={problem ?? '留空表示媒体库根目录，不存在的目录会自动创建。'}>
            <input id="batch-folder" className={inputClass} value={folder} onChange={(event) => setFolder(event.target.value)} placeholder="例如：修复副本" />
          </Field>
        </div>
      </Modal>
      <Modal open={confirm} onOpenChange={setConfirm} title="开始全自动处理" desc={`将自动处理 ${items.length} 张图片并保存新副本，原图不会改动。`}
        footer={<><Chip onClick={() => setConfirm(false)}>返回</Chip><Chip variant="primary" disabled={create.isPending} onClick={() => { setConfirm(false); create.mutate(); }}>开始处理</Chip></>} />
    </>
  );
}

const itemLabels: Record<EditorBatch['items'][number]['status'], string> = {
  pending: '排队中', generating: '正在处理', review: '待审核', saving: '正在保存', saved: '已保存',
  skipped: '已跳过', no_detection: '未检出', failed: '失败', cancelled: '已取消',
};
const batchLabels: Record<EditorBatch['status'], string> = { running: '进行中', paused: '已暂停', cancelled: '已取消', completed: '已完成' };

export function BatchAutomationPanel() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const list = useInfiniteQuery({
    queryKey: ['editorBatches'], initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => call('listEditorBatches', { query: { cursor: pageParam, limit: 20 } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined, refetchInterval: 3000,
  });
  const detail = useQuery({ queryKey: ['editorBatch', selected], enabled: !!selected,
    queryFn: () => call('getEditorBatch', { params: { id: selected! } }), refetchInterval: 1500 });
  const action = useMutation({
    mutationFn: (name: 'pause' | 'resume' | 'cancel') => call('editorBatchAction', { params: { id: selected! }, body: { action: name } }),
    onSuccess: () => { setCancelOpen(false); refresh(); }, onError: (error) => toast.error(errMsg(error)),
  });
  const itemAction = useMutation({
    mutationFn: ({ itemId, name }: { itemId: string; name: 'approve' | 'skip' | 'retry' | 'resolve' }) =>
      call('editorBatchItemAction', { params: { id: selected!, itemId, action: name } }),
    onSuccess: () => { setReviewId(null); refresh(); }, onError: (error) => toast.error(errMsg(error)),
  });
  const batches = list.data?.pages.flatMap((page) => page.batches) ?? [];
  const batch = detail.data;
  const item = batch?.items.find((entry) => entry.id === reviewId);
  const done = batch?.items.filter((entry) => ['saved', 'skipped', 'no_detection', 'failed', 'cancelled'].includes(entry.status)).length ?? 0;
  return (
    <div className="grid gap-4">
      <Section title="批量自动修复" desc="在照片页选择图片后创建批次；原图始终保留。"
        action={<Chip size="sm" onClick={() => void navigate({ to: '/photos' })}><WandSparkles />选择照片</Chip>}>
        <div className="p-[18px]">
        {list.isPending ? <p className="text-[13px] text-muted">正在读取批次…</p> : list.isError ? <p role="alert" className="text-[13px] text-bad">{errMsg(list.error)}</p>
          : !batches.length ? <p className="text-[13px] text-muted">还没有批量修复任务。</p>
            : <div className="grid gap-2">{batches.map((entry) => (
              <button type="button" key={entry.id} onClick={() => setSelected(entry.id)}
                className="flex flex-wrap items-center gap-3 rounded-[var(--r2)] border border-line px-3 py-3 text-left hover:bg-accent-soft">
                <span className="min-w-0 flex-1"><b className="block text-[13px]">{entry.mode === 'review' ? '逐张审核' : '全自动'} · {entry.items.length} 张</b>
                  <small className="text-muted">{formatWhen(entry.createdAt)} · {entry.destination.folder || '媒体库根目录'}</small></span>
                <Pill tone={entry.status === 'running' ? 'accent' : 'muted'}>{batchLabels[entry.status]}</Pill>
              </button>
            ))}</div>}
        {list.hasNextPage && <div className="mt-3"><Chip size="sm" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>加载更早批次</Chip></div>}
        </div>
      </Section>
      {selected && (detail.isPending ? <p className="text-[13px] text-muted">正在读取任务…</p> : detail.isError ? <p role="alert" className="text-[13px] text-bad">{errMsg(detail.error)}</p> : batch && (
        <Section title={batch.mode === 'review' ? '逐张审核' : '全自动处理'}
          desc={`${batchLabels[batch.status]} · 已处理 ${done} / ${batch.items.length} · 阈值 ${batch.threshold}`}
          action={<div className="flex gap-1">{batch.status === 'running' && <Chip size="sm" disabled={action.isPending} onClick={() => action.mutate('pause')}><Pause />暂停</Chip>}
            {batch.status === 'paused' && <Chip size="sm" disabled={action.isPending} onClick={() => action.mutate('resume')}><Play />继续</Chip>}
            {(batch.status === 'running' || batch.status === 'paused') && <Chip size="sm" disabled={action.isPending} onClick={() => setCancelOpen(true)}><X />取消</Chip>}</div>}>
          <div className="p-[18px]">
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full bg-accent" style={{ width: `${batch.items.length ? done / batch.items.length * 100 : 0}%` }} /></div>
          <div className="grid gap-2">{batch.items.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center gap-2 rounded-[var(--r2)] border border-line px-3 py-2.5">
              <div className="min-w-0 flex-1"><b className="block truncate text-[13px]">{entry.name}</b>
                <small className="text-muted">{entry.error ?? (entry.resultName ? `已保存 ${entry.resultName}` : itemLabels[entry.status])}</small></div>
              <Pill tone={entry.status === 'failed' ? 'bad' : entry.status === 'saved' ? 'ok' : 'muted'}>{itemLabels[entry.status]}</Pill>
              {entry.status === 'review' && <Chip size="sm" onClick={() => setReviewId(entry.id)}>审核</Chip>}
              {entry.status === 'failed' && <Chip size="sm" disabled={itemAction.isPending} onClick={() => itemAction.mutate({ itemId: entry.id, name: 'retry' })}><RotateCw />重试</Chip>}
              {entry.status === 'cancelled' && entry.error && <Chip size="sm" disabled={itemAction.isPending} onClick={() => itemAction.mutate({ itemId: entry.id, name: 'resolve' })}>完成入库对账</Chip>}
            </div>
          ))}</div>
          </div>
        </Section>
      ))}
      {batch && item && item.jobId && <ReviewDialog batch={batch} item={item} onClose={() => setReviewId(null)}
        onAction={(name) => itemAction.mutate({ itemId: item.id, name })} pending={itemAction.isPending} />}
      <Modal open={cancelOpen} onOpenChange={setCancelOpen} title="取消批量修复"
        desc="当前发布操作会先收尾；已经保存的副本会保留。" footer={<><Chip onClick={() => setCancelOpen(false)}>返回</Chip>
          <Chip variant="danger" disabled={action.isPending} onClick={() => action.mutate('cancel')}>确认取消</Chip></>} />
    </div>
  );
}

function ReviewDialog({ batch, item, onClose, onAction, pending }: {
  batch: EditorBatch; item: EditorBatch['items'][number]; onClose: () => void;
  onAction: (action: 'approve' | 'skip') => void; pending: boolean;
}) {
  const detail = useQuery(q('mediaDetail', { params: { id: item.mediaId } }));
  const job = useQuery({ queryKey: ['editorJob', item.jobId], queryFn: () => call('getEditorJob', { params: { id: item.jobId! } }), enabled: !!item.jobId });
  const caps = useQuery(q('editorCapabilities'));
  const adjustment = useEditorJob();
  const mask = useRef<MaskCanvasHandle>(null);
  const attached = useRef<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [brush, setBrush] = useState(18);
  const [erase, setErase] = useState(false);
  const attach = useMutation({ mutationFn: (jobId: string) => call('replaceEditorBatchJob', { params: { id: batch.id, itemId: item.id }, body: { jobId } }),
    onSuccess: () => { setEditing(false); adjustment.reset(); refresh(); }, onError: (error) => toast.error(errMsg(error)) });
  useEffect(() => {
    if (adjustment.job?.status !== 'succeeded' || !adjustment.job.resultUrl || attached.current === adjustment.job.id) return;
    attached.current = adjustment.job.id;
    attach.mutate(adjustment.job.id);
  }, [adjustment.job, attach]);
  const busy = adjustment.busy || attach.isPending || pending;
  const image = detail.data;
  const original = image ? mediaUrls.display(image.id, image.thumbVersion) : '';
  const aspect = image?.width && image.height ? image.width / image.height : 4 / 3;
  const apply = async () => {
    const data = mask.current?.exportChanges();
    if (!image?.source || !data || !mask.current || !item.jobId) return;
    if (Math.floor(data.length * 3 / 4) > (caps.data?.mask.maxBytes ?? 0)) { toast.error('蒙版超过大小限制'); return; }
    await adjustment.create({ mediaId: image.id, source: image.source, model: 'slbr',
      mask: { mode: 'adjust', baseJobId: item.jobId, changes: { data, width: mask.current.width, height: mask.current.height } } });
  };
  return (
    <Modal open onOpenChange={(open) => { if (!open && !busy) onClose(); }} title="审核修复结果" desc={`${item.name} · 保存为新副本`} wide
      footer={<><Chip disabled={busy} onClick={onClose}>稍后</Chip><Chip disabled={busy} onClick={() => onAction('skip')}>跳过</Chip>
        <Chip variant="primary" disabled={busy || editing || !job.data?.resultUrl} onClick={() => onAction('approve')}><Check />通过并保存</Chip></>}>
      {image && job.data ? <>
        <div className="relative mx-auto w-full overflow-hidden rounded-[var(--r2)] bg-sunken" style={{ aspectRatio: String(aspect), maxWidth: `${48 * aspect}vh` }}>
          <img src={editing || comparing ? original : job.data.resultUrl ?? original} alt={editing || comparing ? '原图' : '修复预览'} className="h-full w-full object-contain" />
          {editing && <MaskCanvas ref={mask} item={image} rotation={0} brush={brush} erase={erase} active={!busy}
            baseMaskUrl={job.data.maskUrl} maxEdge={caps.data?.mask.maxEdge ?? 2048} onChange={setHasChanges} />}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!editing ? <><Chip size="sm" onClick={() => setComparing(!comparing)}>{comparing ? '查看修复结果' : '查看原图'}</Chip>
            {job.data.maskUrl && <Chip size="sm" onClick={() => setEditing(true)}>调整蒙版</Chip>}</>
            : <><label className="flex items-center gap-2 text-[12px] text-muted">笔刷<input type="range" min={6} max={56} value={brush} onChange={(event) => setBrush(Number(event.target.value))} /></label>
              <Chip size="sm" onClick={() => setErase(!erase)}>{erase ? '切回涂抹' : '擦除'}</Chip>
              <Chip size="sm" disabled={!hasChanges} onClick={() => mask.current?.undo()}>撤销</Chip>
              <Chip size="sm" disabled={busy} onClick={() => { setEditing(false); adjustment.reset(); }}>返回</Chip>
              <Chip size="sm" variant="primary" disabled={!hasChanges || busy} onClick={() => void apply()}>{busy ? '正在生成…' : '应用蒙版'}</Chip></>}
        </div>
        {(adjustment.createError || adjustment.queryError || adjustment.job?.error) && <p role="alert" className="text-[12px] text-bad">{adjustment.createError ?? adjustment.queryError ?? adjustment.job?.error}</p>}
        {attach.isError && adjustment.job?.id && <Chip size="sm" onClick={() => attach.mutate(adjustment.job!.id)}>重试应用调整</Chip>}
      </> : <p className="text-[13px] text-muted">{detail.isError || job.isError ? '无法读取预览，请重试。' : '正在读取预览…'}</p>}
    </Modal>
  );
}
