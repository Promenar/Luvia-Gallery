// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { GalleryNavigationBar } from '../components/navigation/GalleryNavigationBar';

// Mock language context
vi.mock('../contexts/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'zh',
    t: (key: string) => {
      const translations: Record<string, string> = {
        home: '首页',
        go_up: '返回上级',
        all_photos: '媒体库',
        favorites: '收藏夹',
        folders: '文件夹',
        search: '搜索',
        newest_first: '最新优先',
        oldest_first: '最早优先',
        shuffle_random: '随机打乱',
        sort_by_name_asc: '名称 A-Z',
        sort_by_name_desc: '名称 Z-A',
      };
      return translations[key] || key;
    },
  }),
}));

describe('GalleryNavigationBar 组件测试 (Unified Toolbar Phase 2)', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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
    onSearch: vi.fn(),
    onSortChange: vi.fn(),
    onLayoutChange: vi.fn(),
    onNavigateView: vi.fn(),
  };

  it('正确渲染桌面模式下的基本后退、前进和返回上级按钮，并确保无障碍属性正确', () => {
    render(<GalleryNavigationBar {...defaultProps} />);

    const backBtn = screen.getByLabelText('后退');
    const forwardBtn = screen.getByLabelText('前进');
    const upBtn = screen.getByLabelText('返回上级');

    expect(backBtn).toBeDefined();
    expect(forwardBtn).toBeDefined();
    expect(upBtn).toBeDefined();

    expect(backBtn.getAttribute('aria-disabled')).toBe('false');
    expect(forwardBtn.getAttribute('aria-disabled')).toBe('false');
    expect(upBtn.getAttribute('aria-disabled')).toBe('false');
  });

  it('在禁用状态下拦截按钮点击，且 aria-disabled 为 true', () => {
    const onBack = vi.fn();
    const onForward = vi.fn();
    const onUp = vi.fn();

    render(
      <GalleryNavigationBar
        {...defaultProps}
        canGoBack={false}
        canGoForward={false}
        view="folders"
        folderPath=""
        onBack={onBack}
        onForward={onForward}
        onUp={onUp}
      />
    );

    const backBtn = screen.getByLabelText('后退');
    const forwardBtn = screen.getByLabelText('前进');
    const upBtn = screen.getByLabelText('返回上级');

    expect(backBtn.getAttribute('disabled')).toBeDefined();
    expect(backBtn.getAttribute('aria-disabled')).toBe('true');
    expect(forwardBtn.getAttribute('aria-disabled')).toBe('true');
    expect(upBtn.getAttribute('aria-disabled')).toBe('true');

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

    render(
      <GalleryNavigationBar
        {...defaultProps}
        canGoBack={true}
        canGoForward={true}
        view="folders"
        folderPath="foo"
        onBack={onBack}
        onForward={onForward}
        onUp={onUp}
      />
    );

    fireEvent.click(screen.getByLabelText('后退'));
    fireEvent.click(screen.getByLabelText('前进'));
    fireEvent.click(screen.getByLabelText('返回上级'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onForward).toHaveBeenCalledTimes(1);
    expect(onUp).toHaveBeenCalledTimes(1);
  });

  it('测试三类平行地址的面包屑渲染', () => {
    // 1. home > 媒体库 (all view)
    const { rerender } = render(
      <GalleryNavigationBar {...defaultProps} view="all" folderPath="stale/path" />
    );
    expect(screen.getByText('首页')).toBeDefined();
    expect(screen.getByText('媒体库')).toBeDefined();
    expect(screen.queryByText('stale')).toBeNull();
    expect(screen.queryByText('path')).toBeNull();

    // 2. home > 收藏夹 (favorites view)
    rerender(<GalleryNavigationBar {...defaultProps} view="favorites" folderPath="stale/path" />);
    expect(screen.getByText('首页')).toBeDefined();
    expect(screen.getByText('收藏夹')).toBeDefined();
    expect(screen.queryByText('stale')).toBeNull();

    // 3. home > 文件夹 > foo > bar (folders view)
    rerender(<GalleryNavigationBar {...defaultProps} view="folders" folderPath="foo/bar" />);
    expect(screen.getByText('首页')).toBeDefined();
    expect(screen.getByText('文件夹')).toBeDefined();
    expect(screen.getByText('foo')).toBeDefined();
    expect(screen.getByText('bar')).toBeDefined();
  });

  it('面包屑可点击触发对应的 onNavigatePath 与 onNavigateView 回调', () => {
    const onNavigatePath = vi.fn();
    const onNavigateView = vi.fn();

    render(
      <GalleryNavigationBar
        {...defaultProps}
        view="folders"
        folderPath="foo/bar"
        onNavigatePath={onNavigatePath}
        onNavigateView={onNavigateView}
      />
    );

    // 点击 "首页" 应该触发导航到 home 视图
    fireEvent.click(screen.getByText('首页'));
    expect(onNavigateView).toHaveBeenCalledWith('home');
    expect(onNavigatePath).not.toHaveBeenCalled();

    // 点击 "文件夹" 应该触发导航到 folders 视图
    fireEvent.click(screen.getByText('文件夹'));
    expect(onNavigateView).toHaveBeenCalledWith('folders');
    expect(onNavigatePath).not.toHaveBeenCalled();

    // 点击 "foo" 应该导航到该路径
    fireEvent.click(screen.getByText('foo'));
    expect(onNavigatePath).toHaveBeenCalledWith('foo');

    // "bar" 是最后一级，应包含 aria-current="page"
    const barEl = screen.getByText('bar').closest('span');
    expect(barEl).not.toBeNull();
    expect(barEl?.getAttribute('aria-current')).toBe('page');
  });

  it('陈旧 folderPath 不会在 all/favorites 视图下泄露', () => {
    render(
      <GalleryNavigationBar
        {...defaultProps}
        view="all"
        folderPath="should/not/be/visible"
      />
    );
    expect(screen.queryByText('should')).toBeNull();
    expect(screen.queryByText('visible')).toBeNull();
  });

  it('location 优先级下也会隔离媒体库和收藏夹的陈旧路径', () => {
    render(
      <GalleryNavigationBar
        {...defaultProps}
        location={{ key: 'all', view: 'all', folderPath: 'stale/path', search: '', sort: 'dateDesc', filter: 'all', layout: 'grid' }}
      />
    );
    expect(screen.getByText('媒体库')).toBeDefined();
    expect(screen.queryByText('stale')).toBeNull();
  });

  it('搜索模式进入与键盘操作测试 (Enter/Escape/clear)', () => {
    const onSearch = vi.fn();
    render(
      <GalleryNavigationBar
        {...defaultProps}
        view="folders"
        folderPath="vacation"
        onSearch={onSearch}
      />
    );

    // 1. 点击搜索图标进入搜索模式
    const searchTrigger = screen.getByLabelText('进入搜索');
    fireEvent.click(searchTrigger);
    expect(document.activeElement).toBe(screen.getByLabelText('搜索输入框'));

    // 应该显示作用域标签: "文件夹: vacation"
    expect(screen.getByText('文件夹: vacation')).toBeDefined();

    // 2. 键盘 Ctrl+K 也能触发搜索模式 (我们先退出，再尝试 Ctrl+K)
    fireEvent.keyDown(screen.getByLabelText('搜索输入框'), { key: 'Escape' });
    expect(screen.queryByLabelText('搜索输入框')).toBeNull();

    // 用 fireEvent 派发全局按键
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByLabelText('搜索输入框')).toBeDefined();

    // 3. 输入内容并按下 Enter 提交搜索
    const input = screen.getByLabelText('搜索输入框');
    fireEvent.change(input, { target: { value: 'sunset' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSearch).toHaveBeenCalledWith('sunset');
    // 回车后退出搜索模式
    expect(screen.queryByLabelText('搜索输入框')).toBeNull();

    // 4. Escape 退出搜索模式且不触发提交
    fireEvent.click(screen.getByLabelText('进入搜索'));
    const input2 = screen.getByLabelText('搜索输入框');
    fireEvent.change(input2, { target: { value: 'beach' } });
    onSearch.mockClear();

    fireEvent.keyDown(input2, { key: 'Escape' });
    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('搜索输入框')).toBeNull();

    // 5. 点击清除按钮提交空搜索
    fireEvent.click(screen.getByLabelText('进入搜索'));
    const input3 = screen.getByLabelText('搜索输入框');
    fireEvent.change(input3, { target: { value: 'beach' } });

    const clearBtn = screen.getByLabelText('清空搜索');
    fireEvent.click(clearBtn);
    expect(onSearch).toHaveBeenCalledWith('');
  });

  it('退出搜索会回滚草稿，跨位置但搜索词相同时也会重置草稿', () => {
    const onSearch = vi.fn();
    const firstLocation = { key: 'folder-a', view: 'folders' as const, folderPath: 'A', search: '人物', sort: 'dateDesc' as const, filter: 'all' as const, layout: 'grid' as const };
    const { rerender } = render(<GalleryNavigationBar {...defaultProps} location={firstLocation} onSearch={onSearch} />);
    fireEvent.click(screen.getByLabelText('进入搜索'));
    fireEvent.change(screen.getByLabelText('搜索输入框'), { target: { value: '未提交草稿' } });
    fireEvent.keyDown(screen.getByLabelText('搜索输入框'), { key: 'Escape' });
    fireEvent.click(screen.getByLabelText('进入搜索'));
    expect((screen.getByLabelText('搜索输入框') as HTMLInputElement).value).toBe('人物');

    fireEvent.change(screen.getByLabelText('搜索输入框'), { target: { value: '另一个草稿' } });
    rerender(<GalleryNavigationBar {...defaultProps} location={{ ...firstLocation, key: 'folder-b', folderPath: 'B' }} onSearch={onSearch} />);
    expect((screen.getByLabelText('搜索输入框') as HTMLInputElement).value).toBe('人物');
    fireEvent.click(screen.getByLabelText('退出搜索'));
    fireEvent.click(screen.getByLabelText('进入搜索'));
    fireEvent.change(screen.getByLabelText('搜索输入框'), { target: { value: '外部取消草稿' } });
    fireEvent.click(screen.getByTestId('search-dismiss-overlay'));
    fireEvent.click(screen.getByLabelText('进入搜索'));
    expect((screen.getByLabelText('搜索输入框') as HTMLInputElement).value).toBe('人物');
  });

  it('已提交搜索在地址模式可见且可直接清除', () => {
    const onSearch = vi.fn();
    render(
      <GalleryNavigationBar
        {...defaultProps}
        location={{ key: 'search', view: 'favorites', folderPath: '', search: '人物', sort: 'dateDesc', filter: 'all', layout: 'grid' }}
        onSearch={onSearch}
      />,
    );
    expect(screen.getByText('搜索：“人物”')).toBeDefined();
    fireEvent.click(screen.getByLabelText('清除当前搜索'));
    expect(onSearch).toHaveBeenCalledWith('');
  });

  it('排序与布局回调触发测试', () => {
    const onSortChange = vi.fn();
    const onLayoutChange = vi.fn();

    render(
      <GalleryNavigationBar
        {...defaultProps}
        sortOption="dateDesc"
        layoutMode="grid"
        onSortChange={onSortChange}
        onLayoutChange={onLayoutChange}
      />
    );

    // 1. 触发排序菜单
    const sortBtn = screen.getByLabelText(/当前排序：/);
    fireEvent.click(sortBtn);

    // 点击最早优先
    const dateAscOpt = screen.getByText('最早优先');
    fireEvent.click(dateAscOpt);
    expect(onSortChange).toHaveBeenCalledWith('dateAsc');

    // 2. 触发布局菜单
    const layoutBtn = screen.getByLabelText(/切换布局/);
    fireEvent.click(layoutBtn);

    // 点击瀑布流
    const masonryOpt = screen.getByText('瀑布流');
    fireEvent.click(masonryOpt);
    expect(onLayoutChange).toHaveBeenCalledWith('masonry');
  });

  it('桌面筛选使用单一菜单入口，md-lg 宽度下保持可达', () => {
    const onFilterChange = vi.fn();
    render(<GalleryNavigationBar {...defaultProps} filter="all" onFilterChange={onFilterChange} />);
    const filterButton = screen.getByLabelText('当前筛选：全部类型');
    expect(filterButton.className).not.toContain('hidden');
    fireEvent.click(filterButton);
    fireEvent.click(screen.getByText('视频'));
    expect(onFilterChange).toHaveBeenCalledWith('video');
  });

  it('图片筛选具有正确语义、图标状态和回调', () => {
    const onFilterChange = vi.fn();
    const { rerender } = render(
      <GalleryNavigationBar {...defaultProps} filter="all" onFilterChange={onFilterChange} />,
    );
    fireEvent.click(screen.getByLabelText('当前筛选：全部类型'));
    fireEvent.click(screen.getByText('图片'));
    expect(onFilterChange).toHaveBeenCalledWith('image');

    rerender(<GalleryNavigationBar {...defaultProps} filter="image" onFilterChange={onFilterChange} />);
    expect(screen.getByLabelText('当前筛选：图片')).toBeDefined();
  });

  it('Escape 可以关闭筛选、排序和布局菜单', () => {
    render(<GalleryNavigationBar {...defaultProps} filter="all" onFilterChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText(/当前筛选：/));
    expect(screen.getByText('视频')).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('视频')).toBeNull();

    fireEvent.click(screen.getByLabelText(/当前排序：/));
    expect(screen.getByText('最早优先')).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('最早优先')).toBeNull();

    fireEvent.click(screen.getByLabelText(/切换布局/));
    expect(screen.getByText('瀑布流')).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('瀑布流')).toBeNull();
  });

  it('移动端模式保持一个容器，展现后退、当前地址摘要、搜索、更多菜单，触控目标符合要求', () => {
    const onUp = vi.fn();
    const onScrollToTop = vi.fn();
    const onSortChange = vi.fn();
    const onLayoutChange = vi.fn();

    render(
      <GalleryNavigationBar
        {...defaultProps}
        view="folders"
        folderPath="trip/beach"
        compact={true}
        onUp={onUp}
        onScrollToTop={onScrollToTop}
        onSortChange={onSortChange}
        onLayoutChange={onLayoutChange}
      />
    );

    expect(screen.getByTestId('gallery-nav-bar-compact')).toBeDefined();

    // 应该展示后退、当前地址摘要("beach")、搜索、更多按钮
    const backBtn = screen.getByLabelText('后退');
    expect(backBtn.className).toContain('w-11 h-11'); // 触控目标 44px

    expect(screen.getByText('beach')).toBeDefined();

    const searchBtn = screen.getByLabelText('进入搜索');
    expect(searchBtn.className).toContain('w-11 h-11');

    const moreBtn = screen.getByLabelText('更多选项');
    expect(moreBtn.className).toContain('w-11 h-11');

    // 点击更多按钮，打开菜单
    fireEvent.click(moreBtn);

    // 验证更多选项内的微件和回调
    const upBtn = screen.getByText('返回上级');
    expect(upBtn.closest('button')?.className).toContain('min-h-[44px]');

    fireEvent.click(upBtn);
    expect(onUp).toHaveBeenCalled();

    // 重新打开并测试回到顶部
    fireEvent.click(moreBtn);
    const toTopBtn = screen.getByText('回到顶部');
    expect(toTopBtn.closest('button')?.className).toContain('min-h-[44px]');

    fireEvent.click(toTopBtn);
    expect(onScrollToTop).toHaveBeenCalled();
  });

  it('移动 folders 根摘要显示文件夹，并保留侧栏菜单入口', () => {
    const onOpenMenu = vi.fn();
    render(
      <GalleryNavigationBar
        {...defaultProps}
        view="folders"
        folderPath=""
        compact={true}
        onOpenMenu={onOpenMenu}
      />
    );
    expect(screen.getByText('文件夹')).toBeDefined();
    fireEvent.click(screen.getByLabelText('打开菜单'));
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });

  it('桌面与移动实例同时挂载时快捷键在 1023/1024 两侧只激活可见实例', () => {
    let viewportWidth = 1023;
    const matchMedia = vi.fn((query: string) => ({
      get matches() { return viewportWidth >= 1024; },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    render(
      <>
        <GalleryNavigationBar {...defaultProps} compact={true} />
        <GalleryNavigationBar {...defaultProps} compact={false} />
      </>,
    );
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(within(screen.getByTestId('gallery-nav-bar-compact')).getByLabelText('搜索输入框')).toBeDefined();
    expect(within(screen.getByTestId('gallery-nav-bar-desktop')).queryByLabelText('搜索输入框')).toBeNull();
    fireEvent.keyDown(within(screen.getByTestId('gallery-nav-bar-compact')).getByLabelText('搜索输入框'), { key: 'Escape' });

    viewportWidth = 1024;
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(within(screen.getByTestId('gallery-nav-bar-desktop')).getByLabelText('搜索输入框')).toBeDefined();
    expect(within(screen.getByTestId('gallery-nav-bar-compact')).queryByLabelText('搜索输入框')).toBeNull();
    expect(matchMedia).toHaveBeenCalledWith('(min-width: 1024px)');
  });

  it('长路径保持单行并折叠中间节点，当前节点始终可见', () => {
    render(
      <GalleryNavigationBar
        {...defaultProps}
        view="folders"
        folderPath="一级/二级/三级/四级/当前目录"
      />,
    );
    const breadcrumbs = screen.getByLabelText('Breadcrumb');
    expect(breadcrumbs.className).toContain('flex-nowrap');
    const toolbar = screen.getByTestId('gallery-nav-bar-desktop');
    expect(toolbar.className).toContain('flex-nowrap');
    const omnibox = screen.getByTestId('gallery-omnibox');
    expect(omnibox.className).toContain('min-w-[12rem]');
    expect(screen.getByText('…')).toBeDefined();
    expect(screen.queryByText('二级')).toBeNull();
    const current = screen.getByText('当前目录').closest('[aria-current="page"]');
    expect(current).not.toBeNull();
    expect(current?.className).toContain('min-w-[4rem]');
    expect(current?.className).toContain('truncate');
    const folderRoot = screen.getByLabelText('文件夹');
    expect(folderRoot.querySelector('.xl\\:hidden')).not.toBeNull();
  });

  it('md-lg 右侧控制仅保留图标，搜索状态不会挤占当前节点保底宽度', () => {
    render(
      <GalleryNavigationBar
        {...defaultProps}
        location={{ key: 'narrow', view: 'folders', folderPath: '图库/当前目录', search: '很长的搜索关键词人物风景合集', sort: 'dateDesc', filter: 'image', layout: 'grid' }}
        onFilterChange={vi.fn()}
      />,
    );
    const sortButton = screen.getByLabelText(/当前排序：/);
    const sortLabel = sortButton.querySelector('span');
    expect(sortLabel?.className).toContain('hidden xl:inline');
    const current = screen.getByText('当前目录').closest('[aria-current="page"]');
    expect(current?.className).toContain('min-w-[4rem]');
    const searchChip = screen.getByLabelText('清除当前搜索');
    expect(searchChip.className).toContain('max-w-[7rem]');
    expect(searchChip.className).toContain('xl:max-w-[12rem]');
  });
});
