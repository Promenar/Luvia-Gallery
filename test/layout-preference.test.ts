import { describe, expect, it } from 'vitest';
import {
  LEGACY_LAYOUT_PREFERENCE_KEY,
  createGalleryLayoutPreferenceKey,
  readGalleryLayoutPreference,
  resolveGalleryLayoutPreference,
  writeGalleryLayoutPreference,
} from '../navigation/layout-preference';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const scope = (userId: string, view: 'all' | 'favorites' | 'folders' = 'all', serverId = 'https://gallery.example') => ({ serverId, userId, view });

describe('图库布局偏好', () => {
  it('冷启动按服务端、用户与语义视图读取，folders 不按路径拆分', () => {
    const storage = new MemoryStorage();
    writeGalleryLayoutPreference(storage, scope('alice', 'all'), 'grid');
    writeGalleryLayoutPreference(storage, scope('alice', 'folders'), 'masonry');
    expect(readGalleryLayoutPreference(storage, scope('alice', 'all'))).toBe('grid');
    expect(readGalleryLayoutPreference(storage, scope('alice', 'folders'))).toBe('masonry');
    expect(readGalleryLayoutPreference(storage, scope('alice', 'favorites'))).toBeUndefined();
    expect(readGalleryLayoutPreference(storage, scope('bob', 'folders'))).toBeUndefined();
    expect(readGalleryLayoutPreference(storage, scope('alice', 'folders', 'https://other.example'))).toBeUndefined();
  });

  it('仅将旧全局 grid 或 masonry 一次性迁移到当前已登录用户', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_LAYOUT_PREFERENCE_KEY, 'masonry');
    expect(resolveGalleryLayoutPreference(storage, scope('alice', 'favorites'))).toBe('masonry');
    expect(storage.getItem(LEGACY_LAYOUT_PREFERENCE_KEY)).toBeNull();
    expect(readGalleryLayoutPreference(storage, scope('bob', 'favorites'))).toBeUndefined();
    expect(createGalleryLayoutPreferenceKey(scope('alice', 'favorites'))).toContain(':alice:favorites');
  });

  it('已有 scoped preference 仍会消费 legacy，且 legacy 不会泄漏给下一位用户', () => {
    const storage = new MemoryStorage();
    writeGalleryLayoutPreference(storage, scope('alice'), 'masonry');
    storage.setItem(LEGACY_LAYOUT_PREFERENCE_KEY, 'grid');
    expect(resolveGalleryLayoutPreference(storage, scope('alice'))).toBe('masonry');
    expect(storage.getItem(LEGACY_LAYOUT_PREFERENCE_KEY)).toBeNull();
    expect(resolveGalleryLayoutPreference(storage, scope('bob'))).toBeUndefined();
  });

  it('timeline 旧值不会迁移，且未登录或 home 作用域不会读写', () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_LAYOUT_PREFERENCE_KEY, 'timeline');
    expect(resolveGalleryLayoutPreference(storage, scope('alice'))).toBeUndefined();
    expect(storage.getItem(LEGACY_LAYOUT_PREFERENCE_KEY)).toBeNull();
    expect(createGalleryLayoutPreferenceKey({ serverId: 'https://gallery.example', userId: '', view: 'all' })).toBeUndefined();
    expect(createGalleryLayoutPreferenceKey({ serverId: 'https://gallery.example', userId: 'alice', view: 'home' })).toBeUndefined();
  });
});
