import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Memories, SearchSuggest } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

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
