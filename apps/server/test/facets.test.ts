import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MediaFacets, TimelineBuckets } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

test('筛选候选和分桶按筛选条件及用户目录权限统计', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-facets-'));
  const db = openDatabase(path.join(root, 'db.sqlite')); const app = await createApp({ db, legacyPending: false });
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/fixture')").run();
    const insert = db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,model)
      VALUES (?,'lib',?,?,?,'image/jpeg',?,1,?,?, 'mtime',?)`);
    const y2023 = Math.floor(new Date(2023, 5, 1).getTime() / 1000); const y2024 = Math.floor(new Date(2024, 5, 1).getTime() / 1000);
    insert.run('one', 'visible/one.jpg', 'lib/visible', 'one.jpg', 'image', y2023, y2023, 'A');
    insert.run('two', 'visible/two.mp4', 'lib/visible', 'two.mp4', 'video', y2024, y2024, 'B');
    insert.run('secret', 'private/secret.jpg', 'lib/private', 'secret.jpg', 'image', y2024, y2024, 'Secret');
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    db.prepare("UPDATE users SET role='user',allowed_paths=? WHERE username='admin'").run(JSON.stringify(['lib/visible']));
    const response = await app.inject({ method: 'GET', url: '/api/v2/media/facets', headers: { cookie } });
    assert.equal(response.statusCode, 200);
    const facets = MediaFacets.parse(response.json());
    assert.deepEqual(facets.types, { image: 1, video: 1, audio: 0 });
    assert.deepEqual(facets.cameras, [{ name: 'A', count: 1 }, { name: 'B', count: 1 }]);
    assert.deepEqual(facets.years, [{ year: 2024, count: 1 }, { year: 2023, count: 1 }]);
    const filtered = await app.inject({ method: 'GET', url: '/api/v2/media/facets?types=video', headers: { cookie } });
    assert.deepEqual(MediaFacets.parse(filtered.json()).types, { image: 0, video: 1, audio: 0 });
    const buckets = await app.inject({ method: 'GET', url: '/api/v2/media/buckets?types=video', headers: { cookie } });
    assert.equal(TimelineBuckets.parse(buckets.json()).total, 1);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('耗时只读聚合在线程中执行，API 事件循环仍能处理定时器', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-query-thread-'));
  const db = openDatabase(path.join(root, 'db.sqlite'));
  const { QueryExecutor } = await import('../src/core/query-executor.ts');
  const executor = new QueryExecutor(db);
  try {
    let finished = false;
    const query = executor.run([{ sql: 'WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<5000000) SELECT sum(n) AS total FROM seq', params: [] }]).then((result) => { finished = true; return result; });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assert.equal(finished, false);
    const rows = await query;
    assert.equal((rows[0]?.[0] as { total: number }).total, 12_500_002_500_000);
  } finally { await executor.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});
