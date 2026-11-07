import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/core/database.ts';
import { cleanupRetiredImport, importExternalResult } from '../src/editor/external-import.ts';

for (const published of [false, true]) test(`取消后恢复${published ? '已发布' : '未发布'}的暂存`, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-batch-cancel-'));
  const db = openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO libraries(id,name,root) VALUES (?,?,?)').run('lib', '测试', root);
    const result = path.join(root, 'result.png');
    await sharp({ create: { width: 2, height: 2, channels: 3, background: '#abcdef' } }).png().toFile(result);
    const job = { id: 'job', media_id: 'upload:1', status: 'succeeded', result_path: result,
      expires_at: Math.floor(Date.now() / 1000) + 600, source_size: 0, source_modified: 0, source_generation: 0 };
    db.prepare(`INSERT INTO editor_jobs(id,user_id,media_id,library_id,source_size,source_modified,source_generation,model,status,mask_path,result_path,created_at,expires_at)
      VALUES ('job','u','upload:1','lib',0,0,0,'slbr','succeeded','mask',?,0,?)`).run(result, job.expires_at);
    db.prepare("INSERT INTO editor_batches VALUES ('batch','u','auto','cancelled',128,'lib','',0)").run();
    db.prepare(`INSERT INTO editor_batch_items(id,batch_id,position,media_id,source_size,source_modified,source_generation,source_name,status,job_id,operation_id)
      VALUES ('item','batch',0,'upload:1',0,0,0,'a.jpg','saving','job','operation-cancel')`).run();
    const stageName = `.luvia-import-${createHash('sha256').update('operation-cancel').digest('hex')}-00000000-0000-4000-8000-000000000000.tmp`;
    await mkdir(path.join(root, stageName));
    await writeFile(path.join(root, stageName, 'image'), await sharp(result).png().toBuffer());
    const stage = await stat(path.join(root, stageName, 'image'), { bigint: true });
    const parent = await stat(root, { bigint: true });
    if (published) await link(path.join(root, stageName, 'image'), path.join(root, 'copy.png'));
    db.prepare(`INSERT INTO editor_imports(operation_id,user_id,job_id,library_id,folder,requested_name,final_name,stage_ready,stage_dev,stage_ino,stage_name,parent_dev,parent_ino,created_at)
      VALUES ('operation-cancel','u','job','lib','','copy.png','copy.png',1,?,?,?,?,?,0)`)
      .run(stage.dev.toString(), stage.ino.toString(), stageName, parent.dev.toString(), parent.ino.toString());
    const body = { libraryId: 'lib', folder: '', name: 'copy.png', operationId: 'operation-cancel' };
    if (published) {
      const value = await importExternalResult(db, 'u', job, body);
      assert.equal(value.status, 'saved');
      assert.ok(db.prepare("SELECT id FROM files WHERE name='copy.png'").get());
    } else {
      await assert.rejects(importExternalResult(db, 'u', job, body), { code: 'BATCH_STOPPED' });
      assert.deepEqual(db.prepare("SELECT status FROM editor_imports WHERE operation_id='operation-cancel'").get(), { status: 'failed' });
      assert.ok(db.prepare('SELECT 1 FROM editor_import_stage_gc WHERE stage_name=?').get(stageName));
      await cleanupRetiredImport(db, stageName);
      await assert.rejects(stat(path.join(root, stageName)), { code: 'ENOENT' });
      await assert.rejects(stat(path.join(root, 'copy.png')), { code: 'ENOENT' });
    }
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
