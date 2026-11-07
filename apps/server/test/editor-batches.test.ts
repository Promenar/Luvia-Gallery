import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.ts';
import { EditorBatches } from '../src/editor/batches.ts';
import { EditorError } from '../src/editor/queue.ts';
import { editorConfig } from '../src/editor/service.ts';
import { EditorQueue } from '../src/editor/queue.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

function fixture() {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试','/tmp')").run();
  const insert = db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source)
    VALUES (?,'lib',?,'lib',?,'image/jpeg','image',10,100,100,'mtime')`);
  for (const id of ['a', 'b', 'c']) insert.run(id, `${id}.jpg`, `${id}.jpg`);
  const body = (mediaId: string) => ({ mode: 'auto' as const, threshold: 128,
    destination: { libraryId: 'lib', folder: '结果' },
    items: [{ mediaId, source: { size: 10, modifiedAt: 100, generation: 0 } }] });
  return { db, body };
}

const capabilities = async () => ({ models: [{ id: 'slbr', available: true, features: ['detect'] }] });
async function until(check: () => boolean, timeout = 6000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error('等待批量状态超时');
}

test('长时间运行的批次不会阻塞其他批次进入队列', async () => {
  const { db, body } = fixture();
  const created: string[] = [];
  const editor = { capabilities, create: async (input: { mediaId: string }) => { created.push(input.mediaId); return { id: `job-${input.mediaId}` }; },
    job: () => ({ status: 'running' }), cancel: async () => {} } as unknown as EditorQueue;
  const batches = new EditorBatches(db, editor);
  try {
    await batches.create('u', body('a'));
    await batches.create('u', body('b'));
    await until(() => created.length === 2, 3000);
    assert.deepEqual(created, ['a', 'b']);
  } finally { await batches.close(); db.close(); }
});

test('入库持续返回 pending 时按上限停止，保留错误供用户处理', async () => {
  const { db, body } = fixture();
  let calls = 0;
  const editor = { capabilities, create: async () => ({ id: 'job-pending' }),
    job: () => ({ status: 'succeeded', outcome: 'detected' }),
    importExternal: async () => { calls++; return { status: 'pending' }; }, cancel: async () => {} } as unknown as EditorQueue;
  const batches = new EditorBatches(db, editor);
  try {
    const batch = await batches.create('u', body('a'));
    await until(() => batches.get(batch.id, 'u').items[0]?.status === 'failed', 8000);
    const item = batches.get(batch.id, 'u').items[0]!;
    assert.equal(item.attempts, 3);
    assert.equal(calls, 2);
    assert.match(item.error!, /入库尚未完成/);
  } finally { await batches.close(); db.close(); }
});

test('取消等待已经开始的发布收尾后再返回', async () => {
  const { db, body } = fixture();
  let release!: () => void;
  let started = false;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const editor = { capabilities, create: async () => ({ id: 'job-blocked' }),
    job: () => ({ status: 'succeeded', outcome: 'detected' }),
    importExternal: async () => { started = true; await blocked; return { status: 'saved', mediaId: 'copy', name: '副本.png' }; },
    cancel: async () => {} } as unknown as EditorQueue;
  const batches = new EditorBatches(db, editor);
  try {
    const batch = await batches.create('u', body('a'));
    await until(() => started);
    let returned = false;
    const cancellation = batches.action(batch.id, 'u', 'cancel').then((value) => { returned = true; return value; });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(returned, false);
    release();
    const result = await cancellation;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.items[0]?.status, 'saved');
  } finally { release(); await batches.close(); db.close(); }
});

test('批次列表可分页查回较早的待处理任务', async () => {
  const { db, body } = fixture();
  const editor = { capabilities, create: async () => ({ id: 'job' }), job: () => ({ status: 'running' }), cancel: async () => {} } as unknown as EditorQueue;
  const batches = new EditorBatches(db, editor);
  try {
    const first = await batches.create('u', body('a'));
    await batches.create('u', body('b'));
    await batches.create('u', body('c'));
    const page = batches.list('u', { limit: 2 });
    assert.equal(page.batches.length, 2);
    assert.ok(page.nextCursor);
    assert.equal(batches.list('u', { limit: 2, cursor: page.nextCursor! }).batches[0]?.id, first.id);
  } finally { await batches.close(); db.close(); }
});

test('重启后取消中的审核项目会释放结果', async () => {
  const { db } = fixture();
  db.prepare("INSERT INTO editor_batches VALUES ('batch','u','review','cancelled',128,'lib','',0)").run();
  db.prepare(`INSERT INTO editor_jobs(id,user_id,media_id,library_id,source_size,source_modified,source_generation,model,status,mask_path,created_at,expires_at)
    VALUES ('job','u','a','lib',10,100,0,'slbr','succeeded','/tmp/mask',0,2147483647)`).run();
  db.prepare(`INSERT INTO editor_batch_items(id,batch_id,position,media_id,source_size,source_modified,source_generation,source_name,status,job_id,operation_id)
    VALUES ('item','batch',0,'a',10,100,0,'a.jpg','review','job','operation')`).run();
  const editor = { cancel: async () => {} } as unknown as EditorQueue;
  const batches = new EditorBatches(db, editor);
  try {
    await until(() => batches.get('batch', 'u').items[0]?.status === 'cancelled', 2000);
    const job = db.prepare("SELECT expires_at FROM editor_jobs WHERE id='job'").get() as { expires_at: number };
    assert.ok(job.expires_at < 2147483647);
  } finally { await batches.close(); db.close(); }
});

test('恢复保存时等待旧租约不会耗尽失败次数', async () => {
  const { db } = fixture();
  const lease = Math.floor(Date.now() / 1000) + 60;
  db.prepare("INSERT INTO editor_batches VALUES ('batch','u','auto','running',128,'lib','',0)").run();
  db.prepare(`INSERT INTO editor_batch_items(id,batch_id,position,media_id,source_size,source_modified,source_generation,source_name,status,attempts,job_id,operation_id)
    VALUES ('item','batch',0,'a',10,100,0,'a.jpg','saving',1,'job','operation')`).run();
  db.prepare(`INSERT INTO editor_imports(operation_id,user_id,job_id,library_id,folder,requested_name,owner,lease_until,created_at)
    VALUES ('operation','u','job','lib','','a.png','old',?,0)`).run(lease);
  let calls = 0;
  const editor = { importExternal: async () => { calls++; throw new EditorError(409, 'OPERATION_CONFLICT', '导入正在进行'); } } as unknown as EditorQueue;
  const batches = new EditorBatches(db, editor);
  try {
    await until(() => calls > 0, 2000);
    const item = db.prepare("SELECT status,attempts,next_attempt_at FROM editor_batch_items WHERE id='item'").get() as {status:string;attempts:number;next_attempt_at:number};
    assert.equal(item.status, 'saving');
    assert.equal(item.attempts, 1);
    assert.ok(item.next_attempt_at > lease);
  } finally { await batches.close(); db.close(); }
});

test('暂停期间跳过最后一项后恢复会完成批次', async () => {
  const { db } = fixture();
  db.prepare("INSERT INTO editor_batches VALUES ('batch','u','review','paused',128,'lib','',0)").run();
  db.prepare(`INSERT INTO editor_batch_items(id,batch_id,position,media_id,source_size,source_modified,source_generation,source_name,status,operation_id)
    VALUES ('item','batch',0,'a',10,100,0,'a.jpg','review','operation')`).run();
  const batches = new EditorBatches(db, {} as EditorQueue);
  try {
    await batches.itemAction('batch', 'item', 'u', 'skip');
    const result = await batches.action('batch', 'u', 'resume');
    assert.equal(result.status, 'completed');
  } finally { await batches.close(); db.close(); }
});

test('取消大量未开始项目不会阻塞其他批次', async () => {
  const { db, body } = fixture();
  db.prepare("INSERT INTO editor_batches VALUES ('cancelled','u','auto','cancelled',128,'lib','',0)").run();
  const insert = db.prepare(`INSERT INTO editor_batch_items(id,batch_id,position,media_id,source_size,source_modified,source_generation,source_name,status,operation_id)
    VALUES (?,'cancelled',?,?,10,100,0,'a.jpg','pending',?)`);
  for (let i = 0; i < 10; i++) insert.run(`item-${i}`, i, `media-${i}`, `operation-${i}`);
  let started = false;
  const editor = { capabilities, create: async () => { started = true; return { id: 'other-job' }; },
    job: () => ({ status: 'running' }), cancel: async () => {} } as unknown as EditorQueue;
  const batches = new EditorBatches(db, editor);
  try {
    await batches.create('u', body('a'));
    await until(() => started, 2000);
    assert.equal((db.prepare("SELECT count(*) AS n FROM editor_batch_items WHERE batch_id='cancelled' AND status='pending'").get() as {n:number}).n, 0);
  } finally { await batches.close(); db.close(); }
});

test('缓存预算回收会跳过待审核结果并清理其他结果', async () => {
  const { db } = fixture();
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-batch-budget-'));
  const insertJob = db.prepare(`INSERT INTO editor_jobs(id,user_id,media_id,library_id,source_size,source_modified,source_generation,model,status,mask_path,result_bytes,created_at,expires_at)
    VALUES (?,'u','a','lib',10,100,0,'slbr','succeeded','mask',?, ?,2147483647)`);
  const insertBatch = db.prepare("INSERT INTO editor_batches VALUES (?,'u','review','running',128,'lib','',0)");
  const insertItem = db.prepare(`INSERT INTO editor_batch_items(id,batch_id,position,media_id,source_size,source_modified,source_generation,source_name,status,job_id,operation_id)
    VALUES (?,?,0,'a',10,100,0,'a.jpg','review',?,?)`);
  for (let i = 0; i < 200; i++) {
    const id = `job-${String(i).padStart(4, '0')}`;
    insertJob.run(id, 12 * 1024 * 1024, 1);
    insertBatch.run(`batch-${i}`);
    insertItem.run(`item-${i}`, `batch-${i}`, id, `operation-${i}`);
  }
  insertJob.run('job-free-1', 1024, 2);
  const queue = new EditorQueue(db, cache, editorConfig());
  try {
    await queue.sweep();
    assert.equal(db.prepare("SELECT 1 FROM editor_jobs WHERE id='job-free-1'").get(), undefined);
    assert.ok(db.prepare("SELECT 1 FROM editor_jobs WHERE id='job-0000'").get());
  } finally { await queue.close(); db.close(); await rm(cache, { recursive: true, force: true }); }
});
