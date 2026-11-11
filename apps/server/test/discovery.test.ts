import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Memories, SearchSuggest } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { MediaReader } from '../src/core/media-query.ts';
import { QueryExecutor, type Statement } from '../src/core/query-executor.ts';

test('那年今日使用拍摄时间范围索引，并排除闰日以外的日期及不可见媒体', async () => {
  const db = openDatabase(':memory:');
  const plans: string[] = [];
  class ExplainExecutor extends QueryExecutor {
    override run(statements: Statement[]) {
      for (const { sql, params } of statements) {
        const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[];
        plans.push(...rows.map(({ detail }) => detail));
      }
      return super.run(statements);
    }
  }
  try {
    db.exec("INSERT INTO libraries(id,name,root,enabled) VALUES ('lib','照片','/fixture',1),('off','关闭','/disabled',0)");
    const insert = db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,missing_at_ms)
      VALUES (?,?,?,?,?,'image/jpeg','image',1,0,?,'metadata',?)`);
    const day = (year: number, month: number, date: number, hour = 0) => new Date(year, month - 1, date, hour).getTime() / 1000;
    const add = (id: string, time: number, folder = 'lib/公开', library = 'lib', missing: number | null = null) =>
      insert.run(id, library, `${id}.jpg`, folder, `${id}.jpg`, time, missing);
    for (let i = 0; i < 13; i++) add(`photo-${i}`, day(2020, 2, 29) + i);
    add('earlier-year', day(2016, 2, 29));
    add('before', day(2020, 2, 29) - 1);
    add('after', day(2020, 3, 1));
    add('non-leap', day(2021, 3, 1));
    add('current', day(2024, 2, 29));
    add('private', day(2020, 2, 29, 12), 'lib/私密');
    add('disabled', day(2020, 2, 29, 12), 'off', 'off');
    add('missing', day(2020, 2, 29, 12), 'lib/公开', 'lib', 1);
    const reader = new MediaReader(db, new ExplainExecutor(db));
    const result = await reader.memories({ id: 'test', allowedPaths: ['lib/公开', 'off'] }, new Date(2024, 1, 29, 12));
    assert.ok(plans.some((plan) => /SEARCH f USING INDEX files_taken_id \(taken_at>\? AND taken_at<\?\)/.test(plan)), plans.join('\n'));
    assert.deepEqual(result.onThisDay.map(({ year, count }) => [year, count]), [[2020, 13], [2016, 1]]);
    assert.deepEqual(result.onThisDay[0]?.items.map(({ id }) => id), Array.from({ length: 12 }, (_, i) => `photo-${12 - i}`));
    assert.deepEqual(result.onThisDay[1]?.items.map(({ id }) => id), ['earlier-year']);
  } finally { db.close(); }
});

test('回忆与搜索联想只返回用户可见内容', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name,media_count) VALUES ('lib','lib',NULL,'照片',3),('lib/旅途','lib','lib','旅途',2),('lib/私密','lib','lib','私密',1)").run();
    const insert = db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,model,created_at)
      VALUES (?,'lib',?,?,?,'image/jpeg','image',1,?,?, 'mtime',?,?)`);
    const today = new Date();
    const stamp = (year: number) => Math.floor(new Date(year, today.getMonth(), today.getDate(), 12).getTime() / 1000);
    const year = today.getFullYear();
    insert.run('old', '旅途/旅途相片.jpg', 'lib/旅途', '旅途相片.jpg', stamp(year - 1), stamp(year - 1), '旅途相机', 10);
    insert.run('current', '旅途/今日.jpg', 'lib/旅途', '今日.jpg', stamp(year), stamp(year), 'Camera', 20);
    insert.run('private', '私密/旅途秘密.jpg', 'lib/私密', '旅途秘密.jpg', stamp(year - 1), stamp(year - 1), '旅途秘密相机', 30);
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const headers = { cookie, 'x-luvia-request': '1' };
    await app.inject({ method: 'POST', url: '/api/v2/albums', headers, payload: { name: '旅途相册', ids: ['old'] } });
    db.prepare("UPDATE users SET role='user',allowed_paths=? WHERE username='admin'").run(JSON.stringify(['lib/旅途']));
    const memoriesRes = await app.inject({ method: 'GET', url: '/api/v2/memories', headers: { cookie } });
    assert.equal(memoriesRes.statusCode, 200);
    const memories = Memories.parse(memoriesRes.json());
    assert.equal(memories.onThisDay[0]?.year, year - 1); assert.equal(memories.onThisDay[0]?.count, 1);
    assert.deepEqual(memories.onThisDay[0]?.items.map((item) => item.id), ['old']);
    assert.equal(memories.recentlyAdded[0]?.id, 'current');
    assert.ok(memories.shuffle.every((item) => item.id !== 'private'));
    const suggestionsRes = await app.inject({ method: 'GET', url: '/api/v2/search/suggest?q=旅途', headers: { cookie } });
    assert.equal(suggestionsRes.statusCode, 200);
    const suggestions = SearchSuggest.parse(suggestionsRes.json());
    assert.deepEqual(suggestions.folders.map((item) => item.path), ['lib/旅途']);
    assert.equal(suggestions.albums[0]?.name, '旅途相册');
    assert.deepEqual(suggestions.cameras, ['旅途相机']);
    assert.ok(suggestions.media.every((item) => item.id !== 'private'));
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/search/suggest?q=', headers: { cookie } })).statusCode, 400);
  } finally { await app.close(); db.close(); }
});
