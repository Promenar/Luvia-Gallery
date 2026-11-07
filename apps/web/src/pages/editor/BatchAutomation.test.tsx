import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MediaItem } from '@luvia/contracts';
import { queryClient } from '@/lib/query';
import { BatchCreateDialog } from './BatchAutomation';

const callMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), call: callMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const item = { id: 'photo', name: 'photo.jpg', source: { size: 12, modifiedAt: 123, generation: 2 } } as MediaItem;

beforeEach(() => {
  queryClient.clear();
  callMock.mockReset();
  callMock.mockImplementation(async (name: string) => {
    if (name === 'listLibraries') return { libraries: [{ id: 'lib', name: '照片', enabled: true }] };
    if (name === 'createEditorBatch') return { id: 'batch' };
    throw new Error(`unexpected ${name}`);
  });
});
afterEach(() => { cleanup(); queryClient.clear(); });

it('全自动批次确认后提交源版本、目标路径和阈值', async () => {
  const created = vi.fn();
  render(<QueryClientProvider client={queryClient}><BatchCreateDialog items={[item]} onClose={vi.fn()} onCreated={created} /></QueryClientProvider>);
  await screen.findByRole('option', { name: '照片' });
  fireEvent.click(screen.getByLabelText('自动保存检测到水印的结果'));
  fireEvent.change(screen.getByLabelText('检测阈值'), { target: { value: '180' } });
  fireEvent.change(screen.getByLabelText('相对文件夹'), { target: { value: '修复副本' } });
  fireEvent.click(screen.getByRole('button', { name: '开始处理' }));
  const confirm = await screen.findByRole('dialog', { name: '开始全自动处理' });
  expect(callMock).not.toHaveBeenCalledWith('createEditorBatch', expect.anything());
  fireEvent.click(within(confirm).getByRole('button', { name: '开始处理' }));
  await waitFor(() => expect(callMock).toHaveBeenCalledWith('createEditorBatch', { body: {
    mode: 'auto', threshold: 180, destination: { libraryId: 'lib', folder: '修复副本' },
    items: [{ mediaId: 'photo', source: item.source }],
  } }));
  await waitFor(() => expect(created).toHaveBeenCalledOnce());
});
