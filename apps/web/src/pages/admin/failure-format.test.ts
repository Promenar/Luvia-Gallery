import { describe, expect, it } from 'vitest';
import { failureCategoryLabel, failureHint, failureTone, operationLabel } from './failure-format';

describe('operationLabel', () => {
  it('把已知操作翻译为中文', () => {
    expect(operationLabel('thumb:s')).toBe('缩略图 · 小');
    expect(operationLabel('thumb:m')).toBe('缩略图 · 中');
    expect(operationLabel('thumb:l')).toBe('缩略图 · 大');
    expect(operationLabel('preview')).toBe('视频预览');
    expect(operationLabel('metadata')).toBe('拍摄信息');
    expect(operationLabel('dimensions')).toBe('尺寸');
    expect(operationLabel('display')).toBe('原图显示');
  });

  it('时间线图块按前缀识别，未知操作保留原值', () => {
    expect(operationLabel('tile:2:1:0')).toBe('时间线图块');
    expect(operationLabel('future:op')).toBe('future:op');
    expect(operationLabel('')).toBe('处理');
  });
});

describe('failureTone', () => {
  it('已忽略用中性色，未忽略且接近阈值用警告色', () => {
    expect(failureTone({ ignored: true, failures: 3 })).toBe('muted');
    expect(failureTone({ ignored: false, failures: 1 })).toBe('muted');
    expect(failureTone({ ignored: false, failures: 2 })).toBe('warn');
  });
});

describe('failureCategoryLabel', () => {
  it('把分类翻译为可读文案', () => {
    expect(failureCategoryLabel('missing')).toBe('文件缺失');
    expect(failureCategoryLabel('permission')).toBe('权限不足');
    expect(failureCategoryLabel('decode')).toBe('无法解码');
    expect(failureCategoryLabel('storage')).toBe('存储异常');
    expect(failureCategoryLabel('unknown')).toBe('处理失败');
  });
});

describe('failureHint', () => {
  it('包含操作、次数与原因', () => {
    expect(failureHint({ operation: 'thumb:s', failures: 3, reason: '图片无法解码' }))
      .toBe('缩略图 · 小：连续失败 3 次，图片无法解码');
  });

  it('原因为空时给出可理解的兜底', () => {
    expect(failureHint({ operation: 'preview', failures: 1, reason: '' }))
      .toBe('视频预览：连续失败 1 次，没有返回原因');
  });
});
