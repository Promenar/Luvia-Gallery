import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';
import { scanLibrary } from '../src/worker/scan.ts';

test('扫描期间挂载身份不符不会标记既有文件缺失，修改根目录会重置身份', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'luvia-scan-root-')); const root = path.join(dir, 'media'); await mkdir(root);
  const db = openDatabase(path.join(dir, 'db.sqlite'));
  try {
    await writeFile(path.join(root, 'a.jpg'), 'a');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare("INSERT INTO library_watch_state(library_id,mount_root,mount_identity,mount_attempted) VALUES ('lib',?,'original',1)").run(root);
    await rm(path.join(root, 'a.jpg'));
    await assert.rejects(scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root], mount: async () => 'fallback' }), /挂载/);
    assert.equal((db.prepare('SELECT missing_at_ms FROM files').get() as {missing_at_ms:number|null}).missing_at_ms, null);
    db.prepare("UPDATE libraries SET root=? WHERE id='lib'").run(`${root}-new`);
    assert.deepEqual(db.prepare("SELECT mount_root,mount_identity,mount_attempted FROM library_watch_state WHERE library_id='lib'").get(), {mount_root:null,mount_identity:null,mount_attempted:0});
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});
