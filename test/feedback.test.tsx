import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConfirmProvider, useFeedback } from '../components/feedback/feedback';
import { UserModal, appendAllowedPath } from '../components/UserModal';
import { LanguageProvider } from '../contexts/LanguageContext';

type Api = ReturnType<typeof useFeedback>;

const renderWithFeedback = () => {
  let api: Api | null = null;
  const Capture = () => {
    api = useFeedback();
    return null;
  };
  render(
    <LanguageProvider>
      <ConfirmProvider>
        <Capture />
      </ConfirmProvider>
    </LanguageProvider>,
  );
  return () => api as unknown as Api;
};

describe('确认与输入对话框', () => {
  it('确认按钮兑现 true，并展示标题与描述', async () => {
    const getApi = renderWithFeedback();
    let result: Promise<boolean> | undefined;
    act(() => { result = getApi().confirm({ title: '删除文件夹？', description: '无法恢复', confirmText: '删除', destructive: true }); });
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('无法恢复')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await expect(result).resolves.toBe(true);
  });

  it('取消与 Esc 都兑现 false', async () => {
    const getApi = renderWithFeedback();
    let first: Promise<boolean> | undefined;
    act(() => { first = getApi().confirm({ title: '继续？', cancelText: '取消' }); });
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    await expect(first).resolves.toBe(false);

    let second: Promise<boolean> | undefined;
    act(() => { second = getApi().confirm({ title: '再次确认？' }); });
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await expect(second).resolves.toBe(false);
  });

  it('输入对话框提交返回输入值，取消返回 null', async () => {
    const getApi = renderWithFeedback();
    let value: Promise<string | null> | undefined;
    act(() => { value = getApi().prompt({ title: '需要更新令牌', label: '更新令牌', inputType: 'password', confirmText: '提交' }); });
    const input = await screen.findByLabelText('更新令牌');
    fireEvent.change(input, { target: { value: 'secret-token' } });
    fireEvent.click(screen.getByRole('button', { name: '提交' }));
    await expect(value).resolves.toBe('secret-token');

    let cancelled: Promise<string | null> | undefined;
    act(() => { cancelled = getApi().prompt({ title: '需要更新令牌', cancelText: '取消' }); });
    fireEvent.click(await screen.findByRole('button', { name: '取消' }));
    await expect(cancelled).resolves.toBeNull();
  });

  it('新请求到来时未完成的旧请求按取消兑现', async () => {
    const getApi = renderWithFeedback();
    let first: Promise<boolean> | undefined;
    act(() => { first = getApi().confirm({ title: '第一个' }); });
    act(() => { getApi().confirm({ title: '第二个' }); });
    await expect(first).resolves.toBe(false);
    expect(await screen.findByText('第二个')).toBeTruthy();
  });
});

describe('用户编辑弹窗的路径回填', () => {
  it('追加路径时去重并去除空行', () => {
    expect(appendAllowedPath('', '/a')).toBe('/a');
    expect(appendAllowedPath('/a\n\n', '/b')).toBe('/a\n/b');
    expect(appendAllowedPath('/a\n/b', '/a')).toBe('/a\n/b');
  });

  it('浏览目录选中的路径写回弹窗自身的表单', async () => {
    let pick: ((path: string) => void) | null = null;
    render(
      <LanguageProvider>
        <UserModal
          isOpen
          onClose={() => undefined}
          onSubmit={() => undefined}
          type="add"
          targetUser={null}
          isAdmin
          onBrowsePaths={onPick => { pick = onPick; }}
        />
      </LanguageProvider>,
    );
    const textarea = await screen.findByPlaceholderText(/\/data\/media\/user1/);
    fireEvent.click(screen.getAllByRole('button').find(button => button.textContent?.toLowerCase().includes('browse') || button.textContent?.includes('浏览'))!);
    expect(pick).toBeTypeOf('function');
    act(() => pick!('/media/shared'));
    await waitFor(() => expect((textarea as HTMLTextAreaElement).value).toBe('/media/shared'));
  });
});

describe('原生弹窗约束', () => {
  it('应用源码不再调用 alert / confirm / prompt', () => {
    const root = path.resolve(__dirname, '..');
    const files = [path.join(root, 'App.tsx')];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) files.push(full);
      }
    };
    walk(path.join(root, 'components'));
    const offenders = files.filter(file => /(^|[^.\w])(window\.)?(alert|confirm|prompt)\(\s*['"`t]/m.test(fs.readFileSync(file, 'utf8')));
    expect(offenders.map(file => path.relative(root, file))).toEqual([]);
  });
});
