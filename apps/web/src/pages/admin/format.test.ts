import { describe, expect, it } from 'vitest';
import type { Job, LibraryWatch } from '@luvia/contracts';
import {
  bytesParts, composeSnippet, composeVolume, suggestContainerName, folderLabel, formatEta, formatJobResult, formatSeconds, formatUptime, formatWhen, jobView, parseList, pct,
  sparkPaths, watchSummary,
} from './format';

describe('composeVolume', () => {
  it('只填名称时挂到 /media/ 下并默认只读', () => {
    const r = composeVolume('/vol1/1000/Music/', 'music');
    expect(r).toEqual({ ok: true, line: '- /vol1/1000/Music:/media/music:ro', containerPath: '/media/music', error: null });
  });
  it('容器内填绝对路径时原样使用，可关闭只读', () => {
    expect(composeVolume('/mnt/a', '/media/photos/2024', false).line).toBe('- /mnt/a:/media/photos/2024');
  });
  it('允许相对 compose 文件的宿主机路径', () => {
    expect(composeVolume('./photos', 'photos').ok).toBe(true);
  });
  it('含空格时整体加引号', () => {
    expect(composeVolume('/vol1/My Photos', '家庭照片').line).toBe('- "/vol1/My Photos:/media/家庭照片:ro"');
  });
  it('拒绝相对路径、冒号、系统目录与 ..', () => {
    expect(composeVolume('vol1/a', 'a').error).toMatch(/以 \/ 开头/);
    expect(composeVolume('C:/Photos', 'a').error).toMatch(/以 \/ 开头/);
    expect(composeVolume('/vol1/a:b', 'a').error).toMatch(/冒号/);
    expect(composeVolume('/vol1/a', '/data').error).toMatch(/系统目录/);
    expect(composeVolume('/vol1/a', '/etc/x').error).toMatch(/系统目录/);
    expect(composeVolume('/vol1/a', '/media/../data').error).toMatch(/\.\./);
    expect(composeVolume('', 'a').ok).toBe(false);
    expect(composeVolume('/vol1/a', '').error).toMatch(/容器内的名称/);
  });
  it('推荐的容器内名称取最后一级目录并去掉空白', () => {
    expect(suggestContainerName('/vol1/1000/My Music/')).toBe('my-music');
    expect(suggestContainerName('./Photos')).toBe('photos');
    expect(suggestContainerName('/')).toBe('');
    expect(suggestContainerName('..')).toBe('');
  });
  it('完整片段缩进到 services.luvia.volumes 下', () => {
    expect(composeSnippet('- /a:/media/a:ro')).toBe('services:\n  luvia:\n    volumes:\n      - /a:/media/a:ro');
  });
});

const watch = (p: Partial<LibraryWatch>): LibraryWatch => ({
  mode: 'auto', pollIntervalSec: 300, state: 'watching', watchedDirs: 19, lastEventAt: null, lastReconcileAt: null, degradedReason: null, ...p,
});

describe('watchSummary', () => {
  it('监视中显示目录数', () => {
    expect(watchSummary(watch({}))).toMatchObject({ tone: 'ok', label: '实时监控中，监视 19 个目录', detail: null });
    expect(watchSummary(watch({ watchedDirs: 12_345 })).label).toBe('实时监控中，监视 12,345 个目录');
  });
  it('轮询显示间隔；带降级原因时为警告色并展示原因', () => {
    const reason = '网络文件系统 cifs 不支持实时事件，已改为每 5 分钟对账';
    expect(watchSummary(watch({ state: 'polling', watchedDirs: null }))).toMatchObject({ tone: 'accent', label: '轮询中，每 5 分钟对账一次' });
    expect(watchSummary(watch({ state: 'polling', degradedReason: reason }))).toMatchObject({ tone: 'warn', detail: reason });
    expect(watchSummary(watch({ state: 'polling', pollIntervalSec: 3600 })).label).toBe('轮询中，每 1 小时对账一次');
  });
  it('降级、启动中与关闭', () => {
    expect(watchSummary(watch({ state: 'degraded', degradedReason: 'inotify 额度不足' }))).toEqual({ tone: 'warn', label: '已降级', detail: 'inotify 额度不足' });
    expect(watchSummary(watch({ state: 'degraded' })).detail).toMatch(/定期对账/);
    expect(watchSummary(watch({ state: 'starting' })).label).toBe('正在建立监视');
    expect(watchSummary(watch({ state: 'off', mode: 'off' }))).toMatchObject({ tone: 'muted', label: '实时监控已关闭' });
  });
});

const job = (p: Partial<Job>): Job => ({
  id: 'j', type: 'thumbnails', label: '生成缩略图', status: 'running', progress: { done: 50, total: 200 }, message: null, error: null, result: null,
  trigger: 'manual', createdAt: '2026-11-05T00:00:00Z', startedAt: null, finishedAt: null, etaSec: null, ...p,
});

describe('jobView', () => {
  it('进行中：进度百分比、计数与剩余时间，可暂停与取消', () => {
    const v = jobView(job({ message: '正在处理 2024/成都', etaSec: 7200 }));
    expect(v.pct).toBe(25);
    expect(v.detail).toBe('正在处理 2024/成都 · 50 / 200 · 预计还需 2 小时');
    expect(v.actions).toEqual(['pause', 'cancel']);
    expect(v.status.label).toBe('进行中');
  });
  it('总量未知时为不确定进度', () => {
    expect(jobView(job({ type: 'scan', progress: { done: 4180, total: null } }))).toMatchObject({ pct: null, detail: '已处理 4,180 项' });
  });
  it('暂停可继续；排队可取消；失败与取消可重试', () => {
    expect(jobView(job({ status: 'paused' })).actions).toEqual(['resume', 'cancel']);
    expect(jobView(job({ status: 'queued' }))).toMatchObject({ pct: 0, actions: ['cancel'] });
    expect(jobView(job({ status: 'failed', error: '解码失败' }))).toMatchObject({ pct: 100, detail: '解码失败', actions: ['retry'] });
    expect(jobView(job({ status: 'cancelled' })).actions).toEqual(['retry']);
  });
  it('完成时显示结果摘要且没有操作', () => {
    const v = jobView(job({ status: 'succeeded', result: { added: 312, removed: 4 } }));
    expect(v).toMatchObject({ pct: 100, detail: '新增 312，删除 4', actions: [] });
  });
});

describe('formatJobResult', () => {
  it('旧版导入结果含未匹配收藏；未知键原样显示', () => {
    expect(formatJobResult({ favorites: 1204, unmatchedFavorites: 3, foo: 1 })).toBe('收藏 1,204，未匹配收藏 3，foo 1');
    expect(formatJobResult({ freedBytes: 1.5 * 1024 ** 3 })).toBe('释放 1.5 GB');
    expect(formatJobResult(null)).toBeNull();
    expect(formatJobResult({})).toBeNull();
  });
});

describe('时间与数字', () => {
  const now = new Date(2026, 10, 5, 12, 0, 0);
  it('formatWhen 按距今远近选择写法（本地时区）', () => {
    expect(formatWhen(new Date(2026, 10, 5, 11, 59, 30).toISOString(), now)).toBe('刚刚');
    expect(formatWhen(new Date(2026, 10, 5, 11, 48).toISOString(), now)).toBe('12 分钟前');
    expect(formatWhen(new Date(2026, 10, 5, 4, 0).toISOString(), now)).toBe('今天 04:00');
    expect(formatWhen(new Date(2026, 10, 4, 21, 40).toISOString(), now)).toBe('昨天 21:40');
    expect(formatWhen(new Date(2026, 9, 2, 9, 0).toISOString(), now)).toBe('10 月 2 日');
    expect(formatWhen(new Date(2025, 0, 9).toISOString(), now)).toBe('2025 年 1 月 9 日');
    expect(formatWhen(new Date(2026, 10, 5, 4, 0).toISOString(), now, false)).toBe('今天');
    expect(formatWhen(null, now)).toBeNull();
    expect(formatWhen('不是时间', now)).toBeNull();
  });
  it('formatUptime / formatSeconds / formatEta', () => {
    expect(formatUptime(6 * 86400 + 14 * 3600 + 59)).toBe('6 天 14 小时');
    expect(formatUptime(3 * 3600 + 12 * 60)).toBe('3 小时 12 分钟');
    expect(formatUptime(20)).toBe('1 分钟');
    expect(formatSeconds(45)).toBe('45 秒');
    expect(formatSeconds(300)).toBe('5 分钟');
    expect(formatSeconds(5400)).toBe('1.5 小时');
    expect(formatSeconds(86400)).toBe('1 天');
    expect(formatEta(null)).toBeNull();
    expect(formatEta(30)).toBe('马上完成');
    expect(formatEta(61)).toBe('预计还需 2 分钟');
  });
  it('pct 与 bytesParts', () => {
    expect(pct(0.99449)).toBe('99.4%');
    expect(pct(0.99999)).toBe('99.9%');
    expect(pct(1)).toBe('100%');
    expect(pct(0)).toBe('0%');
    expect(bytesParts(38.2 * 1024 ** 3)).toEqual(['38.2', 'GB']);
    expect(bytesParts(60 * 1024 ** 3)).toEqual(['60', 'GB']);
    expect(bytesParts(512)).toEqual(['512', 'B']);
    expect(bytesParts(150 * 1024 ** 2)).toEqual(['150', 'MB']);
  });
});

describe('parseList / folderLabel', () => {
  it('逗号（含全角）与换行分隔，去空白去重', () => {
    expect(parseList('@eaDir, #recycle，.*\n\n.thumbnails, @eaDir ')).toEqual(['@eaDir', '#recycle', '.*', '.thumbnails']);
    expect(parseList('  ')).toEqual([]);
  });
  it('虚拟路径首段换成媒体库名称', () => {
    expect(folderLabel('photos/2024/成都', { photos: '照片库' })).toBe('照片库 / 2024 / 成都');
    expect(folderLabel('unknown', {})).toBe('unknown');
  });
});

describe('sparkPaths', () => {
  it('首尾点落在左右边界，数值越大越靠上', () => {
    const { line, area, last } = sparkPaths([0, 10], 100, 40, 10, 0);
    expect(line).toBe('M0 40 L100 0');
    expect(area).toBe('M0 40 L100 0 L100 40 L0 40 Z');
    expect(last).toEqual({ x: 100, y: 0 });
  });
  it('超出上限的值被截断在顶部，空序列返回空路径', () => {
    expect(sparkPaths([50], 10, 10, 10, 0).last).toEqual({ x: 10, y: 0 });
    expect(sparkPaths([], 10, 10)).toEqual({ line: '', area: '', last: null });
  });
});
