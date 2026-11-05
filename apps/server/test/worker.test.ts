import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/core/database.ts';

test('worker 领取扫描作业，保存结果并发出库变化事件', async () => {
  const module = await import('../src/worker/runner.ts').catch(() => null);
  assert.ok(module, 'worker 执行器尚未实现');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-worker-'));
  const db = openDatabase(':memory:');
  try {
    await writeFile(path.join(root, 'a.jpg'), 'image');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at) VALUES ('job','scan','扫描','queued','manual',?,1)").run(JSON.stringify({ libraryId: 'lib' }));
    assert.equal(await module.runNextJob(db, { owner: 'worker-a', allowedRoots: [root], legacyDir: root, systemRoots: [] }), true);
    const job = db.prepare("SELECT status,result FROM jobs WHERE id='job'").get() as { status: string; result: string };
    assert.equal(job.status, 'succeeded');
    assert.deepEqual(JSON.parse(job.result), { added: 1, removed: 0, errors: 0 });
    const events = db.prepare("SELECT event_type FROM job_events ORDER BY id").all() as { event_type: string }[];
    assert.ok(events.some((item) => item.event_type === 'library'));
    assert.equal((db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }).n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('只在设置允许时把新挂载建库并排队扫描', async () => {
  const module = await import('../src/worker/discover.ts').catch(() => null);
  assert.ok(module, '挂载发现模块尚未实现');
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-discovery-'));
  const db = openDatabase(':memory:');
  const mount = { containerPath: root, hostPath: '/volume/photos', kind: 'candidate' as const, libraryId: null, readOnly: true, mediaEstimate: null };
  try {
    assert.equal(await module.discoverNewMounts(db, [mount], []), 0);
    db.prepare("INSERT INTO settings(key,value) VALUES('admin.settings',?)").run(JSON.stringify({ libraries: { autoEnableNewMounts: true } }));
    assert.equal(await module.discoverNewMounts(db, [mount], []), 1);
    assert.equal(await module.discoverNewMounts(db, [mount], []), 0);
    const library = db.prepare('SELECT root,host_root,host_root_source FROM libraries').get() as { root: string; host_root: string; host_root_source: string };
    assert.deepEqual(library, { root, host_root: '/volume/photos', host_root_source: 'auto' });
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE type='scan' AND status='queued'").get() as { n: number }).n, 1);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

test('缺少媒体任务参数的作业返回失败状态', async () => {
  const module = await import('../src/worker/runner.ts').catch(() => null);
  assert.ok(module, 'worker 执行器尚未实现');
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,created_at) VALUES ('job','thumbnails','缩略图','queued','manual',1)").run();
    await module.runNextJob(db, { owner: 'worker-a', allowedRoots: [], legacyDir: '/nonexistent', systemRoots: [] });
    const row = db.prepare("SELECT status,error FROM jobs WHERE id='job'").get() as { status: string; error: string };
    assert.equal(row.status, 'failed');
    assert.ok(row.error);
  } finally { db.close(); }
});
