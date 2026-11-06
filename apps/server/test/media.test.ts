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

test('时间线可按修改时间分桶与按月取页，与拍摄时间互不影响', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    db.prepare("INSERT INTO libraries (id,name,root) VALUES ('lib1','测试','/test')").run();
    const add = db.prepare(`INSERT INTO files (id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,missing_at_ms)
      VALUES (?, 'lib1', ?, 'lib1', ?, 'image/jpeg', 'image', 100, ?, ?, 'metadata', ?)`);
    const at = (year: number, month: number) => Math.floor(new Date(year, month - 1, 15).getTime() / 1000);
    // 拍摄于 2019 年、2024 年 3 月拷入；拍摄于 2020 年、2024 年 5 月拷入；缺失文件不计入
    add.run('old', 'old.jpg', 'old.jpg', at(2024, 3), at(2019, 7), null);
    add.run('mid', 'mid.jpg', 'mid.jpg', at(2024, 5), at(2020, 1), null);
    add.run('gone', 'gone.jpg', 'gone.jpg', at(2024, 5), at(2020, 1), Date.now());
    const get = async (url: string) => (await app.inject({ method: 'GET', url, headers: { cookie } })).json();
    const keys = (value: unknown) => TimelineBuckets.parse(value).buckets.map((bucket) => `${bucket.key}:${bucket.count}`);
    assert.deepEqual(keys(await get('/api/v2/media/buckets?timeField=modified')), ['2024-05:1', '2024-03:1']);
    assert.deepEqual(keys(await get('/api/v2/media/buckets')), ['2020-01:1', '2019-07:1']);
    // 有筛选条件时走通用分组查询，结果一致
    assert.deepEqual(keys(await get('/api/v2/media/buckets?timeField=modified&types=image')), ['2024-05:1', '2024-03:1']);
    const may = TimelineBuckets.parse(await get('/api/v2/media/buckets?timeField=modified')).buckets[0]!;
    const page = MediaPage.parse(await get(`/api/v2/media?sort=modified_desc&timeField=modified&to=${may.end}&from=${may.start}`));
    assert.deepEqual(page.items.map((item) => item.id), ['mid']);
  } finally { await app.close(); db.close(); }
});

test('文件夹含子文件夹时各排序逐页翻完顺序正确，子树占全库一半以上才沿排序索引遍历', async () => {
  const { MediaReader } = await import('../src/core/media-query.ts');
  const { MediaListQuery } = await import('@luvia/contracts');
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries (id,name,root) VALUES ('big','大','/big'),('small','小','/small')").run();
    const folder = db.prepare('INSERT INTO folders (path,library_id,parent,name,media_count) VALUES (?,?,?,?,?)');
    folder.run('big', 'big', null, '大', 30000); folder.run('big/a', 'big', 'big', 'a', 20000); folder.run('small', 'small', null, '小', 12000);
    const add = db.prepare(`INSERT INTO files (id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source)
      VALUES (?,?,?,?,?,'image/jpeg','image',?,?,?,'mtime')`);
    const rows: { id: string; folder: string; name: string; size: number; modified: number; taken: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const lib = i % 4 === 0 ? 'small' : 'big'; const sub = lib === 'big' && i % 3 === 0 ? 'big/a' : lib;
      // 刻意制造同值，检验游标对同值行不重不漏
      const row = { id: `f${String(i).padStart(2, '0')}`, folder: sub, name: `${['b', 'A', 'c'][i % 3]}${i % 5}.jpg`, size: (i % 6) * 100, modified: 1000 + (i % 7), taken: 2000 + (i % 4) };
      rows.push(row); add.run(row.id, lib, `${row.id}.jpg`, row.folder, row.name, row.size, row.modified, row.taken);
    }
    const sqls: string[] = [];
    const proxy = new Proxy(db, { get: (target, key) => key === 'prepare' ? (sql: string) => { sqls.push(sql); return target.prepare(sql); } : (typeof (target as any)[key] === 'function' ? (target as any)[key].bind(target) : (target as any)[key]) });
    const reader = new MediaReader(proxy as typeof db);
    const compare: Record<string, (a: typeof rows[0], b: typeof rows[0]) => number> = {
      taken_desc: (a, b) => b.taken - a.taken, taken_asc: (a, b) => a.taken - b.taken, modified_desc: (a, b) => b.modified - a.modified,
      size_desc: (a, b) => b.size - a.size, name_asc: (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    };
    for (const [root, forced] of [['big', true], ['big/a', false], ['small', false]] as const) {
      for (const sort of Object.keys(compare)) {
        const expected = rows.filter((r) => r.folder === root || r.folder.startsWith(`${root}/`))
          .sort((a, b) => compare[sort]!(a, b) || (a.id < b.id ? -1 : 1)).map((r) => r.id);
        const seen: string[] = []; let cursor: string | undefined; sqls.length = 0;
        do {
          const page = reader.page(MediaListQuery.parse({ scope: 'folder', folder: root, recursive: true, sort, limit: 3, cursor }), { id: 'u', allowedPaths: null });
          seen.push(...page.items.map((item) => item.id)); cursor = page.nextCursor ?? undefined;
        } while (cursor);
        assert.deepEqual(seen, expected, `${root} ${sort}`);
        assert.equal(sqls.some((sql) => sql.includes('INDEXED BY files_')), forced, `${root} ${sort} 计划`);
      }
    }
  } finally { db.close(); }
});

test('收藏较少时先取收藏集合再排序，结果与逐行判断一致且只包含收藏的文件与收藏文件夹的内容', async () => {
  const { MediaReader } = await import('../src/core/media-query.ts');
  const { MediaListQuery } = await import('@luvia/contracts');
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const userId = setup.json().user.id as string;
    db.prepare("INSERT INTO libraries (id,name,root) VALUES ('lib','库','/lib')").run();
    const folder = db.prepare('INSERT INTO folders (path,library_id,parent,name,media_count) VALUES (?,?,?,?,?)');
    folder.run('lib', 'lib', null, '库', 30); folder.run('lib/fav', 'lib', 'lib', 'fav', 8); folder.run('lib/fav/sub', 'lib', 'lib/fav', 'sub', 3); folder.run('lib/other', 'lib', 'lib', 'other', 10);
    const add = db.prepare(`INSERT INTO files (id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source)
      VALUES (?,'lib',?,?,?,'image/jpeg','image',?,?,?,'mtime')`);
    const folders = ['lib', 'lib/fav', 'lib/fav/sub', 'lib/other', 'lib/fav0'];
    for (let i = 0; i < 30; i++) add.run(`f${String(i).padStart(2, '0')}`, `${i}.jpg`, folders[i % 5], `${['b', 'A', 'c'][i % 3]}${i % 4}.jpg`, (i % 6) * 10, 1000 + (i % 7), 2000 + (i % 4));
    const favorite = db.prepare('INSERT INTO favorites (user_id,item_id,item_type) VALUES (?,?,?)');
    favorite.run(userId, 'lib/fav', 'folder'); favorite.run(userId, 'f03', 'file'); favorite.run(userId, 'f08', 'file');
    // 期望：lib/fav 及其子目录（不含前缀相同的 lib/fav0），加上单独收藏的文件；f08 在 lib/other，f03 在 lib/other
    const sqls: string[] = [];
    const proxy = new Proxy(db, { get: (target, key) => key === 'prepare' ? (sql: string) => { sqls.push(sql); return target.prepare(sql); } : (typeof (target as any)[key] === 'function' ? (target as any)[key].bind(target) : (target as any)[key]) });
    const reader = new MediaReader(proxy as typeof db);
    const list = (sort: string) => {
      const seen: string[] = []; let cursor: string | undefined;
      do {
        const page = reader.page(MediaListQuery.parse({ scope: 'favorites', sort, limit: 4, cursor }), { id: userId, allowedPaths: null });
        seen.push(...page.items.map((item) => item.id)); cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return seen;
    };
    for (const sort of ['taken_desc', 'taken_asc', 'modified_desc', 'name_asc', 'size_desc']) {
      sqls.length = 0; const small = list(sort);
      assert.ok(sqls.some((sql) => sql.includes('f.rowid IN (SELECT x.rowid FROM favorites')), sort);
      db.prepare("UPDATE folders SET media_count=10 WHERE path='lib'").run();
      sqls.length = 0; const large = list(sort);
      assert.ok(!sqls.some((sql) => sql.includes('f.rowid IN (SELECT x.rowid FROM favorites')), sort);
      db.prepare("UPDATE folders SET media_count=30 WHERE path='lib'").run();
      assert.deepEqual(small, large, sort);
      const expected = new Set(db.prepare("SELECT id FROM files WHERE folder IN ('lib/fav','lib/fav/sub') OR id IN ('f03','f08')").pluck().all() as string[]);
      assert.deepEqual(new Set(small), expected, sort);
      assert.equal(small.length, expected.size, sort);
    }
  } finally { await app.close(); db.close(); }
});
