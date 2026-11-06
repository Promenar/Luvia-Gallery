import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFile, copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/core/database.ts';
import { runNextJob } from '../src/worker/runner.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { flushMetadataFolders } from '../src/worker/metadata.ts';
import { LibraryChangedEvent } from '@luvia/contracts';
import { flushLibraryEvents } from '../src/worker/watch-events.ts';

const fixtureScript = fileURLToPath(new URL('../scripts/fixtures.ts', import.meta.url));
test('扫描后后台提取 EXIF、文件名日期和音视频元数据，损坏文件不阻断其他文件', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-metadata-'));
  const db = openDatabase(':memory:');
  try {
    await promisify(execFile)(process.execPath, [fixtureScript, '--output', root]);
    await copyFile(path.join(root, 'photos', 'landscape.jpg'), path.join(root, 'photos', 'IMG_20230908_121314.jpg'));
    await writeFile(path.join(root, 'photos', 'broken.jpg'), 'broken fixture');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('scan','scan','扫描','queued','manual',?,1)").run(JSON.stringify({ libraryId: 'lib' }));
    const options = { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [] };
    await runNextJob(db, options);
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='metadata' AND status='queued'").get() as { n: number }).n, 1);
    db.prepare("UPDATE files SET thumb_ready=1 WHERE name IN ('exif-gps.jpg','landscape.jpg')").run();
    const originalCover = db.prepare("SELECT id FROM files WHERE name='exif-gps.jpg'").get() as { id: string };
    db.prepare("UPDATE folders SET cover_file_id=? WHERE path IN ('lib','lib/photos','lib/photos/nested')").run(originalCover.id);
    await runNextJob(db, options);
    flushLibraryEvents(db, Date.now() + 2000);
    const row = (name: string) => db.prepare('SELECT * FROM files WHERE name=?').get(name) as Record<string, any>;
    const photo = row('exif-gps.jpg');
    assert.equal(photo.metadata_status, 'done'); assert.equal(photo.taken_at_source, 'metadata');
    assert.equal(photo.taken_at, Date.parse('2024-05-06T10:11:12+08:00') / 1000);
    assert.equal(photo.width, 960); assert.equal(photo.height, 640); assert.equal(photo.model, 'Fixture Camera');
    assert.equal((db.prepare("SELECT latest_at FROM folders WHERE path='lib/photos/nested'").get() as { latest_at: number }).latest_at, photo.taken_at);
    assert.equal((db.prepare("SELECT cover_file_id FROM folders WHERE path='lib/photos'").get() as { cover_file_id: string }).cover_file_id, row('landscape.jpg').id);
    const changes = db.prepare("SELECT payload FROM job_events WHERE event_type='library'").all() as { payload: string }[];
    assert.ok(changes.some(({ payload }) => JSON.parse(payload).updated > 0));
    assert.equal(photo.latitude, 30.5); assert.equal(photo.longitude, 120);
    assert.equal(row('IMG_20230908_121314.jpg').taken_at_source, 'filename');
    assert.equal(row('portrait.jpg').taken_at_source, 'mtime');
    assert.equal(row('direct.mp4').codec, 'h264'); assert.equal(row('direct.mp4').playability, 'direct');
    assert.equal(row('transcode.mkv').codec, 'ffv1'); assert.equal(row('transcode.mkv').playability, 'transcode');
    assert.ok(row('sample.m4a').duration_sec > 0); assert.equal(row('sample.m4a').audio_codec, 'aac');
    assert.equal(row('broken.jpg').metadata_status, 'failed');
    const job = db.prepare("SELECT status,result FROM jobs WHERE type='metadata'").get() as { status: string; result: string };
    assert.equal(job.status, 'succeeded'); assert.deepEqual(JSON.parse(job.result), { indexed: 7, failed: 1 });
    await appendFile(path.join(root, 'photos', 'nested', 'exif-gps.jpg'), Buffer.from([0]));
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const changed = row('exif-gps.jpg');
    assert.equal(changed.metadata_status, 'pending');
    assert.equal(changed.model, null); assert.equal(changed.latitude, null); assert.equal(changed.width, null);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('元数据作业分批保存断点，不抢占有效文件租约并接管过期租约', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-metadata-resume-'));
  const db = openDatabase(':memory:');
  try {
    const image = await (await import('sharp')).default({ create: { width: 10, height: 8, channels: 3, background: '#999' } }).jpeg().toBuffer();
    for (let index = 0; index < 33; index++) await writeFile(path.join(root, `${String(index).padStart(2, '0')}.jpg`), image);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('scan','scan','扫描','queued','manual',?,1)").run(JSON.stringify({ libraryId: 'lib' }));
    const options = { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [] };
    await runNextJob(db, options);
    const protectedFile = db.prepare('SELECT id FROM files ORDER BY id LIMIT 1').get() as { id: string };
    const expiry = Math.floor(Date.now() / 1000) + 30;
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at,owner,lease_expires_at) VALUES ('other','metadata','其他','running','manual',1,'worker-b',?)").run(expiry);
    db.prepare("INSERT INTO metadata_claims(file_id,job_id,owner,lease_expires_at) VALUES (?,'other','worker-b',?)").run(protectedFile.id, expiry);
    await runNextJob(db, options);
    const pending = db.prepare("SELECT status,checkpoint FROM jobs WHERE type='metadata' AND id<>'other'").get() as { status: string; checkpoint: string };
    assert.equal(pending.status, 'queued'); assert.deepEqual(JSON.parse(pending.checkpoint), { indexed: 32, failed: 0 });
    assert.equal((db.prepare('SELECT metadata_status FROM files WHERE id=?').get(protectedFile.id) as { metadata_status: string }).metadata_status, 'pending');
    assert.equal((db.prepare('SELECT owner FROM metadata_claims WHERE file_id=?').get(protectedFile.id) as { owner: string }).owner, 'worker-b');
    db.prepare('UPDATE metadata_claims SET lease_expires_at=0 WHERE file_id=?').run(protectedFile.id);
    await runNextJob(db, options);
    const complete = db.prepare("SELECT status,result FROM jobs WHERE type='metadata' AND id<>'other'").get() as { status: string; result: string };
    assert.equal(complete.status, 'succeeded'); assert.deepEqual(JSON.parse(complete.result), { indexed: 33, failed: 0 });
    assert.equal((db.prepare('SELECT metadata_status FROM files WHERE id=?').get(protectedFile.id) as { metadata_status: string }).metadata_status, 'done');
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('目录统计更新可恢复，并等待有效扫描租约结束', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/synthetic')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name,latest_at) VALUES ('lib','lib',NULL,'根',1),('lib/child','lib','lib','子目录',1)").run();
    db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,thumb_ready) VALUES ('photo','lib','child/a.jpg','lib/child','a.jpg','image/jpeg','image',1,1,123,'metadata',1)").run();
    db.prepare("INSERT INTO metadata_dirty_folders(path,updated) VALUES ('lib/child',1)").run();
    db.prepare("INSERT INTO scan_locks(library_id,owner,acquired_at,lease_expires_at) VALUES ('lib','scanner',unixepoch(),unixepoch()+30)").run();
    assert.equal(flushMetadataFolders(db), true);
    assert.equal((db.prepare("SELECT latest_at FROM folders WHERE path='lib/child'").get() as { latest_at: number }).latest_at, 1);
    db.prepare("UPDATE scan_locks SET lease_expires_at=0 WHERE library_id='lib'").run();
    assert.equal(flushMetadataFolders(db), false);
    const rows = db.prepare('SELECT path,latest_at,cover_file_id FROM folders ORDER BY path').all();
    assert.deepEqual(rows, [{ path: 'lib', latest_at: 123, cover_file_id: 'photo' }, { path: 'lib/child', latest_at: 123, cover_file_id: 'photo' }]);
    const events = db.prepare("SELECT payload FROM job_events WHERE event_type='library'").all() as { payload: string }[];
    assert.deepEqual(JSON.parse(events[0]!.payload), { libraryId: 'lib', source: 'scan', folders: ['lib/child'], added: 0, removed: 0, updated: 1, moved: 0 });
    assert.equal(flushMetadataFolders(db), false);
    assert.equal((db.prepare("SELECT count(*) AS n FROM job_events WHERE event_type='library'").get() as { n: number }).n, 1);
  } finally { db.close(); }
});

test('元数据目录刷新发布符合契约的持久节流事件', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/synthetic')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'根')").run();
    db.prepare("INSERT INTO metadata_dirty_folders(path,updated) VALUES ('lib',2)").run();
    flushMetadataFolders(db);
    const row = db.prepare("SELECT payload FROM job_events WHERE event_type='library'").get() as { payload: string };
    assert.deepEqual(LibraryChangedEvent.parse(JSON.parse(row.payload)), { libraryId: 'lib', source: 'scan', folders: ['lib'], added: 0, removed: 0, updated: 2, moved: 0 });
  } finally { db.close(); }
});

test('元数据认领沿 metadata_status 索引按 id 顺序取下一项，不扫描整库再排序', async () => {
  const { metadataClaimSql } = await import('../src/worker/metadata.ts');
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/synthetic')").run();
    // 复现生产统计：PRAGMA optimize 抽样把 metadata_status 与 library_id 都估成约 1352 行，规划器改由媒体库驱动、
    // 用 files_library 扫整库再建临时排序，约 94 万文件时每认领一个文件要 2 秒以上并全程占住写锁。
    db.exec('ANALYZE');
    db.exec("DELETE FROM sqlite_stat1 WHERE tbl IN ('files','libraries','metadata_claims')");
    const stat = db.prepare('INSERT INTO sqlite_stat1(tbl,idx,stat) VALUES (?,?,?)');
    for (const [tbl, idx, value] of [['files', 'files_metadata', '665089 1352 1'], ['files', 'files_library', '665089 1352 1352'], ['files', 'sqlite_autoindex_files_1', '665089 1'],
      ['libraries', 'sqlite_autoindex_libraries_1', '2 1'], ['metadata_claims', 'sqlite_autoindex_metadata_claims_1', '1 1']]) stat.run(tbl, idx, value);
    db.exec('ANALYZE sqlite_schema');
    for (const byLibrary of [false, true]) {
      const plan = (db.prepare(`EXPLAIN QUERY PLAN ${metadataClaimSql(byLibrary)}`).all(...(byLibrary ? ['lib'] : [])) as { detail: string }[]).map((row) => row.detail).join(' | ');
      assert.match(plan, byLibrary ? /USING INDEX files_library_metadata \(library_id=\? AND metadata_status=\?\)/ : /USING INDEX files_metadata \(metadata_status=\?\)/, plan);
      assert.doesNotMatch(plan, /TEMP B-TREE/, plan);
    }
  } finally { db.close(); }
});

test('打开媒体详情时立即读取尚未读取的元数据，不影响其它文件', async () => {
  const { createApp } = await import('../src/api/app.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-metadata-now-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    await promisify(execFile)(process.execPath, [fixtureScript, '--output', root]);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const photo = db.prepare("SELECT id FROM files WHERE name='exif-gps.jpg'").get() as { id: string };
    assert.equal((db.prepare("SELECT count(*) AS n FROM files WHERE metadata_status<>'pending'").get() as { n: number }).n, 0);
    const detail = (await app.inject({ method: 'GET', url: `/api/v2/media/${photo.id}`, headers: { cookie } })).json();
    assert.equal(detail.exif.model, 'Fixture Camera'); assert.ok(detail.location);
    assert.equal(detail.takenAt, new Date(Date.parse('2024-05-06T10:11:12+08:00')).toISOString());
    assert.equal(detail.width, 960);
    assert.deepEqual(db.prepare("SELECT name FROM files WHERE metadata_status<>'pending'").all(), [{ name: 'exif-gps.jpg' }]);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});
