import type { Preferences } from '@luvia/contracts';

const names = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** 仅重排目录卡片；没有可靠修改时间的条目排在末尾。 */
export function sortFolders<T extends { name: string; modifiedAt?: string | null }>(folders: readonly T[], sort: Preferences['folderSort']): T[] {
  return [...folders].sort((a, b) => {
    if (sort === 'modified_desc') {
      const left = a.modifiedAt ? Date.parse(a.modifiedAt) : NaN;
      const right = b.modifiedAt ? Date.parse(b.modifiedAt) : NaN;
      if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return right - left;
      if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
    }
    return names.compare(a.name, b.name);
  });
}
