/**
 * 控制台的纯逻辑：时间、容量、作业与监控状态文案、compose 卷映射片段、折线路径。
 * 不依赖 React，便于单元测试。
 */
import type { Job, LibraryWatch } from '@luvia/contracts';
import { ApiError } from '@/lib/api';

export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : '无法连接服务器，请检查网络后重试');

export const num = (n: number) => n.toLocaleString('zh-CN');

/** 0–1 的比例格式化为百分比，保留一位小数；100% 与 0% 不带小数。 */
export function pct(ratio: number) {
  const v = Math.max(0, Math.min(1, ratio)) * 100;
  if (v >= 100) return '100%';
  if (v <= 0) return '0%';
  return `${(Math.floor(v * 10) / 10).toFixed(1)}%`;
}

/** 字节数格式化（1024 进制，显示为 KB/MB/GB/TB）。返回 [数值, 单位]，便于大数字与单位分开排版。 */
export function bytesParts(b: number): [string, string] {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = Math.max(0, b), i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const s = i === 0 ? String(Math.round(v)) : v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
  return [s, units[i]!];
}
export const formatBytes = (b: number) => bytesParts(b).join(' ');

/** 运行时长：“6 天 14 小时”“3 小时 12 分钟”“5 分钟”。 */
export function formatUptime(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return h ? `${d} 天 ${h} 小时` : `${d} 天`;
  if (h) return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
  return `${Math.max(1, m)} 分钟`;
}

/** 时长：90 → “90 秒”，300 → “5 分钟”，5400 → “1.5 小时”，86400 → “1 天”。 */
export function formatSeconds(sec: number) {
  if (sec < 60) return `${Math.round(sec)} 秒`;
  if (sec < 3600) return sec % 60 === 0 ? `${sec / 60} 分钟` : `${Math.round(sec)} 秒`;
  if (sec < 86400) { const h = sec / 3600; return `${Number.isInteger(h) ? h : h.toFixed(1)} 小时`; }
  const d = sec / 86400;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} 天`;
}

/** 剩余时间：“预计还需 3 小时”。 */
export function formatEta(sec: number | null) {
  if (sec == null) return null;
  if (sec < 60) return '马上完成';
  if (sec < 3600) return `预计还需 ${Math.ceil(sec / 60)} 分钟`;
  if (sec < 86400) return `预计还需 ${Math.round(sec / 3600)} 小时`;
  return `预计还需 ${Math.round(sec / 86400)} 天`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * 面向人的时间：一小时内用“刚刚 / N 分钟前”，今天与昨天带时刻，今年内“10 月 2 日”，更早带年份。
 * 使用本地时区。
 */
export function formatWhen(iso: string | null | undefined, now: Date = new Date(), withTime = true) {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const diff = now.getTime() - t.getTime();
  if (diff >= 0 && diff < 60_000) return '刚刚';
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  if (sameDay(t, now)) return withTime ? `今天 ${hm}` : '今天';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(t, y)) return withTime ? `昨天 ${hm}` : '昨天';
  const md = `${t.getMonth() + 1} 月 ${t.getDate()} 日`;
  return t.getFullYear() === now.getFullYear() ? md : `${t.getFullYear()} 年 ${md}`;
}

/** 完整时刻，用于日志与变更记录：“11-05 08:12:30”。 */
export function formatClock(iso: string) {
  const t = new Date(iso);
  return `${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
}

/* ---------- 实时监控 ---------- */

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'accent';

export interface WatchSummary {
  tone: Tone;
  /** 状态短语，例如“监视中 19 个目录”。 */
  label: string;
  /** 补充说明：降级原因或模式解释。 */
  detail: string | null;
}

/** 媒体库实时监控状态文案。 */
export function watchSummary(w: LibraryWatch): WatchSummary {
  const every = formatSeconds(w.pollIntervalSec);
  switch (w.state) {
    case 'watching':
      return {
        tone: 'ok',
        label: w.watchedDirs != null ? `实时监控中，监视 ${num(w.watchedDirs)} 个目录` : '实时监控中',
        detail: w.degradedReason,
      };
    case 'polling':
      return {
        tone: w.degradedReason ? 'warn' : 'accent',
        label: `轮询中，每 ${every}对账一次`,
        detail: w.degradedReason ?? (w.mode === 'poll' ? '按设置定期检查文件变化。' : null),
      };
    case 'degraded':
      return { tone: 'warn', label: '已降级', detail: w.degradedReason ?? '部分目录无法实时监视，已改为定期对账。' };
    case 'starting':
      return { tone: 'muted', label: '正在建立监视', detail: null };
    case 'off':
      return { tone: 'muted', label: '实时监控已关闭', detail: '只在手动扫描和定时全量对账时更新。' };
  }
}

export const WATCH_MODES = [
  { value: 'auto', label: '自动', hint: '本地磁盘实时监视；网络挂载或监视额度不足时改为定期对账。' },
  { value: 'watch', label: '实时', hint: '强制实时监视。额度不足时仍会降级，并在这里说明原因。' },
  { value: 'poll', label: '轮询', hint: '按下面的间隔定期对账，适合 NFS、SMB 等网络挂载。' },
  { value: 'off', label: '关闭', hint: '只在手动扫描和定时全量对账时更新。' },
] as const;

/* ---------- 作业 ---------- */

export const JOB_STATUS: Record<Job['status'], { label: string; tone: Tone }> = {
  queued: { label: '排队', tone: 'muted' },
  running: { label: '进行中', tone: 'accent' },
  paused: { label: '已暂停', tone: 'warn' },
  succeeded: { label: '完成', tone: 'ok' },
  failed: { label: '失败', tone: 'bad' },
  cancelled: { label: '已取消', tone: 'muted' },
};

export const isActiveJob = (j: Pick<Job, 'status'>) => j.status === 'queued' || j.status === 'running' || j.status === 'paused';

/** 结果摘要字段的中文名；契约未定义固定键，未知键原样显示。 */
const RESULT_LABELS: Record<string, string> = {
  added: '新增', updated: '更新', removed: '删除', moved: '移动', missing: '缺失', restored: '恢复', skipped: '跳过', failed: '失败',
  generated: '已生成', freedBytes: '释放',
  users: '用户', favorites: '收藏', favoriteFolders: '文件夹收藏', albums: '相册', tokens: '令牌', wallpaperTokens: '壁纸令牌',
  pendingFavorites: '等待扫描后匹配的收藏', unmatchedFavorites: '未匹配收藏',
};

export function formatJobResult(result: Record<string, number> | null) {
  if (!result) return null;
  const parts = Object.entries(result).map(([k, v]) => `${RESULT_LABELS[k] ?? k} ${k === 'freedBytes' ? formatBytes(v) : num(v)}`);
  return parts.length ? parts.join('，') : null;
}

export interface JobView {
  /** 进度条宽度 0–100；null 表示总量未知（显示不确定进度）。 */
  pct: number | null;
  status: { label: string; tone: Tone };
  /** 第二行说明。 */
  detail: string;
  actions: ('pause' | 'resume' | 'cancel' | 'retry')[];
}

export function jobView(j: Job): JobView {
  const { done, total } = j.progress;
  const status = JOB_STATUS[j.status];
  let p: number | null;
  if (j.status === 'succeeded' || j.status === 'failed') p = 100;
  else if (j.status === 'queued') p = 0;
  else if (total == null || total <= 0) p = j.status === 'cancelled' ? 0 : null;
  else p = Math.min(100, Math.round((done / total) * 1000) / 10);

  const counter = total != null ? `${num(done)} / ${num(total)}` : done ? `已处理 ${num(done)} 项` : null;
  let detail: string;
  if (j.status === 'failed') detail = j.error ?? '执行失败，可以重试';
  else if (j.status === 'succeeded') detail = formatJobResult(j.result) ?? '已完成';
  else if (j.status === 'cancelled') detail = counter ? `已取消，${counter}` : '已取消';
  else if (j.status === 'queued') detail = '等待前面的任务完成';
  else detail = [j.message, counter, j.status === 'running' ? formatEta(j.etaSec) : null].filter(Boolean).join(' · ') || '正在准备';

  const actions: JobView['actions'] =
    j.status === 'running' ? ['pause', 'cancel']
      : j.status === 'paused' ? ['resume', 'cancel']
        : j.status === 'queued' ? ['cancel']
          : j.status === 'failed' || j.status === 'cancelled' ? ['retry'] : [];
  return { pct: p, status, detail, actions };
}

/* ---------- 变更记录 ---------- */

export const CHANGE_KIND: Record<'added' | 'updated' | 'moved' | 'missing' | 'restored' | 'removed', { label: string; tone: Tone }> = {
  added: { label: '新增', tone: 'ok' },
  updated: { label: '修改', tone: 'accent' },
  moved: { label: '移动', tone: 'accent' },
  missing: { label: '缺失', tone: 'warn' },
  restored: { label: '恢复', tone: 'ok' },
  removed: { label: '清理', tone: 'bad' },
};
export const CHANGE_SOURCE: Record<'watch' | 'poll' | 'scan', string> = { watch: '实时', poll: '轮询', scan: '扫描' };

/* ---------- 列表与路径 ---------- */

/** 逗号或换行分隔的列表，去空白、去重，保持顺序。 */
export function parseList(text: string) {
  const out: string[] = [];
  for (const s of text.split(/[,，\n]/)) {
    const v = s.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 虚拟文件夹路径的显示名：photos/2024/成都 → “照片库 / 2024 / 成都”。 */
export function folderLabel(path: string, libNames: Record<string, string>) {
  const [lib, ...rest] = path.split('/');
  return [libNames[lib!] ?? lib, ...rest].join(' / ');
}

/* ---------- docker-compose 卷映射 ---------- */

const RESERVED = ['/', '/data', '/cache', '/app', '/proc', '/sys', '/dev', '/etc', '/tmp', '/usr', '/bin', '/lib', '/root'];

export interface VolumeResult {
  ok: boolean;
  /** 一行卷映射，例如 `- /vol1/1000/Music:/media/music:ro`。 */
  line: string;
  /** 容器内路径（启用后会出现在“检测到的新目录”里）。 */
  containerPath: string;
  error: string | null;
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/**
 * 由宿主机路径与容器内名称（或绝对路径）生成 compose 短语法卷映射。
 * 容器内只填名称时放在 /media/ 下；路径含空格、引号或 # 时整体加双引号。
 */
export function composeVolume(hostInput: string, containerInput: string, readOnly = true): VolumeResult {
  const host = trimSlash(hostInput.trim());
  const rawC = containerInput.trim();
  const container = rawC ? trimSlash(rawC.startsWith('/') ? rawC : `/media/${rawC.replace(/^\.?\/*/, '')}`) : '';
  const fail = (error: string): VolumeResult => ({ ok: false, line: '', containerPath: container, error });
  if (!host) return fail('填写宿主机上的目录路径，例如 /vol1/1000/Music');
  if (!/^(\/|\.\.?\/|~\/)/.test(host)) return fail('宿主机路径需要以 / 开头（或以 ./ 表示相对 docker-compose.yml 所在目录）');
  if (host.includes(':')) return fail('宿主机路径里不能有冒号，compose 会把冒号当作分隔符');
  if (!container) return fail('填写容器内的名称，例如 music');
  if (container.includes(':')) return fail('容器内路径里不能有冒号');
  if (RESERVED.some((r) => container === r || (r !== '/' && container.startsWith(r + '/')))) {
    return fail(`${container} 是容器的系统目录，换一个名称，例如 /media/music`);
  }
  if (container.split('/').some((s) => s === '..' || s === '.')) return fail('容器内路径不能包含 . 或 ..');
  const spec = `${host}:${container}${readOnly ? ':ro' : ''}`;
  const needsQuote = /[\s"'#]/.test(spec);
  const line = `- ${needsQuote ? `"${spec.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : spec}`;
  return { ok: true, line, containerPath: container, error: null };
}

/** 由宿主机路径推荐容器内名称：取最后一级目录，转小写，空白换成连字符。 */
export function suggestContainerName(host: string) {
  const base = trimSlash(host.trim()).split('/').filter(Boolean).at(-1) ?? '';
  return base === '.' || base === '..' || base === '~' ? '' : base.toLowerCase().replace(/\s+/g, '-');
}

/** 完整片段：缩进到 services.<name>.volumes 之下。 */
export const composeSnippet = (line: string, service = 'luvia') => `services:\n  ${service}:\n    volumes:\n      ${line}`;

/* ---------- 折线 ---------- */

/**
 * 把数值序列映射到 w×h 的 SVG 折线（line）与面积（area）路径。max 省略时取序列最大值的 1.15 倍。
 * 上下各留 pad 像素，避免描边被裁切。
 */
export function sparkPaths(values: number[], w: number, h: number, max?: number, padY = 3) {
  if (values.length === 0) return { line: '', area: '', last: null as null | { x: number; y: number } };
  const top = max ?? Math.max(1, ...values) * 1.15;
  const n = values.length;
  const pts = values.map((v, i) => {
    const x = n === 1 ? w : (i / (n - 1)) * w;
    const y = h - padY - (Math.max(0, Math.min(v, top)) / top) * (h - padY * 2);
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
  const area = `${line} L${pts[pts.length - 1]![0]} ${h} L${pts[0]![0]} ${h} Z`;
  const [lx, ly] = pts[pts.length - 1]!;
  return { line, area, last: { x: lx, y: ly } };
}
