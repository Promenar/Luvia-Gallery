import { describe, expect, it } from 'vitest';
import { formatMediaStatValue } from '../components/settings/SystemTab';

describe('系统媒体统计精确性', () => {
  it('普通用户非精确零占位显示破折号，管理员精确统计正常格式化', () => {
    expect(formatMediaStatValue(0, false)).toBe('—');
    expect(formatMediaStatValue(900000, false)).toBe('—');
    expect(formatMediaStatValue(0, true)).toBe('0');
    expect(formatMediaStatValue(900000, true)).toBe((900000).toLocaleString());
    expect(formatMediaStatValue(undefined, undefined)).toBe('0');
  });
});
