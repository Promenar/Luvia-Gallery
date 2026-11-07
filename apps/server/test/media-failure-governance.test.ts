import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { enqueueMediaTask } from '../src/core/media-cache.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { runNextJob } from '../src/worker/runner.ts';
import { classifyMediaFailure } from '../src/core/media-failures.ts';

test('媒体错误分类只返回可识别的原因及安全错误码', () => {
  assert.deepEqual(classifyMediaFailure({ code: 'ENOENT' }), { category: 'missing', errorCode: 'ENOENT' });
  assert.deepEqual(classifyMediaFailure({ code: 'EACCES' }), { category: 'permission', errorCode: 'EACCES' });
  assert.deepEqual(classifyMediaFailure({ code: 'ENOSPC' }), { category: 'storage', errorCode: 'ENOSPC' });
  assert.deepEqual(classifyMediaFailure(new Error('解码失败'), true), { category: 'decode' });
  assert.deepEqual(classifyMediaFailure({ code: '/private/path' }), { category: 'unknown' });
});

test('同一文件缩略图连续三次失败后不再自动入队，源文件改变后可重新处理', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-fail-source-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-fail-cache-'));
  const db = openDatabase(':memory:');
  try {
    await writeFile(path.join(root, 'broken.jpg'), 'this is not a JPEG image');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    assert.ok(row);
    for (let i = 0; i < 3; i++) {
      const id = enqueueMediaTask(db, row, { kind: 'thumb', size: 's' });
      await runNextJob(db, { owner: `worker-${i}`, cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
      assert.equal((db.prepare('SELECT status FROM jobs WHERE id=?').get(id) as { status: string }).status, 'failed');
    }
    const record = db.prepare("SELECT failures,ignored FROM media_failures WHERE media_id=? AND operation='thumb:s'").get(row.id);
    assert.deepEqual(record, { failures: 3, ignored: 1 });
    assert.throws(() => enqueueMediaTask(db, row, { kind: 'thumb', size: 's' }), { code: 'MEDIA_IGNORED' });
    assert.equal((db.prepare('SELECT count(*) AS n FROM jobs').get() as { n: number }).n, 3);
    assert.doesNotThrow(() => enqueueMediaTask(db, { ...row, modified_at: row.modified_at + 1 }, { kind: 'thumb', size: 's' }));
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('管理员可以查看和解除忽略，普通访客不可访问', async () => {
  const { createApp } = await import('../src/api/app.ts');
  const { recordMediaFailure } = await import('../src/core/media-failures.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-fail-admin-'));
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    await writeFile(path.join(root, 'broken.jpg'), 'bad image');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    for (let i = 0; i < 3; i++) recordMediaFailure(db, row, { kind: 'thumb', size: 's' }, '图片无法解码');
    const url = '/api/v2/admin/media-failures';
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401);
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const list = await app.inject({ method: 'GET', url, headers: { cookie } });
    assert.equal(list.statusCode, 200);
    const item = list.json().items[0];
    assert.equal(item.mediaId, row.id); assert.equal(item.operation, 'thumb:s'); assert.equal(item.failures, 3); assert.equal(item.ignored, true);
    assert.equal(item.category, 'unknown');
    assert.deepEqual(list.json().counts, { ignored: 1, unignored: 0 });
    assert.equal(list.json().total, 1);
    const blocked = await app.inject({ method: 'GET', url: `/api/v2/media/${row.id}/thumb?size=s`, headers: { cookie } });
    assert.equal(blocked.statusCode, 409); assert.equal(blocked.json().error.code, 'MEDIA_IGNORED');
    const endpoint = `${url}/${item.id}/unignore`;
    const version = { size: row.size, modifiedAt: row.modified_at, generation: row.cache_generation };
    assert.equal((await app.inject({ method: 'POST', url: endpoint, headers: { cookie }, payload: version })).statusCode, 403);
    const headers = { cookie, 'x-luvia-request': '1' };
    const stale = await app.inject({ method: 'POST', url: endpoint, headers, payload: { ...version, size: row.size + 1 } });
    assert.equal(stale.statusCode, 409); assert.equal(stale.json().error.code, 'MEDIA_CHANGED');
    const retry = await app.inject({ method: 'POST', url: `${url}/${item.id}/retry`, headers, payload: version });
    assert.equal(retry.statusCode, 200);
    assert.equal((db.prepare('SELECT status FROM jobs WHERE id=?').get(retry.json().jobId) as { status: string }).status, 'queued');
    assert.equal((db.prepare('SELECT count(*) AS n FROM media_failures').get() as { n: number }).n, 0);
    assert.equal(enqueueMediaTask(db, row, { kind: 'thumb', size: 's' }), retry.json().jobId);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('批量缩略图任务也遵守逐尺寸的连续失败上限', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-fail-bulk-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-fail-cache-'));
  const db = openDatabase(':memory:');
  try {
    await writeFile(path.join(root, 'broken.jpg'), 'invalid JPEG content');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare('UPDATE files SET width=10,height=10').run();
    for (let i = 0; i < 4; i++) {
      db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES (?,'thumbnails','生成缩略图','queued','manual',?,?)").run(`bulk-${i}`, JSON.stringify({ libraryId: 'lib' }), i);
      await runNextJob(db, { owner: `bulk-worker-${i}`, cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
    }
    assert.deepEqual(db.prepare("SELECT operation,failures,ignored FROM media_failures ORDER BY operation").all(), [
      { operation: 'thumb:m', failures: 3, ignored: 1 }, { operation: 'thumb:s', failures: 3, ignored: 1 },
    ]);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('拍摄信息连续失败三次后不会被定向恢复重复安排', async () => {
  const { createApp } = await import('../src/api/app.ts');
  const { extractMetadataNow } = await import('../src/worker/metadata.ts');
  const { recoverMissingMedia } = await import('../src/worker/media-recovery.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-fail-metadata-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-fail-cache-'));
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    await writeFile(path.join(root, 'broken.jpg'), 'invalid JPEG content');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    for (let i = 0; i < 3; i++) {
      db.prepare("UPDATE files SET metadata_status='pending' WHERE id=?").run(row.id);
      await extractMetadataNow(db, row.id);
    }
    assert.deepEqual(db.prepare("SELECT failures,ignored FROM media_failures WHERE media_id=? AND operation='metadata'").get(row.id), { failures: 3, ignored: 1 });
    const result = await recoverMissingMedia(db, cache, { apply: true });
    assert.equal(result.metadataReset, 0);
    assert.equal((db.prepare('SELECT metadata_status FROM files WHERE id=?').get(row.id) as { metadata_status: string }).metadata_status, 'failed');
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const id = (db.prepare("SELECT id FROM media_failures WHERE media_id=? AND operation='metadata'").get(row.id) as { id: number }).id;
    const retry = await app.inject({ method: 'POST', url: `/api/v2/admin/media-failures/${id}/retry`, headers: { cookie, 'x-luvia-request': '1' }, payload: { size: row.size, modifiedAt: row.modified_at, generation: row.cache_generation } });
    assert.equal(retry.statusCode, 200);
    assert.equal((db.prepare('SELECT metadata_status FROM files WHERE id=?').get(row.id) as { metadata_status: string }).metadata_status, 'pending');
    assert.equal((db.prepare('SELECT type FROM jobs WHERE id=?').get(retry.json().jobId) as { type: string }).type, 'metadata');
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('作业排队后达到忽略上限时，领取者不再处理该文件', async () => {
  const { recordMediaFailure } = await import('../src/core/media-failures.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-fail-queued-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-fail-cache-'));
  const db = openDatabase(':memory:');
  try {
    await writeFile(path.join(root, 'broken.jpg'), 'invalid JPEG content');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const variant = { kind: 'thumb', size: 's' } as const;
    const id = enqueueMediaTask(db, row, variant);
    for (let i = 0; i < 3; i++) recordMediaFailure(db, row, variant, '图片无法解码');
    await runNextJob(db, { owner: 'worker', cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
    assert.equal((db.prepare('SELECT status FROM jobs WHERE id=?').get(id) as { status: string }).status, 'cancelled');
    assert.equal((db.prepare('SELECT failures FROM media_failures WHERE media_id=?').get(row.id) as { failures: number }).failures, 3);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});
