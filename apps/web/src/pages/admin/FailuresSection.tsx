/**
 * 控制台“处理失败”：按状态筛选、查看原图、重试、忽略和删除。
 */
import { useCallback, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, Eye, FileWarning, Grid2x2, Image as ImageIcon, RefreshCw, RotateCcw, Ruler, Trash2, Undo2 } from 'lucide-react';
import type { MediaFailure } from '@luvia/contracts';
import { ApiError, call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { createOperationId } from '@/lib/operation-id';
import { queryClient } from '@/lib/query';
import { openViewer } from '@/stores/viewer';
import { errMsg, formatWhen } from './format';
import { failureCategoryLabel, failureHint, failureTone, operationLabel } from './failure-format';
import { Chip, Confirm, Empty, IconButton, Pill, QueryState, Section, Seg } from './ui';

type Filter = 'open' | 'ignored' | 'all';
const FILTERS: readonly { value: Filter; label: string }[] = [
  { value: 'open', label: '未忽略' },
  { value: 'ignored', label: '已忽略' },
  { value: 'all', label: '全部' },
];

function useFailures(filter: Filter) {
  return useInfiniteQuery({
    queryKey: ['listMediaFailures', filter],
    queryFn: ({ pageParam, signal }) => call('listMediaFailures', {
      query: {
        ignored: filter === 'all' ? undefined : filter === 'ignored' ? 'true' : 'false',
        cursor: pageParam ?? undefined,
        limit: 50,
      },
      signal,
    }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => {
      const n = last.nextCursor ? Number(last.nextCursor) : NaN;
      return Number.isSafeInteger(n) && n > 0 ? n : null;
    },
  });
}

function operationIcon(op: string) {
  if (op.startsWith('thumb:')) return ImageIcon;
  if (op === 'preview' || op === 'display') return Eye;
  if (op === 'metadata') return Clock;
  if (op === 'dimensions') return Ruler;
  if (op.startsWith('tile:')) return Grid2x2;
  return FileWarning;
}

function emptyText(filter: Filter) {
  return filter === 'ignored'
    ? '没有被忽略的媒体。'
    : '没有处理失败的媒体。连续失败 3 次的媒体会自动忽略，不会删除原文件。';
}

function FailureSkeleton() {
  return (
    <div aria-hidden className="divide-y divide-line">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-3 px-[18px] py-3.5">
          <span className="size-9 shrink-0 rounded-[10px] bg-line motion-safe:animate-pulse" />
          <div className="min-w-0 flex-1">
            <div className="h-3.5 w-2/5 rounded bg-line motion-safe:animate-pulse" />
            <div className="mt-2 h-3 w-3/5 rounded bg-line motion-safe:animate-pulse" />
            <div className="mt-2 h-3 w-4/5 rounded bg-line motion-safe:animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FailureRow({ f, opening, pending, onOpen, onRetry, onIgnore, onUnignore, onDelete }: {
  f: MediaFailure;
  opening: boolean;
  pending: boolean;
  onOpen: (origin: HTMLElement) => void;
  onRetry: () => void;
  onIgnore: () => void;
  onUnignore: () => void;
  onDelete: () => void;
}) {
  const OperationIcon = operationIcon(f.operation);
  const tone = failureTone(f);
  const time = formatWhen(f.lastFailedAt);
  const busy = opening || pending;
  return (
    <li className="group grid grid-cols-[36px_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 border-b border-line px-[18px] py-3 last:border-b-0 md:grid-cols-[36px_minmax(0,1fr)_128px_96px_auto] md:items-center md:gap-y-0">
      <span className="mt-0.5 grid size-9 place-items-center rounded-[10px] border border-line bg-sunken text-muted md:mt-0" aria-hidden>
        <OperationIcon className="size-4" />
      </span>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="min-w-0 truncate text-left font-medium hover:underline disabled:opacity-60"
            onClick={(e) => onOpen(e.currentTarget)}
            disabled={busy}
            title={f.name}
          >
            {f.name}
          </button>
          {f.ignored && <Pill tone="muted">已忽略</Pill>}
        </div>
        <small className="mt-0.5 block truncate text-[12px] text-muted" title={f.folder}>{f.folder}</small>
        <small className="mt-0.5 block truncate text-[12px] text-fg-2" title={f.reason || undefined}>
          <span className="text-muted">{f.errorCode === 'PARTIAL_DECODE' ? '图片不完整' : failureCategoryLabel(f.category)}</span>
          <span aria-hidden className="mx-1.5 opacity-40">·</span>
          {f.reason || '没有返回原因'}
        </small>
        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted md:hidden">
          <span>{operationLabel(f.operation)}</span>
          <span className={cn('tabular-nums', tone === 'warn' && 'text-warn')}>{f.errorCode === 'PARTIAL_DECODE' ? '质量待检查' : `失败 ${f.failures} 次`}</span>
          <span>{time ?? '时间未知'}</span>
        </div>
      </div>

      <div className="hidden min-w-0 md:block">
        <span className="block truncate text-[12.5px] text-fg-2">{operationLabel(f.operation)}</span>
        <span className={cn('mt-0.5 block text-[12px] tabular-nums', tone === 'warn' ? 'text-warn' : 'text-muted')}>{f.errorCode === 'PARTIAL_DECODE' ? '质量待检查' : `失败 ${f.failures} 次`}</span>
      </div>
      <div className="hidden text-[12px] text-muted tabular-nums md:block">{time ?? '时间未知'}</div>

      <div className={cn(
        'col-span-2 flex flex-wrap justify-end gap-1 md:col-span-1 md:opacity-0 md:transition-opacity md:group-hover:opacity-100 md:group-focus-within:opacity-100',
        busy && 'md:opacity-100',
      )}>
        <Chip size="sm" variant="ghost" disabled={busy} onClick={(e) => onOpen(e.currentTarget)}>
          <Eye />{opening ? '正在打开…' : '查看原图'}
        </Chip>
        {f.errorCode !== 'PARTIAL_DECODE' && <Chip size="sm" variant="ghost" disabled={busy} onClick={onRetry}>
          <RotateCcw />重试
        </Chip>}
        {f.ignored && (
          <Chip size="sm" variant="ghost" disabled={busy} onClick={onUnignore}>
            <Undo2 />解除忽略
          </Chip>
        )}
        {!f.ignored && (
          <Chip size="sm" variant="ghost" disabled={busy} onClick={onIgnore}>
            <FileWarning />忽略
          </Chip>
        )}
        <Chip size="sm" variant="danger" disabled={busy} onClick={onDelete}>
          <Trash2 />删除
        </Chip>
      </div>
    </li>
  );
}

export default function FailuresSection() {
  const [filter, setFilter] = useState<Filter>('open');
  const query = useFailures(filter);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = query.data?.pages[0]?.counts;
  const openingRef = useRef<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ failure: MediaFailure; operationId: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['listMediaFailures'] });
    void queryClient.invalidateQueries({ queryKey: ['adminOverview'] });
  }, []);

  const openOriginal = useCallback(async (f: MediaFailure, originEl: HTMLElement) => {
    if (openingRef.current) return;
    openingRef.current = f.id;
    setOpening(f.id);
    try {
      const detail = await call('mediaDetail', { params: { id: f.mediaId } });
      openViewer({
        label: `处理失败 · ${f.name}`,
        items: [detail],
        errorHint: failureHint(f),
      }, 0, { originEl });
    } catch (e) {
      toast.error(`无法打开原图：${errMsg(e)}`);
      refresh();
    } finally {
      openingRef.current = null;
      setOpening(null);
    }
  }, [refresh]);

  const retry = useMutation({
    mutationFn: (f: MediaFailure) => call('retryMediaFailure', { params: { id: f.id }, body: f.source }),
    onSuccess: () => { toast.success('已重新排队处理'); refresh(); },
    onError: (e) => { toast.error(errMsg(e)); refresh(); },
  });
  const unignore = useMutation({
    mutationFn: (f: MediaFailure) => call('unignoreMediaFailure', { params: { id: f.id }, body: f.source }),
    onSuccess: (_result, f) => { toast.success(f.errorCode === 'PARTIAL_DECODE' ? '已解除忽略，图片仍需检查' : '已解除忽略，可手动重试'); refresh(); },
    onError: (e) => { toast.error(errMsg(e)); refresh(); },
  });
  const ignore = useMutation({
    mutationFn: (f: MediaFailure) => call('ignoreMediaFailure', { params: { id: f.id }, body: f.source }),
    onSuccess: () => { toast.success('已忽略此处理项，原文件保留'); refresh(); },
    onError: (e) => { toast.error(errMsg(e)); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (target: { failure: MediaFailure; operationId: string }) => call('deleteMedia', {
      params: { id: target.failure.mediaId },
      body: { confirm: true, source: target.failure.source, operationId: target.operationId },
    }),
    onSuccess: (_result, target) => { toast.success(`已删除 ${target.failure.name}`); setDeleteTarget(null); setDeleteError(null); refresh(); },
    onError: (e) => {
      const message = errMsg(e);
      if (e instanceof ApiError && e.code === 'OPERATION_PARTIAL') {
        // 文件已删除、索引清理未完成；保留同一个 operationId 供重试。
        setDeleteError(message);
        toast.error(message);
        refresh();
        return;
      }
      toast.error(message);
      setDeleteTarget(null);
      setDeleteError(null);
      refresh();
    },
  });

  const title = (
    <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      处理失败
      {counts && (
        <span className="text-[12px] font-normal text-muted">
          未忽略 <b className={cn('font-semibold tabular-nums', counts.unignored > 0 ? 'text-bad' : 'text-fg-2')}>{counts.unignored}</b>
          <span aria-hidden className="mx-1.5 opacity-40">·</span>
          已忽略 <b className="font-semibold tabular-nums text-fg-2">{counts.ignored}</b>
        </span>
      )}
    </span>
  );

  return (
    <>
      <Section
        title={title}
      desc="缩略图、预览和拍摄信息连续失败 3 次后自动忽略，也可手动忽略。查看原图并确认后可删除原文件。"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Seg
            label="失败状态"
            value={filter}
            onChange={setFilter}
            options={FILTERS}
            className="min-w-0 flex-1 sm:flex-none sm:min-w-[240px]"
          />
          <IconButton label="刷新失败列表" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <RefreshCw className={query.isFetching ? 'motion-safe:animate-spin' : undefined} />
          </IconButton>
        </div>
      }
    >
      {query.isLoading ? (
        <FailureSkeleton />
      ) : query.error && !items.length ? (
        <QueryState error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length ? (
        <>
          <ul className="m-0 list-none p-0">
            {items.map((f) => (
              <FailureRow
                key={f.id}
                f={f}
                opening={opening === f.id}
                pending={(retry.isPending && retry.variables?.id === f.id) || (ignore.isPending && ignore.variables?.id === f.id) || (unignore.isPending && unignore.variables?.id === f.id) || (remove.isPending && remove.variables?.failure.id === f.id)}
                onOpen={(origin) => void openOriginal(f, origin)}
                onRetry={() => retry.mutate(f)}
                onIgnore={() => ignore.mutate(f)}
                onUnignore={() => unignore.mutate(f)}
                onDelete={() => { setDeleteError(null); setDeleteTarget({ failure: f, operationId: createOperationId() }); }}
              />
            ))}
          </ul>
          {query.isError && (
            <div role="alert" className="border-t border-line px-[18px] py-3 text-[12.5px] text-bad">
              加载更多失败：{errMsg(query.error)}
            </div>
          )}
          {query.hasNextPage && (
            <div className="flex justify-center border-t border-line px-[18px] py-3">
              <Chip size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {query.isFetchingNextPage ? '正在加载…' : '加载更多'}
              </Chip>
            </div>
          )}
        </>
      ) : (
        <Empty>{emptyText(filter)}</Empty>
      )}
      </Section>
      <Confirm
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !remove.isPending) { setDeleteTarget(null); setDeleteError(null); } }}
        title="删除原文件？"
        desc={deleteTarget ? (
          <>
            将永久删除 <b className="font-semibold text-fg">{deleteTarget.failure.name}</b> 及其在磁盘上的文件，无法撤销。缓存会按清理规则回收。
            {deleteError && <span className="mt-2 block text-bad">{deleteError}</span>}
          </>
        ) : ''}
        action="删除文件"
        pending={remove.isPending}
        onConfirm={() => { if (deleteTarget) remove.mutate(deleteTarget); }}
      />
    </>
  );
}
