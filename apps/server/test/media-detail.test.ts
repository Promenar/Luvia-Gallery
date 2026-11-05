import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediaDetail } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

test('媒体详情返回真实元数据、面包屑及当前用户手动相册，并限制目录权限', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','摄影','/fixture')").run();
    db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,make,model,f_number,latitude,longitude,altitude)
      VALUES ('photo','lib','旅途/照片.jpg','lib/旅途','照片.jpg','image/jpeg','image',1,1,2,'metadata','Maker','Camera',2.8,30.5,120,4)`).run();
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const headers = { cookie, 'x-luvia-request': '1' };
    const album = await app.inject({ method: 'POST', url: '/api/v2/albums', headers, payload: { name: '旅途', ids: ['photo'] } });
    const response = await app.inject({ method: 'GET', url: '/api/v2/media/photo', headers: { cookie } });
    assert.equal(response.statusCode, 200);
    const detail = MediaDetail.parse(response.json());
    assert.equal(detail.exif?.model, 'Camera'); assert.equal(detail.exif?.fNumber, 2.8);
    assert.deepEqual(detail.location, { lat: 30.5, lon: 120, altitude: 4 });
    assert.equal(detail.video, null); assert.equal(detail.libraryName, '摄影');
    assert.deepEqual(detail.breadcrumbs, [{ name: '摄影', path: 'lib' }, { name: '旅途', path: 'lib/旅途' }]);
    assert.deepEqual(detail.albumIds, [album.json().id]);
    db.prepare("UPDATE users SET role='user',allowed_paths=? WHERE username='admin'").run(JSON.stringify(['lib/private']));
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/media/photo', headers: { cookie } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/media/photo' })).statusCode, 401);
  } finally { await app.close(); db.close(); }
});
