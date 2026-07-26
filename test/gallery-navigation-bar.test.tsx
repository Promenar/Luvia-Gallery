// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { GalleryNavigationBar } from '../components/navigation/GalleryNavigationBar';

// Mock language context
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'zh',
    t: (key: string) => {
      const translations: Record<string, string> = {
        home: '首页',
        go_up: '返回上级',
      };
      return translations[key] || key;
    },
  }),
}));

describe('GalleryNavigationBar 组件测试', () => {
  afterEach(() => {
    cleanup();
  });

  const defaultProps = {
    currentPath: 'foo/bar',
    canGoBack: true,
    canGoForward: true,
    onBack: vi.fn(),
    onForward: vi.fn(),
    onUp: vi.fn(),
    onNavigatePath: vi.fn(),
    onScrollToTop: vi.fn(),
    compact: false,
  };

  it('正确渲染桌面模式的所有导航按钮和面包屑', () => {
    render(<GalleryNavigationBar {...defaultProps} />);

    // 应该显示后退、前进、上一级、回到顶部按钮
    const backBtn = screen.getByLabelText('后退');
    const forwardBtn = screen.getByLabelText('前进');
    const upBtn = screen.getByLabelText('返回上级');
    const toTopBtn = screen.getByLabelText('回到顶部');

    expect(backBtn).toBeDefined();
    expect(forwardBtn).toBeDefined();
    expect(upBtn).toBeDefined();
    expect(toTopBtn).toBeDefined();

    // 应该显示面包屑（首页、foo、bar）
    expect(screen.getByText('首页')).toBeDefined();
    expect(screen.getByText('foo')).toBeDefined();
    expect(screen.getByText('bar')).toBeDefined();
  });

  it('在禁用状态下拦截按钮点击，并且确保 accessibility 属性正确', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onUp = vi.fn();

    render(
      <GalleryNavigationBar
        {...defaultProps}
        canGoBack={false}
        canGoForward={false}
        currentPath=""
        onBack={onBack}
        onForward={onForward}
        onUp={onUp}
      />
    );

    const backBtn = screen.getByLabelText('后退');
    const forwardBtn = screen.getByLabelText('前进');
    const upBtn = screen.getByLabelText('返回上级');

    // 验证 HTML 禁用和 aria-disabled 状态
    expect(backBtn.getAttribute('disabled')).toBeDefined();
    expect(backBtn.getAttribute('aria-disabled')).toBe('true');

    expect(forwardBtn.getAttribute('disabled')).toBeDefined();
    expect(forwardBtn.getAttribute('aria-disabled')).toBe('true');

    expect(upBtn.getAttribute('disabled')).toBeDefined();
    expect(upBtn.getAttribute('aria-disabled')).toBe('true');

    // 点击不应该触发回调
    fireEvent.click(backBtn);
    fireEvent.click(forwardBtn);
    fireEvent.click(upBtn);

    expect(onBack).not.toHaveBeenCalled();
    expect(onForward).not.toHaveBeenCalled();
    expect(onUp).not.toHaveBeenCalled();
  });

  it('按钮在启用状态下，点击可正常触发相应回调', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onUp = vi.fn();
    const onScrollToTop = vi.fn();

    render(
      <GalleryNavigationBar
        {...defaultProps}
        canGoBack={true}
        canGoForward={true}
        currentPath="foo"
        onBack={onBack}
        onForward={onForward}
        onUp={onUp}
        onScrollToTop={onScrollToTop}
      />
    );

    fireEvent.click(screen.getByLabelText('后退'));
    fireEvent.click(screen.getByLabelText('前进'));
    fireEvent.click(screen.getByLabelText('返回上级'));
    fireEvent.click(screen.getByLabelText('回到顶部'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onForward).toHaveBeenCalledTimes(1);
    expect(onUp).toHaveBeenCalledTimes(1);
    expect(onScrollToTop).toHaveBeenCalledTimes(1);
  });

  it('点击面包屑中的各个层级能正确触发 onNavigatePath 回调', () => {
    const onNavigatePath = vi.fn();
    render(<GalleryNavigationBar {...defaultProps} onNavigatePath={onNavigatePath} />);

    // 点击首页
    fireEvent.click(screen.getByText('首页'));
    expect(onNavigatePath).toHaveBeenLastCalledWith('');

    // 点击 foo
    fireEvent.click(screen.getByText('foo'));
    expect(onNavigatePath).toHaveBeenLastCalledWith('foo');

    // bar 是最后一级，不能点击（为 span）
    const barEl = screen.getByText('bar');
    expect(barEl.tagName.toLowerCase()).toBe('span');
  });

  it('完美解析和支持 Windows 风格反斜杠路径', () => {
    const onNavigatePath = vi.fn();
    render(
      <GalleryNavigationBar
        {...defaultProps}
        currentPath="C:\Albums\2026"
        onNavigatePath={onNavigatePath}
      />
    );

    // 面包屑应该渲染：首页、C:、Albums、2026
    expect(screen.getByText('首页')).toBeDefined();
    expect(screen.getByText('C:')).toBeDefined();
    expect(screen.getByText('Albums')).toBeDefined();
    expect(screen.getByText('2026')).toBeDefined();

    // 点击 C:，应该导航到 C:
    fireEvent.click(screen.getByText('C:'));
    expect(onNavigatePath).toHaveBeenLastCalledWith('C:');

    // 点击 Albums，应该导航到 C:\Albums
    fireEvent.click(screen.getByText('Albums'));
    expect(onNavigatePath).toHaveBeenLastCalledWith('C:\\Albums');
  });

  it('在 compact 移动端模式下正确渲染当前目录标题和滚动面包屑', () => {
    const onScrollToTop = vi.fn();
    render(
      <GalleryNavigationBar
        {...defaultProps}
        currentPath="my/test/folder"
        compact={true}
        onScrollToTop={onScrollToTop}
      />
    );

    // 应该渲染 compact 特定的根容器
    expect(screen.getByTestId('gallery-nav-bar-compact')).toBeDefined();

    // 目录标题应当为最后一级目录名 "folder"
    const titleEl = screen.getByRole('heading', { level: 2 });
    expect(titleEl.textContent).toBe('folder');

    // 面包屑依然存在（首页、my、test、folder）
    expect(screen.getByText('首页')).toBeDefined();
    expect(screen.getByText('my')).toBeDefined();
    expect(screen.getByText('test')).toBeDefined();
    expect(screen.getAllByText('folder')).toHaveLength(2);

    // 回到顶部按钮可点击
    fireEvent.click(screen.getByLabelText('回到顶部'));
    expect(onScrollToTop).toHaveBeenCalledTimes(1);
  });

  it('compact 模式在空路径时标题显示为“首页”', () => {
    render(<GalleryNavigationBar {...defaultProps} currentPath="" compact={true} />);
    const titleEl = screen.getByRole('heading', { level: 2 });
    expect(titleEl.textContent).toBe('首页');
  });
});
