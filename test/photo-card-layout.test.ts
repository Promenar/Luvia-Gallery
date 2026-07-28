import { describe, expect, it } from 'vitest';
import { getMediaCardContainerClasses } from '../components/PhotoCard';

describe('MediaCard 布局间距', () => {
  it('瀑布流卡片不再提供额外底部外边距，间距仅由 Masonry gap-4 控制', () => {
    expect(getMediaCardContainerClasses(false)).not.toContain('mb-6');
    expect(getMediaCardContainerClasses(false)).toContain('break-inside-avoid');
    expect(getMediaCardContainerClasses(true)).toContain('aspect-square');
  });
});
