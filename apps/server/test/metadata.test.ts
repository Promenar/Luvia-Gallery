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

test('元数据认领沿索引按修改时间倒序取下一项，不扫描整库再排序', async () => {
  const { metadataClaimSql, metadataPriorityClaimSql } = await import('../src/worker/metadata.ts');
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
      assert.match(plan, byLibrary ? /USING INDEX files_library_metadata_recent \(library_id=\? AND metadata_status=\?\)/ : /USING INDEX files_metadata_recent \(metadata_status=\?\)/, plan);
      assert.doesNotMatch(plan, /TEMP B-TREE/, plan);
      const priority = (db.prepare(`EXPLAIN QUERY PLAN ${metadataPriorityClaimSql(byLibrary)}`).all(...(byLibrary ? ['lib'] : [])) as { detail: string }[]).map((row) => row.detail).join(' | ');
      assert.match(priority, /SCAN p USING INDEX metadata_priority_recent/, priority);
      assert.doesNotMatch(priority, /TEMP B-TREE/, priority);
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

test('界面正在显示的缺宽高文件优先读取，其余按修改时间从新到旧读取', async () => {
  const { createApp } = await import('../src/api/app.ts');
  const { metadataClaimSql, metadataPriorityClaimSql } = await import('../src/worker/metadata.ts');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-metadata-priority-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    await promisify(execFile)(process.execPath, [fixtureScript, '--output', root]);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const files = db.prepare("SELECT id,name FROM files WHERE media_type='image' ORDER BY id").all() as { id: string; name: string }[];
    assert.ok(files.length >= 3);
    files.forEach((file, index) => db.prepare('UPDATE files SET modified_at=? WHERE id=?').run(1_700_000_000 + index * 100, file.id));
    const newest = files.at(-1)!; const oldest = files[0]!; const sized = files[1]!;
    db.prepare("UPDATE files SET modified_at=1800000000 WHERE metadata_status='pending' AND media_type<>'image'").run();
    db.prepare("UPDATE files SET metadata_status='done' WHERE media_type<>'image'").run();
    db.prepare("UPDATE files SET width=640,height=480,metadata_status='done' WHERE id=?").run(sized.id);
    const next = () => (db.prepare(metadataPriorityClaimSql(true)).get('lib') ?? db.prepare(metadataClaimSql(true)).get('lib')) as { id: string };
    assert.equal(next().id, newest.id);

    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const ask = (ids: string[]) => app.inject({ method: 'POST', url: '/api/v2/media/dimensions', headers: { 'x-luvia-request': '1', cookie }, payload: { ids } });
    const response = await ask([sized.id, oldest.id, 'missing-id']);
    assert.equal(response.statusCode, 200);
    // 已有宽高的直接返回；缺宽高的记入优先队列，不存在或无权访问的忽略
    assert.deepEqual(response.json(), { items: [{ id: sized.id, width: 640, height: 480 }] });
    assert.deepEqual(db.prepare('SELECT file_id FROM metadata_priority').all(), [{ file_id: oldest.id }]);
    assert.equal(next().id, oldest.id);
    assert.equal((await app.inject({ method: 'POST', url: '/api/v2/media/dimensions', headers: { 'x-luvia-request': '1' }, payload: { ids: [oldest.id] } })).statusCode, 401);

    // 后台作业认领优先项后移出队列
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('meta','metadata','提取元数据','queued','system',?,1)").run(JSON.stringify({ libraryId: 'lib' }));
    await runNextJob(db, { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [] });
    assert.notEqual((db.prepare('SELECT metadata_status FROM files WHERE id=?').get(oldest.id) as { metadata_status: string }).metadata_status, 'pending');
    assert.equal((db.prepare('SELECT count(*) AS n FROM metadata_priority').get() as { n: number }).n, 0);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('数据库暂时被锁时元数据作业放回队列而不是判为失败', async () => {
  const Database = (await import('better-sqlite3')).default;
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-metadata-busy-'));
  const filename = path.join(root, 'luvia.db');
  const db = openDatabase(filename); const other = new Database(filename);
  try {
    await promisify(execFile)(process.execPath, [fixtureScript, '--output', path.join(root, 'media')]);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(path.join(root, 'media'));
    await scanLibrary(db, { id: 'lib', root: path.join(root, 'media') }, { allowedRoots: [path.join(root, 'media')] });
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('meta','metadata','提取元数据','queued','system',?,1)").run(JSON.stringify({ libraryId: 'lib' }));
    db.pragma('busy_timeout = 20');
    const warnings: string[] = [];
    // 作业领取是同步的；领取后到首次认领文件之间另一连接占住写锁，模拟检查点等长时间写锁
    const running = runNextJob(db, { owner: 'worker', allowedRoots: [path.join(root, 'media')], legacyDir: root, systemRoots: [], log: (_level, message) => warnings.push(message) });
    other.exec('BEGIN IMMEDIATE');
    await running;
    other.exec('COMMIT');
    const job = db.prepare("SELECT status,error FROM jobs WHERE id='meta'").get() as { status: string; error: string | null };
    assert.notEqual(job.status, 'failed'); assert.equal(job.error, null);
    assert.deepEqual(warnings, ['数据库暂时繁忙，作业稍后继续']);
  } finally { if (other.inTransaction) other.exec('ROLLBACK'); other.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('扫描锁住的媒体库积压大量待刷新目录时，只按未锁定媒体库的路径范围刷新', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib_a','甲','/a'),('lib_b','乙','/b'),('lib_c','丙','/c')").run();
    db.prepare("INSERT INTO scan_locks(library_id,owner,acquired_at,heartbeat_at,lease_expires_at,lease_token) VALUES ('lib_a','scan',1,1,unixepoch()+60,'t')").run();
    const dirty = db.prepare('INSERT INTO metadata_dirty_folders(path,updated) VALUES (?,1)');
    for (let i = 0; i < 500; i++) dirty.run(`lib_a/目录${String(i).padStart(3, '0')}`);
    for (const path of ['lib_b', 'lib_b/旅行', 'lib_c/家庭']) dirty.run(path);
    const left = () => (db.prepare('SELECT path FROM metadata_dirty_folders ORDER BY path').pluck().all() as string[]);
    // 仍有被锁住的目录，返回 true，作业稍后再刷新
    assert.equal(flushMetadataFolders(db), true);
    assert.equal(left().length, 500);
    assert.ok(left().every((path) => path.startsWith('lib_a/')));
    db.prepare('DELETE FROM scan_locks').run();
    assert.equal(flushMetadataFolders(db), true);
    assert.equal(left().length, 500 - 64);
  } finally { db.close(); }
});

test('单个文件的认领在读取期间失效时只放弃该文件，作业不判为失败，过期后重新认领', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-metadata-claim-lost-'));
  const db = openDatabase(':memory:');
  try {
    await promisify(execFile)(process.execPath, [fixtureScript, '--output', root]);
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const pending = () => (db.prepare("SELECT count(*) AS n FROM files WHERE metadata_status='pending'").get() as { n: number }).n;
    assert.ok(pending() >= 2);
    // 第一次认领后立即让该认领过期，模拟磁盘繁忙时续租连续跳过
    db.exec(`CREATE TEMP TABLE hits(n INTEGER); INSERT INTO hits VALUES (0);
      CREATE TEMP TRIGGER expire_first AFTER INSERT ON metadata_claims WHEN (SELECT n FROM hits)=0 BEGIN
        UPDATE metadata_claims SET lease_expires_at=0 WHERE file_id=NEW.file_id; UPDATE hits SET n=1; END`);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('meta','metadata','提取元数据','queued','system',?,1)").run(JSON.stringify({ libraryId: 'lib' }));
    const warnings: string[] = [];
    const options = { owner: 'worker', allowedRoots: [root], legacyDir: root, systemRoots: [], log: (level: string, message: string) => { if (level === 'warn') warnings.push(message); } };
    for (let i = 0; i < 10 && await runNextJob(db, options); i++);
    const job = db.prepare("SELECT status,error FROM jobs WHERE id='meta'").get() as { status: string; error: string | null };
    assert.equal((db.prepare('SELECT n FROM hits').get() as { n: number }).n, 1);
    assert.deepEqual([job.status, job.error, warnings], ['succeeded', null, []]);
    assert.equal(pending(), 0);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
