import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediaListQuery, Preferences, defaultPreferences, PreferencesPatch, endpoints, ThemePreference, RandomQuery, WallpaperConfig, CreateLibraryBody, UpdateLibraryBody, Library, AdminSettings, LibraryChangedEvent, LibraryChange } from '../src/index.ts';

test('列表查询参数解析逗号分隔与默认值', () => {
  const q = MediaListQuery.parse({ types: 'image,video', hasLocation: '1', limit: '50' });
  assert.deepEqual(q.types, ['image', 'video']);
  assert.equal(q.hasLocation, true);
  assert.equal(q.limit, 50);
  assert.equal(q.scope, 'all');
  assert.equal(q.sort, 'taken_desc');
});

test('偏好默认值完整且主题接受预设或自定义色', () => {
  const p = defaultPreferences();
  assert.equal(p.theme.accent, 'dynamic');
  assert.equal(p.home.heroSource, 'memories');
  assert.equal(p.slideshow.intervalSec, 5);
  assert.equal(p.folderIncludeSubfolders, false);
  assert.equal(p.density, 3);
  assert.equal(ThemePreference.parse({ accent: '#3a7bd5' }).accent, '#3a7bd5');
  assert.throws(() => ThemePreference.parse({ accent: 'red' }));
  assert.deepEqual(Preferences.parse({}), p);
});

test('偏好补丁允许局部主题字段', () => {
  const patch = PreferencesPatch.parse({ theme: { accent: 'teal' } });
  assert.deepEqual(patch, { theme: { accent: 'teal' } });
});

test('路由表路径唯一', () => {
  const keys = Object.values(endpoints).map((e) => `${e.method} ${e.path}`);
  assert.equal(new Set(keys).size, keys.length);
});

test('偏好补丁允许局部首页与幻灯片字段，且不填默认值', () => {
  const patch = PreferencesPatch.parse({ home: { heroSource: 'folder', heroFolder: 'photos/2019' }, slideshow: { intervalSec: 8 } });
  assert.deepEqual(patch, { home: { heroSource: 'folder', heroFolder: 'photos/2019' }, slideshow: { intervalSec: 8 } });
  assert.throws(() => PreferencesPatch.parse({ slideshow: { intervalSec: 1 } }));
});

test('随机查询支持直接子目录、收藏文件夹与排除列表', () => {
  const q = RandomQuery.parse({ folder: 'photos/2019', favorite: '1', favoriteFolders: 'true', exclude: 'a,b' });
  assert.equal(q.folder, 'photos/2019');
  assert.equal(q.favoriteFolders, true);
  assert.deepEqual(q.exclude, ['a', 'b']);
  assert.equal(q.count, 24);
});

test('壁纸设置默认值与媒体库创建参数', () => {
  assert.deepEqual(WallpaperConfig.parse({}), { source: 'library', folder: null, intervalSec: 30, landscapeOnly: true, includeVideos: false });
  assert.equal(CreateLibraryBody.parse({ name: 'Videos', root: '/media/videos' }).enabled, true);
});

test('媒体库实时监控字段与边界', () => {
  const lib = {
    id: 'l1', name: '照片库', root: '/media/photos', hostRoot: '/vol1/1000/Photos', hostRootSource: 'auto', exclude: [],
    status: 'ok', mediaCount: 1, lastScanAt: null, enabled: true,
    watch: { mode: 'auto', pollIntervalSec: 300, state: 'watching', watchedDirs: 15164, lastEventAt: null, lastReconcileAt: null, degradedReason: null },
  };
  assert.equal(Library.parse(lib).watch.state, 'watching');
  assert.throws(() => Library.parse({ ...lib, watch: undefined }));
  assert.equal(UpdateLibraryBody.parse({ watch: { mode: 'poll' } }).watch?.mode, 'poll');
  assert.throws(() => UpdateLibraryBody.parse({ watch: { pollIntervalSec: 30 } }));
  assert.throws(() => UpdateLibraryBody.parse({ watch: { mode: 'inotify' } }));
  assert.equal(CreateLibraryBody.parse({ name: 'V', root: '/media/v' }).watch, undefined);
});

test('全量对账时间与删除宽限期校验', () => {
  const base = {
    siteName: 'Luvia', publicUrl: null,
    libraries: { autoEnableNewMounts: false, missingGraceDays: 7 },
    folders: { exposeHostPaths: true },
    scan: { mode: 'daily', intervalMinutes: 1440, dailyAt: '04:00' },
    workers: { thumbnailConcurrency: 4, ffmpegConcurrency: 2, metadataConcurrency: 8 },
    transcode: { enabled: true, hwaccel: 'auto' }, previews: { enabled: true }, cache: { limitGB: 50 },
  };
  assert.equal(AdminSettings.parse(base).scan.dailyAt, '04:00');
  assert.throws(() => AdminSettings.parse({ ...base, scan: { ...base.scan, dailyAt: '24:00' } }));
  assert.throws(() => AdminSettings.parse({ ...base, libraries: { ...base.libraries, missingGraceDays: -1 } }));
});

test('变更事件与变更记录', () => {
  const ev = LibraryChangedEvent.parse({ libraryId: 'l1', source: 'watch', folders: ['photos/2026'], added: 2, removed: 0, updated: 1, moved: 1 });
  assert.equal(ev.moved, 1);
  assert.throws(() => LibraryChangedEvent.parse({ libraryId: 'l1', source: 'fsnotify', folders: [], added: 0, removed: 0, updated: 0, moved: 0 }));
  const ch = LibraryChange.parse({ ts: '2026-11-05T12:00:00.000Z', kind: 'moved', path: 'b/x.jpg', fromPath: 'a/x.jpg', isDir: false, mediaId: 'm1', source: 'watch' });
  assert.equal(ch.fromPath, 'a/x.jpg');
});
