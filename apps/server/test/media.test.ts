import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediaPage, TimelineBuckets, MediaItems } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

test('分页稳定、权限过滤、中文子串、区间分桶与随机浏览', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    db.prepare("INSERT INTO libraries (id,name,root) VALUES ('lib1','测试','/test')").run();
    const add = db.prepare(`INSERT INTO files (id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source)
      VALUES (?, 'lib1', ?, ?, ?, 'image/jpeg', 'image', 100, ?, ?, 'mtime')`);
    const date = Date.UTC(2024, 0, 5) / 1000;
    add.run('a', '旅行/美丽的西湖风景.jpg', 'lib1/旅行', '美丽的西湖风景.jpg', date, date);
    add.run('b', '旅行/两张.jpg', 'lib1/旅行', '两张.jpg', date, date);
    add.run('c', '旅行/三张.jpg', 'lib1/旅行', '三张.jpg', date, date);
    add.run('d', '旅行者/私密.jpg', 'lib1/旅行者', '私密.jpg', date, date);
    db.prepare("UPDATE users SET role='user', allowed_paths=? WHERE username='admin'").run(JSON.stringify(['lib1/旅行']));
    const denied = await app.inject({ method: 'PUT', url: '/api/v2/media/favorite', headers: { cookie, 'x-luvia-request': '1' }, payload: { ids: ['a', 'd'], favorite: true } });
    assert.equal(denied.statusCode, 403);
    assert.equal((db.prepare('SELECT count(*) AS n FROM favorites').get() as { n: number }).n, 0);
    const addedFavorite = await app.inject({ method: 'PUT', url: '/api/v2/media/favorite', headers: { cookie, 'x-luvia-request': '1' }, payload: { ids: ['a'], favorite: true } });
    assert.equal(addedFavorite.statusCode, 200);
    assert.equal(addedFavorite.json().updated, 1);
    const first = await app.inject({ method: 'GET', url: '/api/v2/media?limit=2', headers: { cookie } });
    assert.equal(first.statusCode, 200);
    const page1 = MediaPage.parse(first.json());
    assert.deepEqual(page1.items.map((item) => item.id), ['a', 'b']);
    assert.ok(page1.nextCursor);
    const second = await app.inject({ method: 'GET', url: `/api/v2/media?limit=2&cursor=${encodeURIComponent(page1.nextCursor!)}`, headers: { cookie } });
    assert.deepEqual(MediaPage.parse(second.json()).items.map((item) => item.id), ['c']);
    const search = await app.inject({ method: 'GET', url: `/api/v2/media?q=${encodeURIComponent('西湖风')}`, headers: { cookie } });
    assert.deepEqual(MediaPage.parse(search.json()).items.map((item) => item.id), ['a']);
    const buckets = await app.inject({ method: 'GET', url: '/api/v2/media/buckets', headers: { cookie } });
    const bucket = TimelineBuckets.parse(buckets.json());
    assert.equal(bucket.total, 3);
    add.run('e', '旅行/新增.jpg', 'lib1/旅行', '新增.jpg', date, date);
    const changedBuckets = await app.inject({ method: 'GET', url: '/api/v2/media/buckets', headers: { cookie } });
    assert.equal(TimelineBuckets.parse(changedBuckets.json()).total, 4);
    db.prepare("DELETE FROM files WHERE id='e'").run();
    const interval = await app.inject({ method: 'GET', url: `/api/v2/media?from=${bucket.buckets[0]!.start}&to=${bucket.buckets[0]!.end}`, headers: { cookie } });
    assert.equal(MediaPage.parse(interval.json()).items.length, 3);
    const random = await app.inject({ method: 'GET', url: '/api/v2/media/random?count=10', headers: { cookie } });
    const randomItems = MediaItems.parse(random.json()).items;
    assert.equal(randomItems.length, 3);
    assert.equal(new Set(randomItems.map((i) => i.id)).size, 3);
    assert.ok(randomItems.every((i) => i.folder === 'lib1/旅行'));
  } finally { await app.close(); db.close(); }
});
