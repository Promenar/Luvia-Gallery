/**
 * 媒体库：已启用的库（实时监控状态、扫描、设置、最近变更）、检测到的新目录、系统目录、添加目录说明与规则。
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronRight, Folder, History, Plus, ScanLine, Settings2 } from 'lucide-react';
import type { z } from 'zod';
import { mediaUrls, type Library, type Mount as MountSchema } from '@luvia/contracts';
import { call } from '@/lib/api';
import { cn } from '@/lib/cn';
import { q } from '@/lib/query';
import { Switch } from '@/components/kit/switch';
import { thumbhashUrl } from '@/components/media/Thumb';
import {
  CHANGE_KIND, CHANGE_SOURCE, WATCH_MODES, composeSnippet, composeVolume, suggestContainerName, errMsg, formatClock, formatWhen, num, parseList, watchSummary,
} from './format';
import { callWith, qWith, settingsQuery, useDeferredCommit, useUpdateSettings } from './hooks';

type Mount = z.infer<typeof MountSchema>;
import {
  Chip, CodeBlock, Confirm, Empty, Field, LiveDot, Modal, OutBox, Pill, QueryState, Section, Seg, SettingRow, Tag, inputClass, useFieldId, useSave,
} from './ui';

const STATUS: Record<Library['status'], { label: string; tone: 'ok' | 'warn' | 'bad' | 'accent' }> = {
  ok: { label: '正常', tone: 'ok' },
  slow: { label: '响应缓慢', tone: 'warn' },
  unavailable: { label: '无法访问', tone: 'bad' },
  scanning: { label: '扫描中', tone: 'accent' },
};

function Thumb({ cover }: { cover: { id: string; thumbhash: string | null; thumbVersion: number } | null | undefined }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative grid h-10 w-12 shrink-0 place-items-center overflow-hidden rounded-[var(--r1)] bg-sunken text-muted md:h-12 md:w-16">
      {cover ? (
        <>
          {thumbhashUrl(cover) && <img alt="" src={thumbhashUrl(cover)} className="absolute inset-0 size-full object-cover" />}
          <img alt="" loading="lazy" src={mediaUrls.thumb(cover.id, 's', cover.thumbVersion)} onLoad={() => setLoaded(true)} className={cn('absolute inset-0 size-full object-cover transition-opacity', loaded ? 'opacity-100' : 'opacity-0')} />
        </>
      ) : <Folder className="size-5" strokeWidth={1.6} />}
    </div>
  );
}

function Paths({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="mt-1 mb-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 text-[12.5px] text-fg-2">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="m-0 break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const rowClass = 'grid grid-cols-[48px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 border-b border-line px-[18px] py-3.5 last:border-b-0 md:grid-cols-[64px_minmax(0,1fr)_minmax(0,240px)_auto] md:gap-x-4';

/* ---------- 已启用的媒体库 ---------- */

function WatchLine({ lib }: { lib: Library }) {
  const w = watchSummary(lib.watch);
  const ev = formatWhen(lib.watch.lastEventAt);
  const rec = formatWhen(lib.watch.lastReconcileAt);
  return (
    <div className="grid gap-0.5">
      <span className="flex items-center gap-1.5 text-[12.5px] text-fg-2">
        <LiveDot tone={w.tone} />
        {w.label}
      </span>
      {w.detail && <small className={cn('text-[12px]', w.tone === 'warn' ? 'text-warn' : 'text-muted')}>{w.detail}</small>}
      {(ev || rec) && (
        <small className="text-[12px] text-muted">
          {[ev && `最近事件 ${ev}`, rec && `最近对账 ${rec}`].filter(Boolean).join('，')}
        </small>
      )}
    </div>
  );
}

function LibraryRow({ lib, cover, readOnly }: { lib: Library; cover: Parameters<typeof Thumb>[0]['cover']; readOnly?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [history, setHistory] = useState(false);
  const scan = useSave({
    fn: () => call('createJob', { body: { type: 'scan', libraryId: lib.id } }),
    success: `已开始扫描「${lib.name}」，进度在概览里查看`,
    invalidate: [['listJobs'], ['listLibraries']],
  });
  const enable = useSave({
    fn: () => callWith('updateLibrary', { id: lib.id }, { body: { enabled: true } }),
    success: `已重新启用「${lib.name}」`,
    invalidate: [['listLibraries']],
  });
  const st = STATUS[lib.status];
  const scanned = formatWhen(lib.lastScanAt);
  return (
    <div className={cn(rowClass, !lib.enabled && 'opacity-70')}>
      <Thumb cover={cover} />
      <div className="min-w-0">
        <b className="block font-semibold">{lib.name}</b>
        <Paths rows={[
          ['宿主机', lib.hostRoot ? (
            <>{lib.hostRoot}<Tag title={lib.hostRootSource === 'manual' ? '管理员在设置里填写' : '从容器挂载信息自动识别，可以在设置里修改'}>{lib.hostRootSource === 'manual' ? '手动填写' : '自动识别'}</Tag></>
          ) : <span className="text-muted">未能识别，可以在设置里填写</span>],
          ['容器内', <>{lib.root}{readOnly && <Tag title="以只读方式挂载，Luvia 不会写入这个目录">只读</Tag>}</>],
        ]} />
      </div>
      <div className="col-start-2 grid min-w-0 gap-1.5 md:col-start-auto">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {lib.enabled ? <Pill tone={st.tone}>{st.label}</Pill> : <Pill tone="muted">已停用</Pill>}
          <small className="text-[12px] text-muted">{num(lib.mediaCount)} 项{scanned ? `，${scanned} 扫描` : '，还没有扫描过'}</small>
        </div>
        {lib.enabled && <WatchLine lib={lib} />}
      </div>
      <div className="col-start-2 flex flex-wrap justify-start gap-1.5 md:col-start-auto md:justify-end">
        {lib.enabled ? (
          <Chip size="sm" disabled={scan.isPending || lib.status === 'scanning'} onClick={() => scan.mutate(undefined)}><ScanLine />立即扫描</Chip>
        ) : (
          <Chip size="sm" disabled={enable.isPending} onClick={() => enable.mutate(undefined)}>重新启用</Chip>
        )}
        <Chip size="sm" onClick={() => setHistory(true)}><History />最近变更</Chip>
        <Chip size="sm" onClick={() => setEditing(true)}><Settings2 />设置</Chip>
      </div>
      {editing && <LibrarySettings lib={lib} open={editing} onOpenChange={setEditing} />}
      {history && <ChangesDialog lib={lib} open={history} onOpenChange={setHistory} />}
    </div>
  );
}

function LibrarySettings({ lib, open, onOpenChange }: { lib: Library; open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState(lib.name);
  const [host, setHost] = useState(lib.hostRootSource === 'manual' ? lib.hostRoot ?? '' : '');
  const [exclude, setExclude] = useState(lib.exclude.join(', '));
  const [mode, setMode] = useState(lib.watch.mode);
  const [pollMin, setPollMin] = useState(String(Math.round(lib.watch.pollIntervalSec / 60)));
  const [enabled, setEnabled] = useState(lib.enabled);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ids = { name: useFieldId('ln'), host: useFieldId('lh'), ex: useFieldId('le'), poll: useFieldId('lp') };
  const autoHost = lib.hostRootSource === 'auto' ? lib.hostRoot : null;

  const pollSec = Math.round(Number(pollMin) * 60);
  const pollInvalid = !(pollSec >= 60 && pollSec <= 86400);
  const save = useSave({
    fn: () => callWith('updateLibrary', { id: lib.id }, {
      body: {
        name: name.trim(),
        enabled,
        hostRoot: host.trim() ? host.trim() : null,
        exclude: parseList(exclude),
        watch: { mode, pollIntervalSec: pollInvalid ? lib.watch.pollIntervalSec : pollSec },
      },
    }),
    success: `已保存「${name.trim()}」的设置`,
    invalidate: [['listLibraries'], ['mounts'], ['folders']],
    onSuccess: () => onOpenChange(false),
  });
  const del = useSave({
    fn: () => callWith('deleteLibrary', { id: lib.id }),
    success: `已删除「${lib.name}」的索引，磁盘上的文件没有变动`,
    invalidate: [['listLibraries'], ['mounts'], ['folders'], ['adminOverview']],
    onSuccess: () => { setConfirmDelete(false); onOpenChange(false); },
  });
  const modeHint = WATCH_MODES.find((m) => m.value === mode)?.hint;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="媒体库设置"
      desc={lib.root}
      footer={<>
        <Chip variant="danger" className="mr-auto" onClick={() => setConfirmDelete(true)}>删除索引</Chip>
        <Chip onClick={() => onOpenChange(false)}>取消</Chip>
        <Chip variant="primary" disabled={!name.trim() || (mode !== 'off' && pollInvalid) || save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending ? '正在保存…' : '保存'}</Chip>
      </>}
    >
      <form className="grid gap-3.5" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <Field label="显示名称" htmlFor={ids.name}>
          <input id={ids.name} className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="宿主机路径"
          htmlFor={ids.host}
          hint={autoHost || lib.hostRootSource === 'manual'
            ? <>只影响显示。{lib.hostRootSource === 'manual' ? '当前为手动填写，清空后恢复自动识别。' : `自动识别为 ${autoHost}，经过多层挂载、识别不准时在这里改正。`}</>
            : '没有从容器挂载信息识别到宿主机路径，可以手动填写，只影响显示。'}
        >
          <input id={ids.host} className={inputClass} value={host} placeholder={autoHost ?? '/vol1/1000/Photos'} onChange={(e) => setHost(e.target.value)} />
        </Field>
        <Field label="跳过的目录" htmlFor={ids.ex} hint="目录名或相对路径的通配规则，用逗号或换行分隔，例如 @eaDir, .*, 导出/草稿">
          <textarea id={ids.ex} rows={2} className={cn(inputClass, 'h-auto resize-y py-2 leading-relaxed')} value={exclude} onChange={(e) => setExclude(e.target.value)} />
        </Field>
        <div className="grid gap-1.5">
          <span className="text-[12.5px] font-semibold text-fg-2">实时监控</span>
          <Seg label="实时监控模式" value={mode} onChange={setMode} options={WATCH_MODES} />
          <small className="text-[12px] text-muted">{modeHint}</small>
        </div>
        {mode !== 'off' && (
          <Field label="轮询间隔（分钟）" htmlFor={ids.poll} hint={mode === 'poll' ? '1–1440 分钟。' : '无法实时监视、改为轮询时使用，1–1440 分钟。'}>
            <input id={ids.poll} type="number" inputMode="numeric" min={1} max={1440} className={cn(inputClass, 'w-32')} aria-invalid={pollInvalid || undefined} value={pollMin} onChange={(e) => setPollMin(e.target.value)} />
          </Field>
        )}
        <label className="flex items-center justify-between gap-3 text-[13px] text-fg-2">
          <span>
            <b className="block font-medium text-fg">启用这个媒体库</b>
            <small className="text-[12px] text-muted">停用后保留索引但不再显示和更新，随时可以重新启用。</small>
          </span>
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="启用这个媒体库" />
        </label>
        <button type="submit" hidden />
      </form>
      <Confirm
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`删除「${lib.name}」的索引？`}
        desc={<>这个库的 {num(lib.mediaCount)} 项媒体会从时间线、文件夹和相册中消失。只删除 Luvia 里的索引记录，{lib.root} 里的文件不会被移动或删除；之后可以在“检测到的新目录”里重新启用。</>}
        action="删除索引"
        pending={del.isPending}
        onConfirm={() => del.mutate(undefined)}
      />
    </Modal>
  );
}

function ChangesDialog({ lib, open, onOpenChange }: { lib: Library; open: boolean; onOpenChange: (v: boolean) => void }) {
  const ch = useQuery(qWith('libraryChanges', { id: lib.id }, { query: { limit: 100 } }));
  const list = ch.data?.changes ?? [];
  return (
    <Modal open={open} onOpenChange={onOpenChange} wide title={`「${lib.name}」最近变更`} desc="实时监控、轮询对账与扫描写入的变化，最新在前，保留最近 30 天。">
      <QueryState loading={ch.isLoading} error={ch.error} onRetry={() => void ch.refetch()}>
        {list.length === 0 ? <p className="m-0 text-[13px] text-muted">最近 30 天没有变化。</p> : (
          <ol className="m-0 grid list-none overflow-hidden rounded-[var(--r2)] border border-line p-0">
            {list.map((c, i) => {
              const k = CHANGE_KIND[c.kind];
              return (
                <li key={i} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-b border-line px-3 py-2.5 text-[13px] last:border-b-0">
                  <Pill tone={k.tone} className="row-span-2 self-start">{k.label}</Pill>
                  <div className="min-w-0 break-all">
                    {c.kind === 'moved' && c.fromPath ? (
                      <><span className="text-muted">从</span> {c.fromPath} <span className="text-muted">→ 到</span> {c.path}</>
                    ) : c.path}
                    {c.isDir && <Tag>目录</Tag>}
                  </div>
                  <small className="text-[12px] text-muted tabular-nums">{formatClock(c.ts)} · 来自{CHANGE_SOURCE[c.source]}</small>
                </li>
              );
            })}
          </ol>
        )}
      </QueryState>
    </Modal>
  );
}

/* ---------- 新目录与系统目录 ---------- */

const baseName = (p: string) => p.split('/').filter(Boolean).at(-1) ?? p;

function CandidateRow({ m }: { m: Mount }) {
  const [name, setName] = useState(baseName(m.containerPath));
  const id = useFieldId('cn');
  const enable = useSave({
    fn: async () => {
      const lib = await call('createLibrary', { body: { name: name.trim(), root: m.containerPath, enabled: true } });
      try {
        await call('createJob', { body: { type: 'scan', libraryId: lib.id } });
        return { lib, queued: true };
      } catch (e) {
        toast.error(`已启用「${lib.name}」，但首次扫描没有加入队列：${errMsg(e)}。可以在媒体库里点“立即扫描”。`);
        return { lib, queued: false };
      }
    },
    success: (d) => (d.queued ? `已启用「${d.lib.name}」，首次扫描已加入任务队列` : null),
    invalidate: [['listLibraries'], ['mounts'], ['listJobs'], ['folders']],
  });
  return (
    <div className={rowClass}>
      <Thumb cover={null} />
      <div className="min-w-0">
        <b className="block font-semibold break-all">{m.containerPath}{m.readOnly && <Tag title="以只读方式挂载">只读</Tag>}</b>
        <Paths rows={[
          ['宿主机', m.hostPath ?? <span className="text-muted">未能识别</span>],
          ['抽样', m.mediaEstimate != null ? `约 ${num(m.mediaEstimate)} 个媒体文件` : '无法估计'],
        ]} />
      </div>
      <div className="col-start-2 grid min-w-0 gap-1.5 md:col-start-auto">
        <label htmlFor={id} className="text-[12.5px] font-semibold text-fg-2">显示名称</label>
        <input id={id} className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) enable.mutate(undefined); }} />
      </div>
      <div className="col-start-2 flex md:col-start-auto md:justify-end">
        <Chip size="sm" variant="primary" disabled={!name.trim() || enable.isPending} onClick={() => enable.mutate(undefined)}>{enable.isPending ? '正在启用…' : '启用并扫描'}</Chip>
      </div>
    </div>
  );
}

const SYSTEM_USE: Record<string, string> = { '/data': '数据库、设置与日志', '/cache': '缩略图、预览与转码缓存' };

function PlainMountRow({ m }: { m: Mount }) {
  return (
    <div className={cn(rowClass, 'opacity-70')}>
      <Thumb cover={null} />
      <div className="min-w-0">
        <b className="block font-semibold break-all">{m.containerPath}</b>
        <Paths rows={[['宿主机', m.hostPath ?? '未能识别'], ...(SYSTEM_USE[m.containerPath] ? [['用途', SYSTEM_USE[m.containerPath]!] as [string, string]] : [])]} />
      </div>
      <div className="col-start-2 md:col-start-auto"><Pill tone="muted">{m.kind === 'system' ? '系统目录' : '其它挂载'}</Pill></div>
      <div className="hidden md:block" />
    </div>
  );
}

/* ---------- 添加目录 ---------- */

function AddDirectoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [host, setHost] = useState('');
  const [cname, setCname] = useState('');
  const [ro, setRo] = useState(true);
  const ids = { host: useFieldId('ah'), c: useFieldId('ac') };
  // 宿主机路径填写后，容器内名称默认取最后一级目录
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (!touched) setCname(suggestContainerName(host)); }, [host, touched]);
  const r = composeVolume(host, cname, ro);
  const snippet = r.ok ? composeSnippet(r.line) : '';
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="添加目录" desc="Luvia 只能读取已经挂载进容器的目录。要添加宿主机上的其它目录，先在 docker-compose.yml 里挂载，再重启容器。" footer={<Chip onClick={() => onOpenChange(false)}>关闭</Chip>}>
      <div className="grid gap-3.5">
        <Field label="宿主机上的目录" htmlFor={ids.host} hint="NAS 或服务器上的真实路径。">
          <input id={ids.host} className={inputClass} value={host} placeholder="/vol1/1000/Music" autoComplete="off" spellCheck={false} onChange={(e) => setHost(e.target.value)} />
        </Field>
        <Field label="容器内的名称" htmlFor={ids.c} hint={r.containerPath ? `挂载到容器内的 ${r.containerPath}` : '只填名称时放在 /media/ 下，也可以填完整路径。'}>
          <input id={ids.c} className={inputClass} value={cname} placeholder="music" autoComplete="off" spellCheck={false} onChange={(e) => { setTouched(true); setCname(e.target.value); }} />
        </Field>
        <label className="flex items-center justify-between gap-3 text-[13px] text-fg-2">
          <span>以只读方式挂载<small className="block text-[12px] text-muted">推荐。Luvia 不会写入媒体目录，只读挂载可以防止任何意外修改。</small></span>
          <Switch checked={ro} onCheckedChange={setRo} aria-label="以只读方式挂载" />
        </label>
        <div>
          <span className="text-[12.5px] font-semibold text-fg-2">在 luvia 服务的 volumes 下追加</span>
          {r.ok ? (
            <>
              <div className="mt-2"><OutBox mono copy={r.line} copyLabel="复制卷映射">{r.line}</OutBox></div>
              <CodeBlock>{snippet}</CodeBlock>
            </>
          ) : <p className={cn('m-0 mt-1.5 text-[12.5px]', host || cname ? 'text-warn' : 'text-muted')}>{r.error}</p>}
        </div>
        <ol className="m-0 grid gap-1.5 pl-5 text-[13px] text-fg-2">
          <li>把上面这一行加到 docker-compose.yml，保存。</li>
          <li>在 compose 文件所在目录运行 <code className="rounded bg-sunken px-1 font-mono text-[12px]">docker compose up -d</code> 重建容器。</li>
          <li>回到这里，新目录会出现在“检测到的新目录”中，填写名称后启用。</li>
        </ol>
      </div>
    </Modal>
  );
}

/* ---------- 规则 ---------- */

function Rules() {
  const s = useQuery(settingsQuery);
  const upd = useUpdateSettings();
  const [confirmAuto, setConfirmAuto] = useState(false);
  const grace = s.data?.libraries.missingGraceDays ?? 7;
  const [graceLocal, setGrace] = useDeferredCommit(grace, (v) => upd.mutate({ libraries: { missingGraceDays: v } }), 900);
  const graceId = useFieldId('gr');
  return (
    <Section title="规则">
      <QueryState loading={s.isLoading} error={s.error} onRetry={() => void s.refetch()}>
        {s.data && (
          <>
            <SettingRow title="自动启用新挂载的目录" desc="打开后，新挂载进容器的目录会直接建立索引并开始扫描。备份盘、下载目录这类挂载也会被扫进来，占用缩略图缓存和 CPU；建议保持关闭，逐个确认。">
              <Switch
                checked={s.data.libraries.autoEnableNewMounts}
                onCheckedChange={(v) => (v ? setConfirmAuto(true) : upd.mutate({ libraries: { autoEnableNewMounts: false } }))}
                aria-label="自动启用新挂载的目录"
              />
            </SettingRow>
            <SettingRow title="缺失文件保留天数" htmlFor={graceId} desc="文件从磁盘消失后，收藏、相册关系和缩略图保留的天数；期间文件回来会自动恢复。0 表示下一次对账就清理。">
              <input
                id={graceId}
                type="number"
                inputMode="numeric"
                min={0}
                max={365}
                className={cn(inputClass, 'w-24')}
                value={graceLocal}
                onChange={(e) => { const v = Math.round(Number(e.target.value)); if (e.target.value !== '' && v >= 0 && v <= 365) setGrace(v); }}
              />
              <span className="text-[13px] text-muted">天</span>
            </SettingRow>
            <SettingRow title="向家庭成员显示宿主机路径" desc="关闭后，只有管理员能在文件夹页看到 /vol1/... 这样的真实路径。">
              <Switch checked={s.data.folders.exposeHostPaths} onCheckedChange={(v) => upd.mutate({ folders: { exposeHostPaths: v } })} aria-label="向家庭成员显示宿主机路径" />
            </SettingRow>
          </>
        )}
      </QueryState>
      <Confirm
        open={confirmAuto}
        onOpenChange={setConfirmAuto}
        danger={false}
        title="自动启用新挂载的目录？"
        desc="以后每次容器启动，新出现的挂载目录都会直接建立索引并开始扫描，不再等你确认。系统目录不受影响。"
        action="打开自动启用"
        pending={upd.isPending}
        onConfirm={() => { upd.mutate({ libraries: { autoEnableNewMounts: true } }); setConfirmAuto(false); }}
      />
    </Section>
  );
}

/* ---------- 页面 ---------- */

export default function LibrariesTab() {
  const libs = useQuery(q('listLibraries'));
  const mounts = useQuery(q('mounts'));
  const roots = useQuery(q('folders', { query: {} }));
  const [adding, setAdding] = useState(false);
  const [showOther, setShowOther] = useState(false);

  const covers = useMemo(() => Object.fromEntries((roots.data?.folders ?? []).map((f) => [f.path, f.cover])), [roots.data]);
  const byKind = (k: Mount['kind']) => (mounts.data?.mounts ?? []).filter((m) => m.kind === k);
  const readOnlyOf = (lib: Library) => mounts.data?.mounts.find((m) => m.libraryId === lib.id)?.readOnly;
  const candidates = byKind('candidate'), system = byKind('system'), other = byKind('other');

  return (
    <>
      <Section
        title="媒体库"
        desc="只有启用的目录会建立索引。Luvia 只读取这些目录，不会移动、改名或删除任何文件。"
        action={<Chip onClick={() => setAdding(true)}><Plus />添加目录</Chip>}
      >
        <QueryState loading={libs.isLoading} error={libs.error} onRetry={() => void libs.refetch()}>
          {libs.data?.libraries.length ? libs.data.libraries.map((l) => <LibraryRow key={l.id} lib={l} cover={covers[l.id]} readOnly={readOnlyOf(l)} />)
            : <Empty>还没有媒体库。在下方“检测到的新目录”里启用一个，或者先添加目录。</Empty>}
        </QueryState>
      </Section>

      <Section title="检测到的新目录" desc="容器每次启动都会检查挂载列表。新目录不会自动建立索引，确认后再启用，避免把备份盘或下载目录也扫进来。">
        <QueryState loading={mounts.isLoading} error={mounts.error} onRetry={() => void mounts.refetch()}>
          {candidates.length ? candidates.map((m) => <CandidateRow key={m.containerPath} m={m} />) : <Empty>没有新的挂载目录。需要添加时，点上方的“添加目录”查看挂载方法。</Empty>}
        </QueryState>
      </Section>

      <Section title="不会建立索引的目录" desc="数据和缓存目录由 Luvia 自己使用，不能作为媒体库。">
        <QueryState loading={mounts.isLoading} error={mounts.error}>
          {system.map((m) => <PlainMountRow key={m.containerPath} m={m} />)}
          {other.length > 0 && (
            <>
              <button
                type="button"
                aria-expanded={showOther}
                onClick={() => setShowOther(!showOther)}
                className="flex w-full items-center gap-1.5 border-b border-line px-[18px] py-3 text-left text-[13px] text-fg-2 last:border-b-0 hover:bg-accent-soft"
              >
                <ChevronRight className={cn('size-4 text-muted transition-transform', showOther && 'rotate-90')} />
                其它挂载 {other.length} 个
                <small className="text-[12px] text-muted">（/etc/hosts 等与媒体无关的系统挂载）</small>
              </button>
              {showOther && other.map((m) => <PlainMountRow key={m.containerPath} m={m} />)}
            </>
          )}
        </QueryState>
      </Section>

      <Rules />
      {adding && <AddDirectoryDialog open={adding} onOpenChange={setAdding} />}
    </>
  );
}

