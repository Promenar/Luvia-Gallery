import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { Copy, CornerLeftUp, Heart, Play } from 'lucide-react';
import type { MediaListQuery } from '@luvia/contracts';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { q } from '@/lib/query';
import { PagedMediaGrid } from '@/pages/folders/PagedMediaGrid';
import { useIsAdmin, usePreferences, useUpdatePreferences } from '@/stores/session';
import { openViewer } from '@/stores/viewer';
import { setDynamicFrom } from '@/theme/ThemeProvider';
import { foldersQuery, useFolderFavorite } from './favorite';
import { FolderTree } from './FolderTree';
import { useMediaPages } from './media';
import { containerPathOf, hostCrumbs, libraryIdOf, parentPath } from './paths';
import { EmptyNote, FolderCard, FolderGrid, FolderStack, PageHead, PageTitle, chip, countText, metaText, subhClass } from './ui';
import { SortMenu, useMediaSort } from '@/components/media/SortMenu';

/** 管理员可见的媒体库容器内根目录；普通用户或接口不可用时为空表。 */
function useLibraryRoots() {
  const isAdmin = useIsAdmin();
  const r = useQuery({ ...q('listLibraries'), enabled: isAdmin, retry: false });
  return useMemo(() => new Map((r.data?.libraries ?? []).map((l) => [l.id, l.root])), [r.data]);
}

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error('浏览器不允许访问剪贴板，请手动选中路径复制');
  }
}

/** 无 path：各媒体库根卡片（原型 .libs / .libc）。 */
function LibraryRoots() {
  const isAdmin = useIsAdmin();
  const roots = useLibraryRoots();
  const { data, isPending, isError, error } = useQuery(foldersQuery());
  const libs = data?.folders ?? [];
  return (
    <>
      <PageHead>
        <PageTitle>文件夹</PageTitle>
        <div className={cn(metaText, 'w-full')}>
          {isPending ? '正在读取媒体库…' : libs.length
            ? `按宿主机上的真实目录浏览。下面是容器挂载进来、已启用的 ${libs.length} 个目录。`
            : null}
        </div>
      </PageHead>
      {isError && <EmptyNote>无法读取媒体库：{error.message}</EmptyNote>}
      {data && !libs.length && (
        <EmptyNote>
          还没有可以浏览的媒体库。
          {isAdmin ? <>到<Link to="/admin" search={{ tab: 'libraries' }} className="text-accent underline underline-offset-2">控制台的媒体库</Link>添加目录并扫描后，这里会列出它们。</> : '请联系管理员添加媒体库或开放访问权限。'}
        </EmptyNote>
      )}
      <div className="grid grid-cols-1 gap-[18px] px-4 pt-6 pb-[120px] md:grid-cols-[repeat(auto-fill,minmax(360px,1fr))] md:px-11">
        {libs.map((l) => {
          const root = roots.get(l.path);
          return (
            <Link
              key={l.path}
              to="/folders"
              search={{ path: l.path }}
              onMouseEnter={() => setDynamicFrom(l.cover)}
              className="group/libc grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3 rounded-[var(--r3)] border border-line bg-surface py-4 pr-5 pl-3 text-left transition-colors hover:border-line-2 md:grid-cols-[150px_minmax(0,1fr)] md:gap-5"
            >
              <FolderStack cover={l.cover} hoverGroup="libc" className="m-2" />
              <div className="min-w-0">
                <h3 className="m-0 truncate text-lg font-semibold">{l.name}</h3>
                <dl className="mt-2 mb-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-[3px] text-[12.5px] text-fg-2">
                  {l.hostPath && (<><dt className="text-muted">宿主机</dt><dd className="m-0 break-all">{l.hostPath}</dd></>)}
                  {root && (<><dt className="text-muted">容器内</dt><dd className="m-0 break-all">{root}</dd></>)}
                  <dt className="text-muted">内容</dt><dd className="m-0">{countText(l.mediaCount, l.childCount)}</dd>
                </dl>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}

function FolderError({ path, error }: { path: string; error: Error }) {
  const parent = parentPath(path);
  const status = error instanceof ApiError ? error.status : 0;
  const [title, hint] =
    status === 404 ? ['找不到这个文件夹', '它可能已被移动、重命名或删除，也可能链接里的路径有误。']
      : status === 403 ? ['你没有权限查看这个文件夹', '管理员只向你开放了部分目录。需要访问时请联系管理员。']
        : ['无法打开这个文件夹', error.message];
  return (
    <div className="px-4 pt-10 pb-[120px] md:px-11 md:pt-16">
      <h1 className="m-0 text-2xl font-semibold">{title}</h1>
      <p className="mt-2 max-w-[560px] text-[13.5px] text-muted">{hint}</p>
      <p className="mt-1 text-[12.5px] break-all text-muted">路径：{path}</p>
      <Link to="/folders" search={parent ? { path: parent } : {}} className={cn(chip(), 'mt-5')}>
        <CornerLeftUp />返回上一级
      </Link>
    </div>
  );
}

function FolderView({ path, scroller }: { path: string; scroller: HTMLElement | null }) {
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const fav = useFolderFavorite();
  const roots = useLibraryRoots();
  const rec = prefs.folderIncludeSubfolders;
  const listing = useQuery(foldersQuery(path));
  const sort = useMediaSort();
  const query = useMemo<MediaListQuery>(() => (rec ? { scope: 'folder', folder: path, recursive: true, sort } : { scope: 'folder', folder: path, sort }), [path, rec, sort]);
  const media = useMediaPages(query, listing.isSuccess);

  // 窄屏面包屑单行横向滚动，进入目录时滚到末尾，让当前目录可见
  const crumbsRef = useCallback((el: HTMLElement | null) => { if (el) el.scrollLeft = el.scrollWidth; }, []);

  const first = media.items[0];
  useEffect(() => {
    if (first) setDynamicFrom(media.items.find((m) => m.mediaType === 'image') ?? first);
    // 只在进入文件夹、首屏媒体到达时取色
  }, [first?.id]);

  if (listing.isError) return <FolderError path={path} error={listing.error} />;
  if (!listing.data) return <PageHead><div className={metaText}>正在打开文件夹…</div></PageHead>;

  const d = listing.data;
  const name = d.breadcrumbs.at(-1)?.name ?? path;
  const label = `文件夹「${name}」`;
  const total = d.directMediaCount + d.folders.reduce((a, f) => a + f.mediaCount, 0);
  const crumbs = hostCrumbs(d);
  const root = roots.get(libraryIdOf(path));
  const shownCount = media.total ?? (rec ? total : d.directMediaCount);

  const play = () => {
    if (!media.items.length) {
      toast(media.isPending ? '正在加载这个文件夹的内容，请稍候再试' : '这个文件夹里没有可播放的照片或视频');
      return;
    }
    openViewer({ label, items: media.items, query, nextCursor: media.nextCursor, total: media.total }, 0, { play: true });
  };

  return (
    <>
      <PageHead>
        <nav
          ref={crumbsRef}
          aria-label="宿主机路径"
          className="-mb-1 flex w-full flex-nowrap items-center gap-px overflow-x-auto text-[13px] whitespace-nowrap text-muted scrollbar-none md:flex-wrap md:overflow-visible md:whitespace-normal"
        >
          <Link to="/folders" className="rounded-md px-1.5 py-0.5 text-fg-2 hover:bg-accent-soft hover:text-fg">全部目录</Link>
          <span aria-hidden className="px-px opacity-45">›</span>
          {crumbs.crumbs.map((c, i) => (
            <Fragment key={i}>
              {(crumbs.mode === 'host' || i > 0) && <span aria-hidden className="px-px opacity-45">{crumbs.mode === 'host' ? crumbs.sep : '›'}</span>}
              {c.kind === 'outside' ? (
                <span className="cursor-help px-1 py-0.5 opacity-60" title="挂载点之外的宿主机目录，容器访问不到">{c.name}</span>
              ) : c.kind === 'link' ? (
                <Link to="/folders" search={{ path: c.path }} className="rounded-md px-1.5 py-0.5 text-fg-2 hover:bg-accent-soft hover:text-fg">{c.name}</Link>
              ) : (
                <span aria-current="page" className="px-1.5 py-0.5 font-semibold text-fg">{c.name}</span>
              )}
            </Fragment>
          ))}
          {root ? (
            <span title="容器内看到的路径" className="ml-2.5 rounded-full border border-line-2 px-[9px] py-px text-[11.5px] whitespace-nowrap">容器内 {containerPathOf(root, path)}</span>
          ) : (
            <span title="媒体库内的虚拟路径" className="ml-2.5 rounded-full border border-line-2 px-[9px] py-px text-[11.5px] whitespace-nowrap">虚拟路径 {path}</span>
          )}
        </nav>
        <div className="min-w-0">
          <PageTitle>{name}</PageTitle>
          <div className={metaText}>
            {d.directMediaCount.toLocaleString('zh-CN')} 项直接位于这个文件夹，含子文件夹共 {total.toLocaleString('zh-CN')} 项
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:ml-auto">
          <button
            type="button"
            aria-pressed={d.favorite}
            className={chip(d.favorite)}
            onClick={() => fav.mutate({ path, favorite: !d.favorite, name })}
          >
            <Heart className={cn(d.favorite && 'fill-current')} />{d.favorite ? '已收藏' : '收藏文件夹'}
          </button>
          <button type="button" className={chip()} onClick={play}>
            <Play className="size-3.5! fill-current" strokeWidth={0} />播放幻灯片
          </button>
          {d.hostPath && (
            <button type="button" className={chip()} onClick={() => void copyText(d.hostPath!, `已复制宿主机路径 ${d.hostPath}`)}>
              <Copy />复制路径
            </button>
          )}
        </div>
      </PageHead>

      {d.folders.length > 0 && (
        <>
          <h2 className={subhClass}>子文件夹<span className="text-[13px] font-normal text-muted">{d.folders.length} 个</span></h2>
          <FolderGrid>
            {d.folders.map((f) => <FolderCard key={f.path} folder={f} />)}
          </FolderGrid>
        </>
      )}

      <div className={subhClass}>
        <h2 className="m-0 text-[15px] font-semibold">{rec ? '这个文件夹及子文件夹中的内容' : '这个文件夹中的内容'}</h2>
        <span className="text-[13px] font-normal text-muted">{shownCount.toLocaleString('zh-CN')} 项</span>
        <SortMenu className="ml-auto" />
        <button
          type="button"
          aria-pressed={rec}
          className={chip(rec, true)}
          onClick={() => updatePrefs.mutate({ folderIncludeSubfolders: !rec })}
        >
          包含子文件夹
        </button>
      </div>
      {media.isError ? (
        <EmptyNote>无法加载这个文件夹的内容：{media.error.message}</EmptyNote>
      ) : media.isPending ? (
        <EmptyNote>正在加载…</EmptyNote>
      ) : !media.items.length ? (
        <EmptyNote>
          {rec ? '这个文件夹及其子文件夹中没有照片或视频。'
            : d.folders.length ? '这里没有直接存放的照片或视频。打开上面的子文件夹，或打开“包含子文件夹”。'
              : '这个文件夹是空的。'}
        </EmptyNote>
      ) : (
        <div className="px-0.5 pt-2 pb-[120px] md:px-11">
          <PagedMediaGrid
            items={media.items}
            scrollElement={scroller}
            hasMore={media.hasNextPage}
            onEndReached={media.loadMore}
            onOpen={(index, el) =>
              openViewer({ label, items: media.items, query, nextCursor: media.nextCursor, total: media.total }, index, { originEl: el })}
          />
        </div>
      )}
    </>
  );
}

export default function FoldersPage() {
  const { path } = useSearch({ from: '/app/folders' });
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    scroller?.scrollTo({ top: 0 });
  }, [path, scroller]);
  return (
    <div className="grid h-full grid-cols-1 md:grid-cols-[272px_minmax(0,1fr)]">
      <FolderTree current={path || undefined} />
      <div ref={setScroller} className="relative h-full min-w-0 overflow-x-hidden overflow-y-auto [scrollbar-width:thin]">
        {path ? <FolderView key={path} path={path} scroller={scroller} /> : <LibraryRoots />}
      </div>
    </div>
  );
}
