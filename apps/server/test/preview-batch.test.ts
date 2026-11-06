import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.ts';
import { runNextJob } from '../src/worker/runner.ts';

test('缺少待处理视频时分发作业分段扫描并保存进度', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root,enabled) VALUES ('lib','照片','/a',1)").run();
    const insert = db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES (?,'lib',?,'lib',?,'image/jpeg','image',1,1,1,'mtime')");
    db.transaction(() => { for (let i = 0; i < 1200; i++) { const id = String(i).padStart(4, '0'); insert.run(id, id, id); } })();
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES ('batch','previews','预览','queued','system','{}',1,'previews:test')").run();
    let yielded = false; let queries = 0; let yieldedBeforeSecondPage = false;
    const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (sql.includes('f.media_type,f.has_preview') && sql.includes('LIMIT')) {
        return { all: (...args: unknown[]) => {
          queries++; if (queries === 2) yieldedBeforeSecondPage = yielded;
          return statement.all(...args);
        } } as unknown as ReturnType<typeof db.prepare>;
      }
      return statement;
    }) as typeof db.prepare;
    setImmediate(() => { yielded = true; });
    await runNextJob(db, { owner: 'worker', allowedRoots: [], legacyDir: '', systemRoots: [] });
    assert.equal(yielded, true, '分段后必须让定时器和 I/O 有机会运行');
    assert.ok(queries >= 2, '每轮扫描应分为多个较小的读取块');
    assert.equal(yieldedBeforeSecondPage, true, '读取块之间应让出事件循环');
    const first = db.prepare("SELECT status,checkpoint FROM jobs WHERE id='batch'").get() as { status: string; checkpoint: string };
    assert.equal(first.status, 'queued');
    assert.ok(JSON.parse(first.checkpoint).lastId < '1199');
    for (let i = 0; i < 4 && (db.prepare("SELECT status FROM jobs WHERE id='batch'").get() as { status: string }).status !== 'succeeded'; i++) {
      await runNextJob(db, { owner: 'worker', allowedRoots: [], legacyDir: '', systemRoots: [] });
    }
    assert.equal((db.prepare("SELECT status FROM jobs WHERE id='batch'").get() as { status: string }).status, 'succeeded');
    assert.equal((db.prepare("SELECT count(*) AS n FROM jobs WHERE dedupe_key LIKE 'media:%'").get() as { n: number }).n, 0);
  } finally { db.close(); }
});

test('读取块之间暂停并恢复，已经排入的预览不重复且余下媒体不遗漏', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root,enabled) VALUES ('lib','照片','/a',1)").run();
    const insert = db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source) VALUES (?,'lib',?,'lib',?,'video/mp4',?,1,1,1,'mtime')");
    const expected: string[] = [];
    db.transaction(() => { for (let i = 0; i < 130; i++) {
      const id = String(i).padStart(4, '0'); const video = i % 8 === 0;
      if (video) expected.push(id); insert.run(id, id, id, video ? 'video' : 'image');
    } })();
    db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES ('batch','previews','预览','queued','system','{}',1,'previews:test')").run();
    setImmediate(() => db.prepare("UPDATE jobs SET status='paused',owner=NULL,lease_token=NULL,lease_expires_at=NULL WHERE id='batch'").run());
    const options = { owner: 'worker', allowedRoots: [], legacyDir: '', systemRoots: [] };
    await runNextJob(db, options);
    assert.equal((db.prepare("SELECT status FROM jobs WHERE id='batch'").get() as { status: string }).status, 'paused');
    db.prepare("UPDATE jobs SET status='succeeded' WHERE dedupe_key LIKE 'media:%'").run();
    db.prepare("UPDATE jobs SET status='queued' WHERE id='batch'").run();
    await runNextJob(db, options);
    assert.equal((db.prepare("SELECT status FROM jobs WHERE id='batch'").get() as { status: string }).status, 'succeeded');
    const actual = (db.prepare("SELECT json_extract(payload,'$.mediaId') AS id FROM jobs WHERE dedupe_key LIKE 'media:%' ORDER BY id").all() as { id: string }[]).map((row) => row.id);
    assert.deepEqual(actual, expected);
  } finally { db.close(); }
});

for (const byLibrary of [false, true]) {
  test(`预览分发${byLibrary ? '按单库' : '按全库'}沿 ID 索引分页并跳过不可处理媒体`, async () => {
    const db = openDatabase(':memory:');
    try {
      db.prepare("INSERT INTO libraries(id,name,root,enabled) VALUES ('lib','照片','/a',1),('other','视频','/b',1),('disabled','停用','/c',0)").run();
      const insert = db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,has_preview,missing_at_ms)
        VALUES (?,?,?,?,?,'video/mp4',?,1,1,1,'mtime',?,?)`);
      for (let i = 0; i < 40; i++) {
        const suffix = String(i).padStart(3, '0');
        insert.run(`a-${suffix}`, 'lib', `a-${suffix}.mp4`, 'lib', `a-${suffix}.mp4`, 'video', 0, null);
        insert.run(`b-${suffix}`, 'other', `b-${suffix}.mp4`, 'other', `b-${suffix}.mp4`, 'video', 0, null);
      }
      insert.run('00-disabled', 'disabled', 'disabled.mp4', 'disabled', 'disabled.mp4', 'video', 0, null);
      insert.run('00-missing', 'lib', 'missing.mp4', 'lib', 'missing.mp4', 'video', 0, 1);
      insert.run('00-ready', 'lib', 'ready.mp4', 'lib', 'ready.mp4', 'video', 1, null);
      insert.run('00-image', 'lib', 'image.jpg', 'lib', 'image.jpg', 'image', 0, null);
      db.exec('ANALYZE'); db.exec("DELETE FROM sqlite_stat1 WHERE tbl IN ('files','libraries')");
      const stat = db.prepare('INSERT INTO sqlite_stat1(tbl,idx,stat) VALUES (?,?,?)');
      for (const [index, value] of [['files_library_metadata_recent', '937858 2001 2001 1'], ['files_library', '937858 2001 2001'], ['files_type_taken', '937858 2001 2 1'], ['sqlite_autoindex_files_1', '937858 1']]) stat.run('files', index, value);
      stat.run('libraries', 'sqlite_autoindex_libraries_1', '2 1'); db.exec('ANALYZE sqlite_schema');
      db.prepare("INSERT INTO jobs(id,type,label,status,trigger,payload,created_at,dedupe_key) VALUES ('batch','previews','生成视频预览','queued','system',?,1,'previews:test')")
        .run(JSON.stringify({ libraryId: byLibrary ? 'lib' : null }));
      const prepare = db.prepare.bind(db); let batchSql = '';
      db.prepare = ((sql: string) => {
        if (sql.includes('f.media_type,f.has_preview') && sql.includes('LIMIT 64')) batchSql = sql;
        return prepare(sql);
      }) as typeof db.prepare;
      await runNextJob(db, { owner: 'worker', allowedRoots: [], legacyDir: '', systemRoots: [] });
      assert.ok(batchSql, '应执行预览分发查询');
      const plan = (prepare(`EXPLAIN QUERY PLAN ${batchSql}`).all('') as { detail: string }[]).map((row) => row.detail).join(' | ');
      assert.match(plan, /SEARCH f USING INDEX sqlite_autoindex_files_1 \(id>\?\)/, plan);
      assert.doesNotMatch(plan, /TEMP B-TREE/, plan);
      const queued = (prepare("SELECT json_extract(payload,'$.mediaId') AS id FROM jobs WHERE dedupe_key LIKE 'media:%' ORDER BY id").all() as { id: string }[]).map((row) => row.id);
      assert.deepEqual(queued, Array.from({ length: 32 }, (_, i) => `a-${String(i).padStart(3, '0')}`));
      const batch = prepare("SELECT status,progress_done FROM jobs WHERE id='batch'").get() as { status: string; progress_done: number };
      assert.deepEqual(batch, { status: 'queued', progress_done: 32 });
      for (let page = 0; page < 4; page++) {
        // 模拟逐文件作业完成，再领取分发作业的下一轮。
        prepare("UPDATE jobs SET status='succeeded' WHERE dedupe_key LIKE 'media:%' AND status='queued'").run();
        if ((prepare("SELECT status FROM jobs WHERE id='batch'").get() as { status: string }).status === 'succeeded') break;
        await runNextJob(db, { owner: 'worker', allowedRoots: [], legacyDir: '', systemRoots: [] });
      }
      const all = (prepare("SELECT json_extract(payload,'$.mediaId') AS id FROM jobs WHERE dedupe_key LIKE 'media:%' ORDER BY id").all() as { id: string }[]).map((row) => row.id);
      const expected = Array.from({ length: 40 }, (_, i) => `a-${String(i).padStart(3, '0')}`);
      if (!byLibrary) expected.push(...Array.from({ length: 40 }, (_, i) => `b-${String(i).padStart(3, '0')}`));
      assert.deepEqual(all, expected);
      assert.equal((prepare("SELECT status FROM jobs WHERE id='batch'").get() as { status: string }).status, 'succeeded');
    } finally { db.close(); }
  });
}
