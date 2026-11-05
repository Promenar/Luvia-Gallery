import { describe, expect, it } from 'vitest';
import { emptySmartForm, filterSummary, formatAlbumRange, fromFilter, rangeError, toFilter } from './format';

describe('相册时间范围', () => {
  it('同月、同年跨月、跨年三种写法', () => {
    expect(formatAlbumRange('2024-10-03T12:00:00+08:00', '2024-10-28T08:00:00+08:00')).toBe('2024 年 10 月');
    expect(formatAlbumRange('2024-10-03T12:00:00+08:00', '2024-11-02T08:00:00+08:00')).toBe('2024 年 10 月 – 11 月');
    expect(formatAlbumRange('2019-08-01T00:00:00Z', '2021-03-09T00:00:00Z')).toBe('2019 年 8 月 – 2021 年 3 月');
  });

  it('按字符串自带的偏移取月份，不受浏览器时区影响', () => {
    expect(formatAlbumRange('2024-10-31T23:30:00-05:00', '2024-10-31T23:30:00-05:00')).toBe('2024 年 10 月');
  });

  it('空相册没有时间范围；只有一端时按单月显示', () => {
    expect(formatAlbumRange(null, null)).toBeNull();
    expect(formatAlbumRange(null, '2025-04-01T00:00:00Z')).toBe('2025 年 4 月');
  });
});

describe('智能相册表单与筛选条件互转', () => {
  it('全部为空时不产生筛选条件', () => {
    expect(toFilter(emptySmartForm())).toBeNull();
  });

  it('结束日期包含当天：to 为次日 0 点（左闭右开）', () => {
    const f = toFilter({ ...emptySmartForm(), from: '2025-01-01', to: '2025-01-01' })!;
    expect(f.to! - f.from!).toBe(86400);
  });

  it('跨月末的结束日期正确进位', () => {
    const f = toFilter({ ...emptySmartForm(), to: '2025-02-28' })!;
    const next = new Date(f.to! * 1000);
    expect([next.getFullYear(), next.getMonth() + 1, next.getDate()]).toEqual([2025, 3, 1]);
  });

  it('往返转换保持表单内容', () => {
    const form = { types: ['video' as const], from: '2024-03-10', to: '2024-12-31', favorite: true, under: 'photos/2025', cameras: ['iPhone 16 Pro'] };
    const filter = toFilter(form)!;
    expect(filter).toMatchObject({ types: ['video'], favorite: true, under: 'photos/2025', cameras: ['iPhone 16 Pro'] });
    expect(fromFilter(filter)).toEqual(form);
  });

  it('结束日期早于开始日期时报错', () => {
    expect(rangeError({ ...emptySmartForm(), from: '2025-05-02', to: '2025-05-01' })).toBe('结束日期不能早于开始日期');
    expect(rangeError({ ...emptySmartForm(), from: '2025-05-01', to: '2025-05-01' })).toBeNull();
  });
});

describe('筛选条件摘要', () => {
  it('按类型、时间、收藏、文件夹、相机依次列出', () => {
    const f = toFilter({ types: ['image', 'video'], from: '2025-01-01', to: '2025-12-31', favorite: true, under: 'photos/2025/2025-04 婚礼', cameras: ['X-T5', 'Q3'] });
    expect(filterSummary(f)).toEqual(['照片、视频', '2025-01-01 至 2025-12-31', '只含收藏', '文件夹「2025-04 婚礼」及子文件夹', '相机 X-T5、Q3']);
  });

  it('只有开始或结束日期', () => {
    expect(filterSummary(toFilter({ ...emptySmartForm(), from: '2025-01-01' }))).toEqual(['2025-01-01 起']);
    expect(filterSummary(toFilter({ ...emptySmartForm(), to: '2025-01-01' }))).toEqual(['截至 2025-01-01']);
    expect(filterSummary(null)).toEqual([]);
  });
});
