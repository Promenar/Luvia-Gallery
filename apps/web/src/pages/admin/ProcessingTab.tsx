/** 扫描与处理：全量对账计划、后台并发、转码与预览、缓存、系统信息、旧版数据导入、日志。 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScanLine } from 'lucide-react';
import type { AdminSettings } from '@luvia/contracts';
import { call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { q } from '@/lib/query';
import { Switch } from '@/components/kit/switch';
import { formatBytes, formatClock, formatJobResult, formatWhen, isActiveJob, jobView, num } from './format';
import FailuresSection from './FailuresSection';
import { overviewQuery, settingsQuery, useDeferredCommit, useJobs, useUpdateSettings, type SettingsPatch } from './hooks';
import { JobRow } from './OverviewTab';
import { Chip, Empty, Pill, QueryState, Section, Seg, SettingRow, inputClass, useFieldId, useSave } from './ui';

const INTERVALS = [15, 30, 60, 180, 360, 720, 1440, 10080];
const intervalLabel = (m: number) => (m < 60 ? `每 ${m} 分钟` : m < 1440 ? `每 ${m / 60} 小时` : m === 1440 ? '每天' : m % 10080 === 0 ? `每 ${m / 10080} 周` : `每 ${Math.round(m / 60)} 小时`);

function Range({ id, min, max, step = 1, value, onCommit, suffix = '' }: { id: string; min: number; max: number; step?: number; value: number; onCommit: (v: number) => void; suffix?: string }) {
  const [local, set] = useDeferredCommit(value, onCommit);
  return (
    <>
      <input id={id} type="range" min={min} max={max} step={step} value={local} onChange={(e) => set(Number(e.target.value))} className="min-w-0 flex-1 accent-[var(--accent)]" />
      <output htmlFor={id} className="min-w-[52px] text-right text-[13px] tabular-nums">{local}{suffix}</output>
    </>
  );
}

/* ---------- 扫描 ---------- */

function ScanSection({ s, save }: { s: AdminSettings; save: (p: SettingsPatch) => void }) {
  const scanAll = useSave({ fn: () => call('createJob', { body: { type: 'scan' } }), success: '已开始扫描全部媒体库，进度在概览里查看', invalidate: [['listJobs']] });
  const intervalId = useFieldId('si'), dailyId = useFieldId('sd');
  const [daily, setDaily] = useState(s.scan.dailyAt);
  const intervals = INTERVALS.includes(s.scan.intervalMinutes) ? INTERVALS : [...INTERVALS, s.scan.intervalMinutes].sort((a, b) => a - b);
  return (
    <Section
      title="全量对账"
      desc="实时监控负责日常变化；全量对账会完整核对一遍文件列表和修改时间，兜底监控遗漏的变化，新增或变化的文件再交给后台处理。"
      action={<Chip disabled={scanAll.isPending} onClick={() => scanAll.mutate(undefined)}><ScanLine />立即扫描全部</Chip>}
    >
      <SettingRow title="执行方式" desc={s.scan.mode === 'manual' ? '只在手动、服务启动和实时监控异常时执行。' : 'NAS 空闲时段执行，避免和备份任务抢硬盘。'}>
        <Seg
          label="全量对账方式"
          className="flex-1"
          value={s.scan.mode}
          onChange={(mode) => save({ scan: { mode } })}
          options={[{ value: 'manual', label: '只手动' }, { value: 'interval', label: '按间隔' }, { value: 'daily', label: '每天定时' }]}
        />
      </SettingRow>
      {s.scan.mode === 'interval' && (
        <SettingRow title="间隔" htmlFor={intervalId} desc="两次全量对账之间的时间。">
          <select id={intervalId} className={cn(inputClass, 'w-auto')} value={s.scan.intervalMinutes} onChange={(e) => save({ scan: { intervalMinutes: Number(e.target.value) } })}>
            {intervals.map((m) => <option key={m} value={m}>{intervalLabel(m)}</option>)}
          </select>
        </SettingRow>
      )}
      {s.scan.mode === 'daily' && (
        <SettingRow title="时间" htmlFor={dailyId} desc="按服务器本地时间。">
          <input
            id={dailyId}
            type="time"
            className={cn(inputClass, 'w-auto')}
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
            onBlur={() => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(daily) && daily !== s.scan.dailyAt) save({ scan: { dailyAt: daily } }); }}
          />
        </SettingRow>
      )}
    </Section>
  );
}

/* ---------- 后台处理与缓存 ---------- */

function WorkersSection({ s, save }: { s: AdminSettings; save: (p: SettingsPatch) => void }) {
  const sys = useQuery(q('system'));
  const ov = useQuery(overviewQuery);
  const prune = useSave({ fn: () => call('createJob', { body: { type: 'cache_prune' } }), success: '已开始清理缓存', invalidate: [['listJobs'], ['adminOverview']] });
  const thumbs = useSave({ fn: () => call('createJob', { body: { type: 'thumbnails' } }), success: '已开始生成缩略图，进度在概览里查看', invalidate: [['listJobs']] });
  const ids = { t: useFieldId('wt'), f: useFieldId('wf'), m: useFieldId('wm'), hw: useFieldId('hw'), c: useFieldId('cl') };
  const ff = sys.data?.ffmpeg;
  const hwHint = !sys.data ? '正在检测硬件加速…'
    : !ff?.available ? '没有检测到 FFmpeg，视频缩略图、预览和转码都不可用。'
      : ff.hwaccels.length ? `已检测到 ${ff.hwaccels.join('、')}。自动会优先使用可用的硬件编码，失败时改用 CPU。` : '没有检测到可用的硬件加速，转码使用 CPU。';
  const [limit, setLimit] = useDeferredCommit(s.cache.limitGB, (v) => save({ cache: { limitGB: v } }), 900);
  return (
    <>
      <Section title="后台处理" desc="缩略图、拍摄信息、视频预览都在独立的后台进程里处理，再忙也不会拖慢浏览。">
        <SettingRow title="缩略图同时处理数" htmlFor={ids.t} desc="数字越大越快，NAS 的 CPU 占用也越高。">
          <Range id={ids.t} min={1} max={64} value={s.workers.thumbnailConcurrency} onCommit={(v) => save({ workers: { thumbnailConcurrency: v } })} />
        </SettingRow>
        <SettingRow title="视频同时处理数" htmlFor={ids.f} desc="抽帧、预览短片和转码共用这个上限。">
          <Range id={ids.f} min={1} max={32} value={s.workers.ffmpegConcurrency} onCommit={(v) => save({ workers: { ffmpegConcurrency: v } })} />
        </SettingRow>
        <SettingRow title="拍摄信息同时读取数" htmlFor={ids.m} desc="每个媒体库后台读取拍摄时间、相机和位置的文件数。打开查看器时会立即读取当前文件，不用等后台。">
          <Range id={ids.m} min={1} max={64} value={s.workers.metadataConcurrency} onCommit={(v) => save({ workers: { metadataConcurrency: v } })} />
        </SettingRow>
        <SettingRow title="全库缩略图" desc="为所有照片和视频生成网格用的缩略图：已有的跳过，缺少的补上，缓存文件丢失的重新生成，同时记录原始宽高。每万个文件约占 0.8 GB 缓存，开始前请把缓存上限调到够用。">
          <Chip disabled={thumbs.isPending} onClick={() => thumbs.mutate(undefined)}>开始生成</Chip>
        </SettingRow>
        <SettingRow title="浏览器不能直接播放的视频自动转码" desc="例如 HEVC、MKV。关闭后这类视频只能下载观看。">
          <Switch checked={s.transcode.enabled} onCheckedChange={(v) => save({ transcode: { enabled: v } })} aria-label="自动转码" disabled={ff?.available === false} />
        </SettingRow>
        <SettingRow title="硬件加速" htmlFor={ids.hw} desc={hwHint}>
          <select id={ids.hw} className={cn(inputClass, 'w-auto')} value={s.transcode.hwaccel} disabled={!s.transcode.enabled} onChange={(e) => save({ transcode: { hwaccel: e.target.value as AdminSettings['transcode']['hwaccel'] } })}>
            <option value="auto">自动</option>
            <option value="none">不使用（CPU）</option>
            <option value="nvenc">NVIDIA NVENC</option>
            <option value="vaapi">VA-API（Intel / AMD）</option>
            <option value="qsv">Intel Quick Sync</option>
          </select>
        </SettingRow>
        <SettingRow title="生成视频悬停预览" desc="鼠标停在视频上时播放几秒预览，需要额外的缓存空间。">
          <Switch checked={s.previews.enabled} onCheckedChange={(v) => save({ previews: { enabled: v } })} aria-label="生成视频悬停预览" />
        </SettingRow>
      </Section>

      <Section
        title="缓存"
        desc="缩略图、预览和转码文件都可以重新生成，超过上限时先清理最久没看过的。"
        action={<Chip disabled={prune.isPending} onClick={() => prune.mutate(undefined)}>立即清理</Chip>}
      >
        <SettingRow title="缓存上限" htmlFor={ids.c} desc={ov.data ? `当前已用 ${formatBytes(ov.data.cache.bytes)}，数据库 ${formatBytes(ov.data.database.bytes)}。` : undefined}>
          <input
            id={ids.c}
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            className={cn(inputClass, 'w-28')}
            value={limit}
            onChange={(e) => { const v = Number(e.target.value); if (e.target.value !== '' && v >= 1 && v <= 10000) setLimit(v); }}
          />
          <span className="text-[13px] text-muted">GB</span>
        </SettingRow>
      </Section>
    </>
  );
}

/* ---------- 系统信息 ---------- */

function SystemSection() {
  const sys = useQuery(q('system'));
  const d = sys.data;
  const rows: [string, React.ReactNode][] = d ? [
    ['版本', <>{d.version}{d.commit && <span className="text-muted">（{d.commit}）</span>}</>],
    ['Node.js', d.node],
    ['平台', d.platform],
    ['SQLite', d.sqlite],
    ['FFmpeg', d.ffmpeg.available ? <>{d.ffmpeg.version ?? '已安装'}<span className="text-muted">，硬件加速 {d.ffmpeg.hwaccels.length ? d.ffmpeg.hwaccels.join('、') : '无'}</span></> : <span className="text-warn">未检测到，视频处理不可用</span>],
    ['图像处理', <>sharp {d.sharp.version}<span className="text-muted">，HEIF/HEIC {d.sharp.heif ? '可用' : '不可用'}</span></>],
    ['inotify 额度', d.inotify ? (
      <>已用 {num(d.inotify.used)} / {num(d.inotify.maxUserWatches)}
        {d.inotify.used / d.inotify.maxUserWatches > 0.8 && <span className="text-warn">，接近上限，部分目录会改为轮询。可在宿主机调大 fs.inotify.max_user_watches</span>}
      </>
    ) : <span className="text-muted">当前平台不使用 inotify</span>],
    ['数据目录', d.dataDir],
    ['缓存目录', d.cacheDir],
  ] : [];
  return (
    <Section title="系统信息">
      <QueryState loading={sys.isLoading} error={sys.error} onRetry={() => void sys.refetch()}>
        <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-1 px-[18px] py-4 text-[13px] sm:grid-cols-[120px_minmax(0,1fr)]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted max-sm:mt-1.5">{k}</dt>
              <dd className="m-0 break-all text-fg-2">{v}</dd>
            </div>
          ))}
        </dl>
      </QueryState>
    </Section>
  );
}

/* ---------- 旧版数据导入 ---------- */

function LegacySection() {
  const jobs = useJobs();
  const imports = (jobs.data?.jobs ?? []).filter((j) => j.type === 'import_legacy');
  const latest = imports[0];
  const run = useSave({ fn: () => call('createJob', { body: { type: 'import_legacy' } }), success: '已加入导入任务，完成后在这里查看结果', invalidate: [['listJobs']] });
  const res = latest?.result ?? null;
  const unmatched = res?.unmatchedFavorites ?? 0, pending = res?.pendingFavorites ?? 0;
  return (
    <Section
      title="旧版数据"
      desc="从 Luvia 1.x 导入用户、收藏、文件夹收藏和壁纸令牌。照片信息会由新版重新扫描，不沿用旧库。"
      action={<Chip disabled={run.isPending || (latest && isActiveJob(latest))} onClick={() => run.mutate(undefined)}>{latest ? '重新导入' : '导入旧版数据'}</Chip>}
    >
      <QueryState loading={jobs.isLoading} error={jobs.error}>
        {!latest ? <Empty>还没有导入过。旧版数据目录挂载到容器后，点“导入旧版数据”。</Empty> : isActiveJob(latest) ? <JobRow job={latest} /> : (
          <>
            <SettingRow title="上次导入" desc={formatWhen(latest.finishedAt ?? latest.createdAt) ?? undefined}>
              <Pill tone={jobView(latest).status.tone}>{jobView(latest).status.label}</Pill>
            </SettingRow>
            {latest.status === 'failed' && <SettingRow title="失败原因" desc={latest.error ?? '没有返回原因'}><span /></SettingRow>}
            {res && (
              <SettingRow title="导入结果" desc={formatJobResult(res)}>
                <span />
              </SettingRow>
            )}
            {res && (unmatched > 0 || pending > 0) && (
              <SettingRow
                title="收藏匹配"
                desc={<>{pending > 0 && <>{num(pending)} 项等待扫描后匹配。</>}{unmatched > 0 && <>{num(unmatched)} 项在新版扫描后找不到同一路径的文件，通常是文件被移动或改名了；这些记录会保留，不会被删除。</>}</>}
              >
                {unmatched > 0 && <Pill tone="warn">未匹配 {num(unmatched)}</Pill>}
              </SettingRow>
            )}
          </>
        )}
      </QueryState>
    </Section>
  );
}

/* ---------- 日志 ---------- */

type Level = '' | 'debug' | 'info' | 'warn' | 'error';
const LEVEL_TONE = { debug: 'muted', info: 'accent', warn: 'warn', error: 'bad' } as const;
const LEVEL_LABEL = { debug: '调试', info: '信息', warn: '警告', error: '错误' } as const;

function LogsSection() {
  const [level, setLevel] = useState<Level>('');
  const logs = useQuery({ ...q('logs', { query: { level: level || undefined, limit: 200 } }), refetchInterval: 15_000 });
  return (
    <Section
      title="日志"
      desc="最近的运行日志（内存中保留，重启后清空），不包含密码、令牌等敏感信息。"
      action={<Seg label="日志级别" value={level} onChange={setLevel} className="w-full sm:w-auto sm:min-w-[320px]" options={[{ value: '', label: '全部' }, { value: 'debug', label: '调试' }, { value: 'info', label: '信息' }, { value: 'warn', label: '警告' }, { value: 'error', label: '错误' }]} />}
    >
      <QueryState loading={logs.isLoading} error={logs.error} onRetry={() => void logs.refetch()}>
        {logs.data?.logs.length ? (
          <ol className="m-0 max-h-[360px] list-none overflow-y-auto p-0 py-2 text-[12.5px] leading-relaxed">
            {logs.data.logs.map((l, i) => (
              <li key={`${l.ts}-${i}`} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-2.5 px-[18px] py-0.5 max-sm:grid-cols-[auto_minmax(0,1fr)]">
                <time className="text-muted tabular-nums">{formatClock(l.ts)}</time>
                <Pill tone={LEVEL_TONE[l.level]} className="px-1.5 py-0 text-[11px] max-sm:justify-self-start">{LEVEL_LABEL[l.level]}</Pill>
                <span className="min-w-0 break-words text-fg-2 max-sm:col-span-2"><span className="text-muted">{l.source === 'api' ? '接口' : '后台'} · </span>{l.msg}</span>
              </li>
            ))}
          </ol>
        ) : <Empty>没有{level ? `“${LEVEL_LABEL[level]}”级别的` : ''}日志。</Empty>}
      </QueryState>
    </Section>
  );
}

export default function ProcessingTab() {
  const s = useQuery(settingsQuery);
  const upd = useUpdateSettings();
  const save = (p: SettingsPatch) => upd.mutate(p);
  return (
    <QueryState loading={s.isLoading} error={s.error} onRetry={() => void s.refetch()}>
      {s.data && (
        <>
          <ScanSection s={s.data} save={save} />
          <FailuresSection />
          <WorkersSection s={s.data} save={save} />
          <LegacySection />
          <SystemSection />
          <LogsSection />
        </>
      )}
    </QueryState>
  );
}
