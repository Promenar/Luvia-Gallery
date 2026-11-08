import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { cacheKey, cachePath, enqueueMediaTask } from '../src/core/media-cache.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { runNextJob } from '../src/worker/runner.ts';
import { classifyMediaFailure } from '../src/core/media-failures.ts';
import sharp from 'sharp';

test('媒体错误分类只返回可识别的原因及安全错误码', () => {
  assert.deepEqual(classifyMediaFailure({ code: 'ENOENT' }), { category: 'missing', errorCode: 'ENOENT' });
  assert.deepEqual(classifyMediaFailure({ code: 'EACCES' }), { category: 'permission', errorCode: 'EACCES' });
  assert.deepEqual(classifyMediaFailure({ code: 'ENOSPC' }), { category: 'storage', errorCode: 'ENOSPC' });
  assert.deepEqual(classifyMediaFailure(new Error('解码失败'), true), { category: 'decode' });
  assert.deepEqual(classifyMediaFailure({ code: '/private/path' }), { category: 'unknown' });
});

test('损坏的 PNG 可以宽松生成缩略图时保留质量提示', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-partial-source-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-partial-cache-'));
  const db = openDatabase(':memory:');
  try {
    const raw = Buffer.alloc(256 * 256 * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 73 + (i >> 7)) % 256;
    const png = await sharp(raw, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer();
    await writeFile(path.join(root, 'partial.png'), png.subarray(0, Math.floor(png.length * .99)));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    const job = enqueueMediaTask(db, row, { kind: 'thumb', size: 's' }, { preserveUnindexed: true });
    await runNextJob(db, { owner: 'partial-worker', cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
    assert.equal((db.prepare('SELECT status FROM jobs WHERE id=?').get(job) as { status: string }).status, 'succeeded');
    assert.equal((db.prepare('SELECT thumb_ready FROM files WHERE id=?').get(row.id) as { thumb_ready: number }).thumb_ready, 1);
    const warning = db.prepare("SELECT category,error_code,reason FROM media_failures WHERE media_id=? AND operation='thumb:s'").get(row.id) as { category: string; error_code: string; reason: string };
    assert.equal(warning.category, 'decode'); assert.equal(warning.error_code, 'PARTIAL_DECODE');
    assert.match(warning.reason, /不完整/);
    db.prepare("UPDATE media_failures SET ignored=1 WHERE media_id=?").run(row.id);
    const variant = { kind: 'thumb', size: 's' } as const;
    for (let i = 0; i < 3; i++) {
      await unlink(cachePath(cache, row, variant));
      db.prepare('DELETE FROM cache_entries WHERE cache_key=?').run(cacheKey(row, variant));
      const again = enqueueMediaTask(db, row, variant);
      await runNextJob(db, { owner: 'partial-worker', cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
      assert.equal((db.prepare('SELECT status FROM jobs WHERE id=?').get(again) as { status: string }).status, 'succeeded');
    }
    assert.deepEqual(db.prepare('SELECT failures,ignored,error_code FROM media_failures WHERE media_id=?').get(row.id), { failures: 0, ignored: 1, error_code: 'PARTIAL_DECODE' });
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('元数据排队后手动忽略不会继续读取，解除忽略后仍可手动重试', async () => {
  const { createApp } = await import('../src/api/app.ts');
  const { recordMediaFailure } = await import('../src/core/media-failures.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-metadata-ignore-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-metadata-ignore-cache-'));
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#abc' } }).jpeg().toFile(path.join(root, 'image.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    recordMediaFailure(db, row, { kind: 'metadata' }, '拍摄信息读取失败');
    db.prepare("UPDATE files SET metadata_status='pending' WHERE id=?").run(row.id);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('recover','metadata','测试','queued','manual',?,1)").run(JSON.stringify({ libraryId: 'lib', recovery: true, recoveryIds: [row.id] }));
    const id = (db.prepare('SELECT id FROM media_failures').get() as { id: number }).id;
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const headers = { cookie: (setup.headers['set-cookie'] as string).split(';')[0]!, 'x-luvia-request': '1' };
    const source = { size: row.size, modifiedAt: row.modified_at, generation: row.cache_generation };
    const base = `/api/v2/admin/media-failures/${id}`;
    const inFlight = (await import('../src/worker/metadata.ts')).extractMetadataNow(db, row.id);
    assert.equal((await app.inject({ method: 'POST', url: `${base}/ignore`, headers, payload: source })).statusCode, 200);
    assert.equal(await inFlight, false);
    assert.equal((db.prepare('SELECT metadata_generation FROM files WHERE id=?').get(row.id) as { metadata_generation: number }).metadata_generation, 1);
    await runNextJob(db, { owner: 'metadata-ignore', cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
    assert.deepEqual(db.prepare('SELECT metadata_status FROM files WHERE id=?').get(row.id), { metadata_status: 'failed' });
    assert.equal((db.prepare('SELECT ignored FROM media_failures WHERE id=?').get(id) as { ignored: number }).ignored, 1);
    assert.equal((await app.inject({ method: 'POST', url: `${base}/unignore`, headers, payload: source })).statusCode, 200);
    assert.deepEqual(db.prepare('SELECT ignored,failures FROM media_failures WHERE id=?').get(id), { ignored: 0, failures: 0 });
    const retry = await app.inject({ method: 'POST', url: `${base}/retry`, headers, payload: source });
    assert.equal(retry.statusCode, 200);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('处理完成不会清除处理期间被管理员忽略的记录', async () => {
  const { recordMediaFailure, clearMediaFailure } = await import('../src/core/media-failures.ts');
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试','/test')").run();
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES ('x','lib','x.jpg','lib','x.jpg','image/jpeg','image',10,10,10,'mtime')").run();
    const source = { id: 'x', size: 10, modified_at: 10, cache_generation: 0 };
    const variant = { kind: 'thumb', size: 's' } as const;
    recordMediaFailure(db, source, variant, '图片无法解码');
    db.prepare('UPDATE media_failures SET ignored=1').run();
    clearMediaFailure(db, source, variant);
    assert.deepEqual(db.prepare('SELECT ignored FROM media_failures').get(), { ignored: 1 });
  } finally { db.close(); }
});

test('忽略后重试不会接收先前已在途的拍摄信息读取结果', async () => {
  const { extractMetadataNow } = await import('../src/worker/metadata.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-metadata-generation-'));
  const db = openDatabase(':memory:');
  try {
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#abc' } }).jpeg().toFile(path.join(root, 'image.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id FROM files').get() as { id: string };
    let changed = false;
    const delayed = new Proxy(db, { get(target, key) {
      if (key === 'transaction') return (fn: () => unknown) => target.transaction(() => {
        if (!changed) {
          changed = true;
          target.prepare("UPDATE files SET metadata_generation=metadata_generation+1,metadata_status='failed' WHERE id=?").run(row.id);
          target.prepare("UPDATE files SET metadata_status='pending' WHERE id=?").run(row.id);
        }
        return fn();
      });
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    assert.equal(await extractMetadataNow(delayed, row.id), false);
    assert.equal(changed, true);
    assert.deepEqual(db.prepare('SELECT metadata_status FROM files WHERE id=?').get(row.id), { metadata_status: 'pending' });
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('严格和宽松解码均失败时说明图片无法解码', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-broken-jpeg-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-broken-cache-'));
  const db = openDatabase(':memory:');
  try {
    const jpg = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#abc' } }).jpeg().toBuffer();
    await writeFile(path.join(root, 'broken.jpg'), jpg.subarray(0, 80));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    enqueueMediaTask(db, row, { kind: 'thumb', size: 's' });
    await runNextJob(db, { owner: 'broken-worker', cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
    const failure = db.prepare("SELECT category,reason FROM media_failures WHERE media_id=? AND operation='thumb:s'").get(row.id) as { category: string; reason: string };
    assert.equal(failure.category, 'decode'); assert.match(failure.reason, /图片无法解码/);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('管理员可手动忽略失败记录且需匹配源版本', async () => {
  const { createApp } = await import('../src/api/app.ts');
  const { recordMediaFailure } = await import('../src/core/media-failures.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-manual-ignore-'));
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    await writeFile(path.join(root, 'broken.jpg'), 'bad image');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    recordMediaFailure(db, row, { kind: 'thumb', size: 's' }, '图片无法解码');
    const id = (db.prepare('SELECT id FROM media_failures').get() as { id: number }).id;
    const url = `/api/v2/admin/media-failures/${id}/ignore`;
    const source = { size: row.size, modifiedAt: row.modified_at, generation: row.cache_generation };
    assert.equal((await app.inject({ method: 'POST', url, payload: source })).statusCode, 401);
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const headers = { cookie, 'x-luvia-request': '1' };
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: { ...source, size: source.size + 1 } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url, headers, payload: source })).statusCode, 200);
    assert.deepEqual(db.prepare('SELECT failures,ignored FROM media_failures').get(), { failures: 1, ignored: 1 });
    assert.throws(() => enqueueMediaTask(db, row, { kind: 'thumb', size: 's' }), { code: 'MEDIA_IGNORED' });
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('不完整缩略图的提示解除忽略后仍然保留，不能伪装成重试成功', async () => {
  const { createApp } = await import('../src/api/app.ts');
  const { recordMediaFailure } = await import('../src/core/media-failures.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-partial-ignore-'));
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    await writeFile(path.join(root, 'partial.jpg'), 'partial');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
    recordMediaFailure(db, row, { kind: 'thumb', size: 's' }, '已尽力生成，画面可能不完整', { category: 'decode', errorCode: 'PARTIAL_DECODE' });
    const id = (db.prepare('SELECT id FROM media_failures').get() as { id: number }).id;
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const headers = { cookie: (setup.headers['set-cookie'] as string).split(';')[0]!, 'x-luvia-request': '1' };
    const source = { size: row.size, modifiedAt: row.modified_at, generation: row.cache_generation };
    const base = `/api/v2/admin/media-failures/${id}`;
    assert.equal((await app.inject({ method: 'POST', url: `${base}/ignore`, headers, payload: source })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: `${base}/unignore`, headers, payload: source })).statusCode, 200);
    assert.deepEqual(db.prepare('SELECT ignored,error_code FROM media_failures').get(), { ignored: 0, error_code: 'PARTIAL_DECODE' });
    assert.equal((await app.inject({ method: 'POST', url: `${base}/retry`, headers, payload: source })).statusCode, 409);
    assert.equal((db.prepare('SELECT count(*) AS n FROM jobs').get() as { n: number }).n, 0);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
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

test('等待缩略图槽位时被忽略的文件不会继续生成', async () => {
  const { recordMediaFailure } = await import('../src/core/media-failures.ts');
  const { writeSettings } = await import('../src/core/settings.ts');
  const { access } = await import('node:fs/promises');
  for (const mode of ['single', 'bulk'] as const) {
    const root = await mkdtemp(path.join(tmpdir(), 'luvia-ignore-slot-'));
    const cache = await mkdtemp(path.join(tmpdir(), 'luvia-ignore-slot-cache-'));
    const db = openDatabase(':memory:');
    try {
      await sharp({ create: { width: 32, height: 32, channels: 3, background: '#abc' } }).jpeg().toFile(path.join(root, 'image.jpg'));
      db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
      await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
      writeSettings(db, { workers: { thumbnailConcurrency: 1 } });
      const source = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as { id: string; size: number; modified_at: number; cache_generation: number };
      const variant = { kind: 'thumb', size: 's' } as const;
      if (mode === 'single') enqueueMediaTask(db, source, variant);
      else db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('bulk','thumbnails','生成缩略图','queued','manual','{}',1)").run();
      recordMediaFailure(db, source, variant, '测试');
      db.prepare("INSERT INTO ffmpeg_slots(id,owner,lease_expires_at,kind) VALUES ('occupied','other',unixepoch()+30,'thumbnail')").run();
      const work = runNextJob(db, { owner: 'worker', cacheDir: cache, allowedRoots: [root], legacyDir: root, systemRoots: [] });
      const locked = db.prepare('SELECT 1 FROM media_generation_locks WHERE cache_key=?');
      for (let i = 0; i < 100 && !locked.get(`media:${cacheKey(source, variant)}`); i++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok(locked.get(`media:${cacheKey(source, variant)}`));
      db.prepare('UPDATE media_failures SET ignored=1 WHERE media_id=?').run(source.id);
      db.prepare("DELETE FROM ffmpeg_slots WHERE id='occupied'").run();
      await work;
      await assert.rejects(access(cachePath(cache, source, variant)));
      assert.equal((db.prepare('SELECT ignored FROM media_failures WHERE media_id=?').get(source.id) as { ignored: number }).ignored, 1);
    } finally { db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
  }
});
