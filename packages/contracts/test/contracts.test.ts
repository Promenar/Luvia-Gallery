import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediaListQuery, Preferences, defaultPreferences, PreferencesPatch, endpoints, ThemePreference } from '../src/index.ts';

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
  assert.equal(p.theme.accent, 'mono');
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
