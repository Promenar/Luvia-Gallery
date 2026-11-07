import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

test('列表和详情返回同一源文件版本，源变动后版本更新', async () => {
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试','/media')").run();
    db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,cache_generation)
      VALUES ('photo','lib','photo.jpg','lib','photo.jpg','image/jpeg','image',123,1700000000,1700000000,'mtime',4)`).run();
    const list = await app.inject({ method: 'GET', url: '/api/v2/media?limit=10', headers: { cookie } });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json().items[0].source, { size: 123, modifiedAt: 1700000000, generation: 4 });
    const detail = await app.inject({ method: 'GET', url: '/api/v2/media/photo', headers: { cookie } });
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(detail.json().source, list.json().items[0].source);
    db.prepare("UPDATE files SET cache_generation=5 WHERE id='photo'").run();
    const updated = await app.inject({ method: 'GET', url: '/api/v2/media/photo', headers: { cookie } });
    assert.equal(updated.json().source.generation, 5);
  } finally { await app.close(); db.close(); }
});
