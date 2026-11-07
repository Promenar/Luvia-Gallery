import { ArrowDownUp } from 'lucide-react';
import type { MediaSort } from '@luvia/contracts';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from '@/components/kit/dropdown-menu';
import { cn } from '@/lib/cn';
import { chip } from '@/pages/folders/ui';
import { usePreferences, useUpdatePreferences } from '@/stores/session';

export const SORT_LABEL: Record<MediaSort, string> = {
  modified_desc: '修改时间，最新在前',
  taken_desc: '拍摄时间，最新在前',
  taken_asc: '拍摄时间，最早在前',
  name_asc: '文件名，A 到 Z',
  size_desc: '文件大小，最大在前',
};
const SHORT_LABEL: Record<MediaSort, string> = {
  modified_desc: '修改时间', taken_desc: '拍摄时间', taken_asc: '拍摄时间（最早）', name_asc: '文件名', size_desc: '文件大小',
};

/** 文件夹、相册、收藏共用的媒体排序（保存在用户偏好中）。 */
export function useMediaSort(): MediaSort {
  return usePreferences().mediaSort;
}

/** 媒体网格的排序菜单，选择后写入用户偏好，文件夹、相册、收藏一起生效。 */
export function SortMenu({ className, small = true, scopeLabel }: { className?: string; small?: boolean; scopeLabel?: string }) {
  const sort = useMediaSort();
  const update = useUpdatePreferences();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" className={cn(chip(false, small), className)} aria-label={`${scopeLabel ?? ''}排序：${SORT_LABEL[sort]}`}>
            <ArrowDownUp />{scopeLabel ? `${scopeLabel}：` : ''}{SHORT_LABEL[sort]}
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>排序方式</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={sort} onValueChange={(v) => update.mutate({ mediaSort: v as MediaSort })}>
            {(Object.keys(SORT_LABEL) as MediaSort[]).map((k) => (
              <DropdownMenuRadioItem key={k} value={k}>{SORT_LABEL[k]}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 文件夹自身时间与媒体的拍摄时间、大小是不同维度。 */
export function FolderSortMenu() {
  const sort = usePreferences().folderSort;
  const update = useUpdatePreferences();
  const labels = { modified_desc: '修改时间', name_asc: '名称' } as const;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" className={chip(false, false)} aria-label={`文件夹排序：${labels[sort]}`}>
        <ArrowDownUp />文件夹：{labels[sort]}
      </button>} />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>文件夹排序</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={sort} onValueChange={(v) => update.mutate({ folderSort: v as typeof sort })}>
            <DropdownMenuRadioItem value="modified_desc">文件夹修改时间，最新在前</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="name_asc">文件夹名称，A 到 Z</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
