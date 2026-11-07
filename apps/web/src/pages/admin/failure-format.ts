/**
 * “处理失败”列表的纯逻辑：把人看的操作名、失败次数语气和查看器提示整理在一处，
 * 避免界面里散落字符串分支。
 */
import type { MediaFailure } from '@luvia/contracts';
import type { Tone } from './format';

const OPERATIONS: Record<string, string> = {
  'thumb:s': '缩略图 · 小',
  'thumb:m': '缩略图 · 中',
  'thumb:l': '缩略图 · 大',
  preview: '视频预览',
  metadata: '拍摄信息',
  dimensions: '尺寸',
  display: '原图显示',
};

/** 操作类型的中文说明；未知类型保留原值，便于排查。 */
export function operationLabel(op: string): string {
  if (OPERATIONS[op]) return OPERATIONS[op];
  if (op.startsWith('tile:')) return '时间线图块';
  return op || '处理';
}

const CATEGORIES: Record<MediaFailure['category'], string> = {
  missing: '文件缺失',
  permission: '权限不足',
  decode: '无法解码',
  storage: '存储异常',
  unknown: '处理失败',
};

/** 失败类别的中文说明，用于在原因前给出一眼可读的归类。 */
export function failureCategoryLabel(category: MediaFailure['category']): string {
  return CATEGORIES[category] ?? '处理失败';
}

/** 失败次数与忽略状态的语气：只有未忽略且接近阈值时才用警告色。 */
export function failureTone(f: Pick<MediaFailure, 'ignored' | 'failures'>): Tone {
  if (f.ignored) return 'muted';
  return f.failures >= 2 ? 'warn' : 'muted';
}

/** 传给查看器错误卡片的提示，把“哪一步失败了几次”说清楚。 */
export function failureHint(f: Pick<MediaFailure, 'operation' | 'failures' | 'reason'>): string {
  return `${operationLabel(f.operation)}：连续失败 ${f.failures} 次，${f.reason || '没有返回原因'}`;
}
