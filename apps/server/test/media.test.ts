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

test('随机查询区分直接文件夹、收藏文件夹和排除列表', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const userId = setup.json().user.id as string;
    db.prepare("INSERT INTO libraries (id,name,root) VALUES ('lib','测试','/test')").run();
    const add = db.prepare(`INSERT INTO files (id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES (?,'lib',?,?,?,'image/jpeg','image',1,1,1,'mtime')`);
    add.run('a', 'parent/a.jpg', 'lib/parent', 'a.jpg');
    add.run('b', 'parent/sub/b.jpg', 'lib/parent/sub', 'b.jpg');
    add.run('c', 'other/c.jpg', 'lib/other', 'c.jpg');
    db.prepare("INSERT INTO favorites (user_id,item_id,item_type) VALUES (?, 'a', 'file'), (?, 'lib/parent/sub', 'folder')").run(userId, userId);
    const ids = async (query: string) => {
      const res = await app.inject({ method: 'GET', url: `/api/v2/media/random?count=10&${query}`, headers: { cookie } });
      assert.equal(res.statusCode, 200);
      return MediaItems.parse(res.json()).items.map((value) => value.id).sort();
    };
    assert.deepEqual(await ids('folder=lib%2Fparent'), ['a']);
    assert.deepEqual(await ids('favorite=true'), ['a']);
    assert.deepEqual(await ids('favorite=true&favoriteFolders=true'), ['a', 'b']);
    assert.deepEqual(await ids('favorite=true&favoriteFolders=true&exclude=a'), ['b']);
    const tooMany = Array.from({ length: 501 }, (_, i) => `id${i}`).join(',');
    const rejected = await app.inject({ method: 'GET', url: `/api/v2/media/random?exclude=${tooMany}`, headers: { cookie } });
    assert.equal(rejected.statusCode, 400);
  } finally { await app.close(); db.close(); }
});

test('禁用媒体库后列表、分桶、随机和媒体写入都不再包含其文件', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    db.prepare("INSERT INTO libraries(id,name,root,enabled) VALUES ('live','启用','/a',1),('off','禁用','/b',0)").run();
    const add = db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES (?,?,?,?,?,'image/jpeg','image',1,1,1,'mtime')");
    add.run('visible', 'live', 'a.jpg', 'live', 'a.jpg'); add.run('hidden', 'off', 'b.jpg', 'off', 'b.jpg');
    const page = await app.inject({ method: 'GET', url: '/api/v2/media', headers: { cookie } });
    assert.deepEqual(MediaPage.parse(page.json()).items.map((item) => item.id), ['visible']);
    const buckets = await app.inject({ method: 'GET', url: '/api/v2/media/buckets', headers: { cookie } });
    assert.equal(TimelineBuckets.parse(buckets.json()).total, 1);
    const random = await app.inject({ method: 'GET', url: '/api/v2/media/random?count=10', headers: { cookie } });
    assert.deepEqual(MediaItems.parse(random.json()).items.map((item) => item.id), ['visible']);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/v2/media/favorite', headers: { cookie, 'x-luvia-request': '1' }, payload: { ids: ['hidden'], favorite: true } })).statusCode, 403);
  } finally { await app.close(); db.close(); }
});
