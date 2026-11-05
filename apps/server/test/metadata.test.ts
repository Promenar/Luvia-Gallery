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
    await runNextJob(db, options);
    const row = (name: string) => db.prepare('SELECT * FROM files WHERE name=?').get(name) as Record<string, any>;
    const photo = row('exif-gps.jpg');
    assert.equal(photo.metadata_status, 'done'); assert.equal(photo.taken_at_source, 'metadata');
    assert.equal(photo.taken_at, Date.parse('2024-05-06T10:11:12+08:00') / 1000);
    assert.equal(photo.width, 960); assert.equal(photo.height, 640); assert.equal(photo.model, 'Fixture Camera');
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
