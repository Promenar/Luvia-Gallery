import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SaveCopyDialog } from './SaveCopyDialog';

afterEach(cleanup);

it('默认保存副本；覆盖需要选择并确认', () => {
  const onSave = vi.fn(); const onReplace = vi.fn();
  render(<SaveCopyDialog open defaultName="修复.jpg" originalName="原图.jpg" canReplace pending={false} error={null}
    onCancel={() => {}} onSave={onSave} onReplace={onReplace} />);
  expect(screen.getByRole('radio', { name: '保存副本' })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('radio', { name: '覆盖原图' }));
  const submit = screen.getByRole('button', { name: '确认覆盖' });
  expect(submit).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: '我确认覆盖原图' }));
  fireEvent.click(submit);
  expect(onReplace).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
});

it('不能覆盖时保留保存副本入口', () => {
  const onSave = vi.fn();
  render(<SaveCopyDialog open defaultName="修复.png" originalName="原图.heic" canReplace={false} pending={false} error={null}
    onCancel={() => {}} onSave={onSave} onReplace={() => {}} />);
  expect(screen.getByRole('radio', { name: '覆盖原图' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '保存副本' }));
  expect(onSave).toHaveBeenCalledWith('修复.png');
});
