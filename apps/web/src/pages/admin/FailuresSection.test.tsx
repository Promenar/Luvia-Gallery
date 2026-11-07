import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaFailure } from '@luvia/contracts';
import { queryClient } from '@/lib/query';
import FailuresSection from './FailuresSection';

const callMock = vi.hoisted(() => vi.fn());
const openViewerMock = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, call: callMock };
});
vi.mock('@/stores/viewer', () => ({ openViewer: openViewerMock }));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

const failure: MediaFailure = {
  id: '1', mediaId: 'media-1', libraryId: 'lib', name: 'IMG_0001.jpg', folder: 'lib/示例',
  operation: 'thumb:s',
  source: { size: 1234, modifiedAt: 1_700_000_000, generation: 0 },
  failures: 2, ignored: false, category: 'decode', reason: '图片无法解码，请检查文件完整性',
  lastFailedAt: new Date().toISOString(),
};

const ignored: MediaFailure = { ...failure, id: '2', ignored: true, failures: 3 };

const detail = { id: 'media-1', name: 'IMG_0001.jpg' };

const page = (items: MediaFailure[]) => ({ items, nextCursor: null, total: items.length, counts: { unignored: items.filter((f) => !f.ignored).length, ignored: items.filter((f) => f.ignored).length } });

beforeEach(() => {
  callMock.mockReset();
  openViewerMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  queryClient.clear();
  callMock.mockImplementation(async (name: string, opts?: { query?: { ignored?: string } }) => {
    if (name === 'listMediaFailures') return page(opts?.query?.ignored === 'true' ? [ignored] : [failure]);
    if (name === 'mediaDetail') return detail;
    if (name === 'retryMediaFailure') return { jobId: 'job-1' };
    if (name === 'unignoreMediaFailure') return { success: true };
    throw new Error(`unexpected ${name}`);
  });
});

afterEach(() => { cleanup(); queryClient.clear(); vi.unstubAllGlobals(); });

describe('FailuresSection', () => {
  it('HTTP 环境没有 randomUUID 时仍可打开删除确认', async () => {
    const randomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', { getRandomValues: randomValues });
    render(createElement(QueryClientProvider, { client: queryClient }, createElement(FailuresSection)));
    await screen.findByText('IMG_0001.jpg');
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('列出失败记录，查看原图时把原因带进查看器', async () => {
    render(createElement(QueryClientProvider, { client: queryClient }, createElement(FailuresSection)));
    expect(await screen.findByText('IMG_0001.jpg')).toBeTruthy();
    expect(screen.getByText('无法解码')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '查看原图' }));
    await waitFor(() => expect(openViewerMock).toHaveBeenCalledTimes(1));
    expect(openViewerMock.mock.calls[0]![0]).toMatchObject({ label: '处理失败 · IMG_0001.jpg', items: [detail] });
    expect(openViewerMock.mock.calls[0]![0].errorHint).toContain('缩略图 · 小：连续失败 2 次');
  });

  it('重试提交源版本，并在服务器删除记录后移除行', async () => {
    let retried = false;
    callMock.mockImplementation(async (name: string, opts?: { query?: { ignored?: string } }) => {
      if (name === 'listMediaFailures') return page(retried ? [] : opts?.query?.ignored === 'true' ? [ignored] : [failure]);
      if (name === 'retryMediaFailure') { retried = true; return { jobId: 'job-1' }; }
      throw new Error(`unexpected ${name}`);
    });
    render(createElement(QueryClientProvider, { client: queryClient }, createElement(FailuresSection)));
    await screen.findByText('IMG_0001.jpg');

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => expect(callMock).toHaveBeenCalledWith('retryMediaFailure', { params: { id: '1' }, body: failure.source }));
    await waitFor(() => expect(screen.queryByText('IMG_0001.jpg')).toBeNull());
    expect(toastSuccess).toHaveBeenCalledWith('已重新排队处理');
  });

  it('切换已忽略后可解除忽略，并明确不会立即重试', async () => {
    let cleared = false;
    callMock.mockImplementation(async (name: string, opts?: { query?: { ignored?: string } }) => {
      if (name === 'listMediaFailures') {
        if (opts?.query?.ignored === 'true') return page(cleared ? [] : [ignored]);
        return page([]);
      }
      if (name === 'unignoreMediaFailure') { cleared = true; return { success: true }; }
      throw new Error(`unexpected ${name}`);
    });
    render(createElement(QueryClientProvider, { client: queryClient }, createElement(FailuresSection)));
    await screen.findByRole('radio', { name: '已忽略' });
    fireEvent.click(screen.getByRole('radio', { name: '已忽略' }));
    await screen.findByText('IMG_0001.jpg');

    fireEvent.click(screen.getByRole('button', { name: '解除忽略' }));
    await waitFor(() => expect(callMock).toHaveBeenCalledWith('unignoreMediaFailure', { params: { id: '2' }, body: ignored.source }));
    await waitFor(() => expect(screen.queryByText('IMG_0001.jpg')).toBeNull());
    expect(toastSuccess).toHaveBeenCalledWith('已解除忽略，之后的浏览或扫描会重新尝试');
  });
});
