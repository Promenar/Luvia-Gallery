import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { scanLibrary } from '../src/worker/scan.ts';

type Row = { id: string; relative_path: string; size: number; modified_at: number; cache_generation: number };

async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-delete-'));
  const db = openDatabase(':memory:');
  const { createApp } = await import('../src/api/app.ts');
  const app = await createApp({ db, legacyPending: false });
  const created = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
  const cookie = (created.headers['set-cookie'] as string).split(';')[0]!;
  const headers = { cookie, 'x-luvia-request': '1' };
  await writeFile(path.join(root, 'photo.jpg'), Buffer.from('a small file'));
  db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
  await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
  const row = db.prepare('SELECT id,relative_path,size,modified_at,cache_generation FROM files').get() as Row;
  return { root, db, app, headers, row };
}

const source = (row: Row) => ({ size: row.size, modifiedAt: row.modified_at, generation: row.cache_generation });
const body = (row: Row, operationId = 'delete-operation-1') => ({ confirm: true, source: source(row), operationId });

test('删除原文件需要管理员会话与 CSRF，并清理索引、缓存和失败记录', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    const url = `/api/v2/admin/media/${row.id}`;
    assert.equal((await app.inject({ method: 'DELETE', url, payload: body(row) })).statusCode, 401);
    assert.equal((await app.inject({ method: 'DELETE', url, headers: { cookie: headers.cookie }, payload: body(row) })).statusCode, 403);
    assert.equal((await app.inject({ method: 'DELETE', url, headers, payload: { ...body(row), confirm: false } })).statusCode, 400);

    db.prepare(`INSERT INTO cache_entries(cache_key,relative_path,bytes,last_access_at,media_id,variant) VALUES ('media:test','thumbs/test.webp',1,1,?,'thumb')`).run(row.id);
    db.prepare(`INSERT INTO media_failures(media_id,operation,source_size,source_modified,source_generation,failures,ignored,reason,last_failed_at,category)
      VALUES (?,?,?,?,?,3,1,'图片无法解码',unixepoch(),'decode')`).run(row.id, 'thumb:s', row.size, row.modified_at, row.cache_generation);

    const deleted = await app.inject({ method: 'DELETE', url, headers, payload: body(row) });
    assert.equal(deleted.statusCode, 200, deleted.body);
    assert.deepEqual(deleted.json(), { operationId: 'delete-operation-1', status: 'deleted' });
    await assert.rejects(stat(path.join(root, 'photo.jpg')));
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 0);
    assert.equal((db.prepare('SELECT count(*) AS n FROM media_failures').get() as { n: number }).n, 0);
    assert.equal((db.prepare('SELECT count(*) AS n FROM cache_entries').get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT count(*) AS n FROM cache_gc WHERE cache_key='media:test'").get() as { n: number }).n, 1);
    assert.equal((db.prepare("SELECT state FROM media_operations WHERE operation_id='delete-operation-1'").get() as { state: string }).state, 'deleted');

    // 同一 operationId 重试必须幂等；不能因为文件已不存在而报错。
    const retried = await app.inject({ method: 'DELETE', url, headers, payload: body(row) });
    assert.equal(retried.statusCode, 200);
    assert.equal(retried.json().status, 'deleted');
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('源版本变化时拒绝删除，原文件保持不变', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    const stale = { ...body(row), source: { ...source(row), size: row.size + 1 } };
    const res = await app.inject({ method: 'DELETE', url: `/api/v2/admin/media/${row.id}`, headers, payload: stale });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'MEDIA_CHANGED');
    assert.ok((await stat(path.join(root, 'photo.jpg'))).isFile());
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('只读目录返回 MEDIA_READ_ONLY，不改变索引', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    await chmod(root, 0o555);
    try {
      const res = await app.inject({ method: 'DELETE', url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, 'delete-read-only') });
      assert.equal(res.statusCode, 409, res.body);
      assert.equal(res.json().error.code, 'MEDIA_READ_ONLY');
      assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 1);
    } finally {
      await chmod(root, 0o755);
    }
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('符号链接目标被拒绝，链接指向的文件不受影响', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-delete-link-'));
  const db = openDatabase(':memory:');
  const { createApp } = await import('../src/api/app.ts');
  const app = await createApp({ db, legacyPending: false });
  const created = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
  const headers = { cookie: (created.headers['set-cookie'] as string).split(';')[0]!, 'x-luvia-request': '1' };
  try {
    await writeFile(path.join(root, 'target.bin'), Buffer.from('target content'));
    const target = await stat(path.join(root, 'target.bin'));
    await symlink('target.bin', path.join(root, 'link.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
    db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source)
      VALUES ('link-file','lib','link.jpg','lib','link.jpg','image/jpeg','image',?,?,?,'mtime')`)
      .run(target.size, Math.floor(target.mtimeMs / 1000), Math.floor(target.mtimeMs / 1000));
    const res = await app.inject({ method: 'DELETE', url: '/api/v2/admin/media/link-file', headers,
      payload: { confirm: true, source: { size: target.size, modifiedAt: Math.floor(target.mtimeMs / 1000), generation: 0 }, operationId: 'delete-link-1' } });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'MEDIA_CHANGED');
    assert.equal((await stat(path.join(root, 'target.bin'))).size, target.size);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('同一媒体已有活动删除操作时拒绝另一个 operationId', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    db.prepare(`INSERT INTO media_operations(operation_id,media_id,library_id,relative_path,source_size,source_modified,source_generation,state,created_at,updated_at)
      VALUES ('delete-active-1',?,'lib',?,?,?,?,'pending',unixepoch(),unixepoch())`)
      .run(row.id, row.relative_path, row.size, row.modified_at, row.cache_generation);
    const res = await app.inject({ method: 'DELETE', url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, 'delete-other-1') });
    assert.equal(res.statusCode, 409);
    assert.equal(res.json().error.code, 'OPERATION_CONFLICT');
    assert.ok((await stat(path.join(root, 'photo.jpg'))).isFile());
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});


test('磁盘文件在同一秒内被改写时拒绝删除', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    const file = path.join(root, 'photo.jpg');
    await writeFile(file, Buffer.alloc(row.size, 120));
    await utimes(file, row.modified_at + 0.5, row.modified_at + 0.5);
    const res = await app.inject({ method: 'DELETE', url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, 'delete-changed-disk') });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'MEDIA_CHANGED');
    assert.deepEqual(await readFile(file), Buffer.alloc(row.size, 120));
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('文件删除后数据库暂时故障，同一操作编号可以恢复索引', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    db.exec("CREATE TRIGGER fault_after_unlink BEFORE UPDATE OF state ON media_operations WHEN NEW.state='file_deleted' BEGIN SELECT RAISE(ABORT,'injected'); END");
    const request = { method: 'DELETE' as const, url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, 'delete-fault-recovery') };
    const first = await app.inject(request);
    assert.equal(first.json().error.code, 'OPERATION_PARTIAL', first.body);
    await assert.rejects(stat(path.join(root, 'photo.jpg')));
    db.exec('DROP TRIGGER fault_after_unlink');
    const retry = await app.inject(request);
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(db.prepare('SELECT 1 FROM files WHERE id=?').get(row.id), undefined);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});


test('索引文件头指纹不匹配时拒绝删除', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    const file = path.join(root, 'photo.jpg');
    const before = await stat(file);
    const original = await readFile(file);
    db.prepare('UPDATE files SET head_hash=? WHERE id=?').run(createHash('sha256').update(original).digest('hex'), row.id);
    await writeFile(file, Buffer.alloc(row.size, 120));
    await utimes(file, before.atime, before.mtime);
    const current = await stat(file);
    db.prepare('UPDATE files SET mtime_ms=? WHERE id=?').run(current.mtimeMs, row.id);
    const res = await app.inject({ method: 'DELETE', url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, 'delete-hash-changed') });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'MEDIA_CHANGED');
    assert.deepEqual(await readFile(file), Buffer.alloc(row.size, 120));
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('删除后的索引已被其他操作更新时保留新记录', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    db.exec("CREATE TRIGGER change_during_delete AFTER UPDATE OF state ON media_operations WHEN NEW.state='file_deleted' BEGIN UPDATE files SET cache_generation=cache_generation+1 WHERE id=NEW.media_id; END");
    const res = await app.inject({ method: 'DELETE', url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, 'delete-changed-index') });
    assert.equal(res.json().error.code, 'OPERATION_PARTIAL', res.body);
    assert.ok(db.prepare('SELECT 1 FROM files WHERE id=?').get(row.id));
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});


test('索引缺少精确修改时间时拒绝直接删除', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    db.prepare('UPDATE files SET mtime_ms=NULL WHERE id=?').run(row.id);
    const res = await app.inject({ method: 'DELETE', url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, 'delete-missing-identity') });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'MEDIA_CHANGED');
    assert.ok((await stat(path.join(root, 'photo.jpg'))).isFile());
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('索引缺少文件身份时拒绝删除', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    db.prepare('UPDATE files SET dev=NULL,ino=NULL WHERE id=?').run(row.id);
    const res = await app.inject({ method: 'DELETE', url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, 'delete-missing-file-id') });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'MEDIA_CHANGED');
    assert.ok((await stat(path.join(root, 'photo.jpg'))).isFile());
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('校验后原路径被替换时不得删除替换后的文件', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    const file = path.join(root, 'photo.jpg');
    db.function('replace_before_delete', () => {
      renameSync(file, path.join(root, 'original.jpg'));
      writeFileSync(file, 'replacement');
      return 1;
    });
    db.exec("CREATE TRIGGER replace_before_delete AFTER INSERT ON media_operations BEGIN SELECT replace_before_delete(); END");
    const res = await app.inject({ method: 'DELETE', url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, 'delete-replaced') });
    assert.equal(res.statusCode, 409, res.body);
    assert.equal(res.json().error.code, 'MEDIA_CHANGED');
    assert.equal(await readFile(file, 'utf8'), 'replacement');
    assert.equal(await readFile(path.join(root, 'original.jpg'), 'utf8'), 'a small file');
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('移动待删文件后中断，同一操作可恢复并完成删除', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    const operationId = 'delete-staged-recovery';
    const stage = path.join(root, `.luvia-delete-${createHash('sha256').update(operationId).digest('hex')}`);
    db.prepare(`INSERT INTO media_operations(operation_id,media_id,library_id,relative_path,source_size,source_modified,source_generation,state,created_at,updated_at)
      VALUES (?,?,'lib',?,?,?,?,'pending',unixepoch(),unixepoch())`)
      .run(operationId, row.id, row.relative_path, row.size, row.modified_at, row.cache_generation);
    await mkdir(stage, { mode: 0o700 });
    await rename(path.join(root, 'photo.jpg'), path.join(stage, 'source'));
    const res = await app.inject({ method: 'DELETE', url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, operationId) });
    assert.equal(res.statusCode, 200, res.body);
    await assert.rejects(stat(path.join(root, 'photo.jpg')));
    await assert.rejects(stat(stage));
    assert.equal(db.prepare('SELECT 1 FROM files WHERE id=?').get(row.id), undefined);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('待处理状态下原路径和暂存文件均缺失时保留索引', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    const operationId = 'delete-ambiguous-missing';
    db.prepare(`INSERT INTO media_operations(operation_id,media_id,library_id,relative_path,source_size,source_modified,source_generation,state,created_at,updated_at)
      VALUES (?,?,'lib',?,?,?,?,'pending',unixepoch(),unixepoch())`)
      .run(operationId, row.id, row.relative_path, row.size, row.modified_at, row.cache_generation);
    await rename(path.join(root, 'photo.jpg'), path.join(root, 'moved.jpg'));
    const res = await app.inject({ method: 'DELETE', url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, operationId) });
    assert.equal(res.json().error.code, 'OPERATION_PARTIAL', res.body);
    assert.ok(db.prepare('SELECT 1 FROM files WHERE id=?').get(row.id));
    assert.equal(await readFile(path.join(root, 'moved.jpg'), 'utf8'), 'a small file');
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('已提交待删阶段但文件仍在暂存区时先删除文件再清理索引', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    const operationId = 'delete-staged-committed';
    const stage = path.join(root, `.luvia-delete-${createHash('sha256').update(operationId).digest('hex')}`);
    db.prepare(`INSERT INTO media_operations(operation_id,media_id,library_id,relative_path,source_size,source_modified,source_generation,state,created_at,updated_at)
      VALUES (?,?,'lib',?,?,?,?,'file_deleted',unixepoch(),unixepoch())`)
      .run(operationId, row.id, row.relative_path, row.size, row.modified_at, row.cache_generation);
    await mkdir(stage, { mode: 0o700 });
    await rename(path.join(root, 'photo.jpg'), path.join(stage, 'source'));
    const identity = await stat(path.join(stage, 'source'), { bigint: true });
    db.prepare("UPDATE media_operations SET stage_state='prepared',stage_dev=?,stage_ino=?,stage_mtime_ns=? WHERE operation_id=?")
      .run(identity.dev.toString(), identity.ino.toString(), identity.mtimeNs.toString(), operationId);
    const res = await app.inject({ method: 'DELETE', url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, operationId) });
    assert.equal(res.statusCode, 200, res.body);
    await assert.rejects(stat(stage));
    assert.equal(db.prepare('SELECT 1 FROM files WHERE id=?').get(row.id), undefined);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('待删暂存区不可见或文件被替换时不清理索引或删除替换文件', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    const operationId = 'delete-stage-identity';
    const stage = path.join(root, `.luvia-delete-${createHash('sha256').update(operationId).digest('hex')}`);
    const identity = await stat(path.join(root, 'photo.jpg'), { bigint: true });
    db.prepare(`INSERT INTO media_operations(operation_id,media_id,library_id,relative_path,source_size,source_modified,source_generation,state,stage_state,stage_dev,stage_ino,stage_mtime_ns,created_at,updated_at)
      VALUES (?,?,'lib',?,?,?,?,'file_deleted','prepared',?,?,?,unixepoch(),unixepoch())`)
      .run(operationId, row.id, row.relative_path, row.size, row.modified_at, row.cache_generation, identity.dev.toString(), identity.ino.toString(), identity.mtimeNs.toString());
    const request = { method: 'DELETE' as const, url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, operationId) };
    const missing = await app.inject(request);
    assert.equal(missing.json().error.code, 'OPERATION_PARTIAL', missing.body);
    await mkdir(stage, { mode: 0o700 });
    await writeFile(path.join(stage, 'source'), Buffer.alloc(row.size, 120));
    const replaced = await app.inject(request);
    assert.equal(replaced.json().error.code, 'OPERATION_PARTIAL', replaced.body);
    assert.deepEqual(await readFile(path.join(stage, 'source')), Buffer.alloc(row.size, 120));
    assert.ok(db.prepare('SELECT 1 FROM files WHERE id=?').get(row.id));
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('实际删除后数据库提交失败时保留索引并报告待人工核验', async () => {
  const { root, db, app, headers, row } = await setup();
  try {
    db.exec("CREATE TRIGGER fail_unlinked BEFORE UPDATE OF stage_state ON media_operations WHEN NEW.stage_state='unlinked' BEGIN SELECT RAISE(ABORT,'injected'); END");
    const request = { method: 'DELETE' as const, url: `/api/v2/admin/media/${row.id}`, headers, payload: body(row, 'delete-after-unlink-fault') };
    const first = await app.inject(request);
    assert.equal(first.json().error.code, 'OPERATION_PARTIAL', first.body);
    db.exec('DROP TRIGGER fail_unlinked');
    const retry = await app.inject(request);
    assert.equal(retry.json().error.code, 'OPERATION_PARTIAL', retry.body);
    assert.ok(db.prepare('SELECT 1 FROM files WHERE id=?').get(row.id));
    await assert.rejects(stat(path.join(root, 'photo.jpg')));
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});
