import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

test('静态站点支持分享页 SPA 回退，API 未知路径不会回退', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-static-'));
  const db = openDatabase(':memory:');
  await mkdir(path.join(root, 'assets'));
  await mkdir(path.join(root, 'api', 'v2'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<html>夹具首页</html>');
  await writeFile(path.join(root, 'assets', 'app-01234567.js'), 'console.log(1)');
  await writeFile(path.join(root, 'api', 'v2', 'missing'), '不能作为 API 响应');
  const app = await createApp({ db, legacyPending: false, staticDir: root });
  try {
    const share = await app.inject({ method: 'GET', url: '/s/share-token' });
    assert.equal(share.statusCode, 200); assert.match(share.body, /夹具首页/);
    assert.match(String(share.headers['cache-control']), /no-cache|no-store/);
    const asset = await app.inject({ method: 'GET', url: '/assets/app-01234567.js' });
    assert.equal(asset.statusCode, 200); assert.match(String(asset.headers['cache-control']), /immutable/);
    assert.equal((await app.inject({ method: 'GET', url: '/api/v2/missing' })).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: '/s/share-token' })).statusCode, 404);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});
