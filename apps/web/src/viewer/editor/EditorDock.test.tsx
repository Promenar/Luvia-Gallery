import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { EditorJob } from '@luvia/contracts';
import { EditorDock, type EditorDockProps } from './EditorDock';

afterEach(cleanup);
const props = (): EditorDockProps => ({
  models: [{ id: 'slbr', available: true, reason: null, device: 'cpu', maxPixels: 100_000_000, features: ['mask', 'detect'] }],
  model: 'slbr', onModel: vi.fn(), brush: 18, onBrush: vi.fn(), erase: false, onErase: vi.fn(), hasMask: false,
  onUndo: vi.fn(), onClear: vi.fn(), job: null, createPending: false, error: null, canGenerate: false, generateHint: null,
  onGenerate: vi.fn(), onCancel: vi.fn(), onReset: vi.fn(), onSave: vi.fn(), onCompare: vi.fn(), comparing: false,
  savedName: null, writeAvailable: true, writeReason: null,
});
const finished: EditorJob = { id: 'job', model: 'slbr', status: 'succeeded', progress: 1, stage: null, error: null,
  resultUrl: null, outcome: 'no_detection', maskUrl: '/mask', createdAt: new Date().toISOString(), startedAt: null, finishedAt: null };

it('只有能力可用时才能启动自动修复', () => {
  const options = props();
  const onAuto = vi.fn();
  const { rerender } = render(<EditorDock {...options} onAuto={onAuto} canAuto={false} />);
  expect((screen.getByRole('button', { name: 'SLBR 自动修复' }) as HTMLButtonElement).disabled).toBe(true);
  rerender(<EditorDock {...options} onAuto={onAuto} canAuto />);
  fireEvent.click(screen.getByRole('button', { name: 'SLBR 自动修复' }));
  expect(onAuto).toHaveBeenCalledOnce();
});

it('未检测到水印时不显示保存副本', () => {
  render(<EditorDock {...props()} job={finished} />);
  expect(screen.getByText('未检测到水印')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '保存副本' })).toBeNull();
  expect(screen.getByRole('button', { name: '手动涂抹' })).toBeTruthy();
});

it('自动预览可进入蒙版修正', () => {
  const onAdjust = vi.fn();
  render(<EditorDock {...props()} job={{ ...finished, outcome: 'detected', resultUrl: '/result' }} onAdjust={onAdjust} />);
  fireEvent.click(screen.getByRole('button', { name: '调整蒙版' }));
  expect(onAdjust).toHaveBeenCalledOnce();
});
