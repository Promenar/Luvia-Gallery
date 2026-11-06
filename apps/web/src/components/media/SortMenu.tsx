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
export function SortMenu({ className, small = true }: { className?: string; small?: boolean }) {
  const sort = useMediaSort();
  const update = useUpdatePreferences();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button type="button" className={cn(chip(false, small), className)} aria-label={`排序：${SORT_LABEL[sort]}`}>
            <ArrowDownUp />{SHORT_LABEL[sort]}
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
