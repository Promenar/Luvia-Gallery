/** 概览：KPI、运行中的作业（SSE 实时进度）、服务健康曲线。 */
import { useQuery } from '@tanstack/react-query';
import { Pause, Play, RotateCcw, X } from 'lucide-react';
import type { AdminOverview, Job } from '@luvia/contracts';
import { cn } from '@/lib/cn';
import { bytesParts, jobView, num, pct, sparkPaths } from './format';
import { callWith, overviewQuery, settingsQuery, useJobs } from './hooks';
import { Empty, IconButton, LiveDot, Panel, Pill, ProgressBar, QueryState, useSave } from './ui';

function Kpi({ value, unit, label, sub }: { value: string; unit?: string; label: string; sub: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-surface px-5 py-[18px] max-md:px-4">
      <div className="font-display text-[44px] leading-[.9] font-extrabold tracking-[-0.01em] tabular-nums md:text-[54px]">
        {value}{unit && <span className="text-[22px] md:text-[26px]"> {unit}</span>}
      </div>
      <div className="mt-2 text-[12.5px] text-muted">{label}</div>
      <div className="text-[12.5px] text-fg-2">{sub}</div>
    </div>
  );
}

function Kpis({ o, graceDays, thumbFixing }: { o: AdminOverview; graceDays: number | undefined; thumbFixing: boolean }) {
  const [cv, cu] = bytesParts(o.cache.bytes);
  const [lv, lu] = bytesParts(o.cache.limitBytes);
  const metaRatio = o.metadata.total ? o.metadata.indexed / o.metadata.total : 1;
  const metaLeft = o.metadata.total - o.metadata.indexed;
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--r3)] border border-line bg-line lg:grid-cols-5 [&>*:last-child:nth-child(odd)]:max-lg:col-span-2">
      <Kpi value={num(o.media.total)} label="媒体总数" sub={`图片 ${num(o.media.images)}，视频 ${num(o.media.videos)}${o.media.audio ? `，音频 ${num(o.media.audio)}` : ''}`} />
      <Kpi value={pct(o.thumbnails.coverage)} label="缩略图覆盖" sub={o.thumbnails.missing ? <>缺失 {num(o.thumbnails.missing)}{thumbFixing && <>，<em className="text-ok not-italic">修复中</em></>}</> : '全部就绪'} />
      <Kpi value={pct(metaRatio)} label="拍摄信息已读取" sub={metaLeft > 0 ? `还剩 ${num(metaLeft)} 项` : '全部读取完成'} />
      <Kpi value={cv} unit={cu} label="缓存占用" sub={`上限 ${lv} ${lu}，超出自动清理`} />
      <Kpi
        value={num(o.media.missing)}
        label="宽限期内缺失"
        sub={o.media.missing ? `文件已不在磁盘上，${graceDays != null ? `${graceDays} 天后` : '宽限期结束后'}清理记录` : '没有缺失的文件'}
      />
    </div>
  );
}

/* ---------- 健康曲线 ---------- */

function Spark({ label, value, unit, data, color, max }: { label: string; value: number; unit: string; data: number[]; color: string; max?: number }) {
  const W = 300, H = 36;
  const { line, area, last } = sparkPaths(data, W, H, max);
  const lo = data.length ? Math.min(...data) : 0, hi = data.length ? Math.max(...data) : 0;
  return (
    <div className="border-b border-line px-[18px] py-3 last:border-b-0">
      <div className="flex items-baseline justify-between text-[12.5px] text-fg-2">
        <span>{label}</span>
        <b className="font-display text-[22px] leading-none font-extrabold text-fg tabular-nums">{Math.round(value)}<span className="ml-0.5 font-sans text-[12px] font-medium text-muted">{unit}</span></b>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-1.5 block h-9 w-full overflow-visible" role="img" aria-label={`${label}，最近 60 分钟 ${Math.round(lo)}–${Math.round(hi)}${unit}`}>
        <path d={area} fill={color} opacity={0.14} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {last && <circle cx={last.x} cy={last.y} r={3} fill={color} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  );
}

function Health({ o }: { o: AdminOverview }) {
  const s = o.health.series;
  return (
    <Panel title="服务状态" aside="近 1 小时">
      <Spark label="接口响应 p95" value={o.health.apiP95Ms} unit=" ms" data={s.apiP95Ms} color="var(--accent)" />
      <Spark label="事件循环延迟 p99" value={o.health.eventLoopP99Ms} unit=" ms" data={s.eventLoopP99Ms} color="var(--ok)" />
      <Spark label="后台队列深度" value={o.health.queueDepth} unit=" 项" data={s.queueDepth} color="var(--warn)" />
    </Panel>
  );
}

/* ---------- 作业 ---------- */

const ACTION_LABEL = { pause: '暂停', resume: '继续', cancel: '取消', retry: '重试' } as const;
const ACTION_ICON = { pause: Pause, resume: Play, cancel: X, retry: RotateCcw } as const;

export function JobRow({ job }: { job: Job }) {
  const v = jobView(job);
  const act = useSave({
    fn: (action: keyof typeof ACTION_LABEL) => callWith('jobAction', { id: job.id, action }),
    success: (_d, a) => `已${ACTION_LABEL[a]}“${job.label}”`,
    invalidate: [['listJobs'], ['adminOverview']],
  });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3.5 gap-y-2 border-b border-line px-[18px] py-[13px] last:border-b-0 md:grid-cols-[minmax(0,1fr)_150px_76px_72px]">
      <div className="min-w-0">
        <b className="block truncate font-medium">{job.label}</b>
        <small className={cn('block truncate text-[12px] tabular-nums', job.status === 'failed' ? 'text-bad' : 'text-muted')} title={v.detail}>{v.detail}</small>
      </div>
      <div className="col-span-2 row-start-2 md:col-span-1 md:row-start-auto">
        <ProgressBar value={v.pct} tone={job.status === 'succeeded' ? 'ok' : job.status === 'failed' ? 'bad' : job.status === 'paused' ? 'warn' : undefined} />
      </div>
      <Pill tone={v.status.tone} className="justify-self-end">{v.status.label}</Pill>
      <div className="col-span-2 row-start-3 flex justify-end gap-0.5 md:col-span-1 md:row-start-auto">
        {v.actions.map((a) => {
          const Icon = ACTION_ICON[a];
          return <IconButton key={a} label={`${ACTION_LABEL[a]}“${job.label}”`} disabled={act.isPending} onClick={() => act.mutate(a)}><Icon /></IconButton>;
        })}
      </div>
    </div>
  );
}

export function JobsPanel({ filter, title = '任务', empty = '没有任务。扫描、缩略图和元数据处理会显示在这里。', limit = 8 }: { filter?: (j: Job) => boolean; title?: string; empty?: string; limit?: number }) {
  const jobs = useJobs();
  const list = (jobs.data?.jobs ?? []).filter(filter ?? (() => true)).slice(0, limit);
  return (
    <Panel title={title} aside={<><LiveDot />实时</>}>
      <QueryState loading={jobs.isLoading} error={jobs.error} onRetry={() => void jobs.refetch()}>
        {list.length ? list.map((j) => <JobRow key={j.id} job={j} />) : <Empty>{empty}</Empty>}
      </QueryState>
    </Panel>
  );
}

export default function OverviewTab() {
  const o = useQuery({ ...overviewQuery, refetchInterval: 60_000 });
  const s = useQuery(settingsQuery);
  const jobs = useJobs();
  const thumbFixing = !!jobs.data?.jobs.some((j) => j.type === 'thumbnails' && (j.status === 'running' || j.status === 'queued'));
  return (
    <QueryState loading={o.isLoading} error={o.error} onRetry={() => void o.refetch()}>
      {o.data && (
        <>
          <Kpis o={o.data} graceDays={s.data?.libraries.missingGraceDays} thumbFixing={thumbFixing} />
          <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[1.5fr_1fr]">
            <JobsPanel />
            <Health o={o.data} />
          </div>
        </>
      )}
    </QueryState>
  );
}
