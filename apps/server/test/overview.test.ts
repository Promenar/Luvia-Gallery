import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AdminOverview, LogList } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

test('管理员概览报告真实索引、缓存与作业计数，日志不包含凭据或查询字符串', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    db.prepare("INSERT INTO libraries(id,name,root,last_scan_at) VALUES ('lib','照片','/fixture',100)").run();
    const add = db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,thumb_version,metadata_status,has_preview)
      VALUES (?,'lib',?,'lib',?,'image/jpeg',?,1,1,1,'mtime',?,?,?)`);
    add.run('photo', 'photo.jpg', 'photo.jpg', 'image', 1, 'done', 0);
    db.prepare("UPDATE files SET thumb_ready=1 WHERE id='photo'").run();
    add.run('video', 'video.mp4', 'video.mp4', 'video', 0, 'pending', 1);
    db.prepare("INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at) VALUES ('key','fixture',123,1)").run();
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('queued','scan','扫描','queued','manual',1),('running','metadata','元数据','running','manual',1)").run();
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const result = await app.inject({ method: 'GET', url: '/api/v2/admin/overview', headers: { cookie } });
    assert.equal(result.statusCode, 200);
    const overview = AdminOverview.parse(result.json());
    assert.deepEqual(overview.media, { total: 2, images: 1, videos: 1, audio: 0 });
    assert.deepEqual(overview.thumbnails, { coverage: 0.5, missing: 1 });
    assert.deepEqual(overview.metadata, { indexed: 1, total: 2 });
    assert.deepEqual(overview.previews, { ready: 1, total: 1 });
    assert.equal(overview.cache.bytes, 123); assert.equal(overview.activeJobs, 1); assert.equal(overview.health.queueDepth, 1);
    assert.equal(overview.lastScanAt, new Date(100_000).toISOString());
    assert.equal(overview.health.series.apiP95Ms.length, 60);
    assert.ok(overview.health.apiP95Ms > 0);
    const { createWorkerLogger } = await import('../src/core/observability.ts');
    createWorkerLogger(db).info({ ctx: { type: 'scan' } }, '作业完成');
    await app.inject({ method: 'GET', url: '/api/v2/auth/state?token=synthetic-secret', headers: { cookie } });
    const logResponse = await app.inject({ method: 'GET', url: '/api/v2/admin/logs?limit=100', headers: { cookie } });
    assert.equal(logResponse.statusCode, 200);
    const logs = LogList.parse(logResponse.json()).logs;
    assert.ok(logs.some((entry) => entry.source === 'worker' && entry.msg === '作业完成'));
    assert.ok(logs.some((entry) => entry.source === 'api'));
    assert.ok(!logResponse.body.includes('synthetic-secret')); assert.ok(!logResponse.body.includes(cookie));
    db.prepare("UPDATE users SET role='user' WHERE username='admin'").run();
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/admin/overview', headers: { cookie } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/admin/logs', headers: { cookie } })).statusCode, 403);
  } finally { await app.close(); db.close(); }
});
