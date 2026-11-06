import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.ts';
import { materializeFolders } from '../src/worker/scan.ts';
import { noteThumbnail, replaceEvictedThumbnailCovers } from '../src/core/folder-covers.ts';

test('大型目录统计计算过程中允许事件循环执行心跳与取消', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/a')").run();
    const insert = db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES (?,'lib',NULL,?)");
    db.transaction(() => { for (let i = 0; i < 80; i++) insert.run(`lib/${i}`, `${i}`); })();
    let yielded = false; let counts = 0; let yieldedBySeventeenth = false; const prepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (sql.startsWith('SELECT count(*) AS n FROM files WHERE folder=')) return { get: (...args: unknown[]) => {
        counts++; if (counts === 17) yieldedBySeventeenth = yielded; return statement.get(...args);
      } } as unknown as ReturnType<typeof db.prepare>;
      return statement;
    }) as typeof db.prepare;
    setImmediate(() => { yielded = true; });
    await materializeFolders(db, 'lib', () => {});
    assert.equal(counts, 80);
    assert.equal(yieldedBySeventeenth, true, '目录统计计算不能长时间阻塞事件循环');
  } finally { db.close(); }
});

for (const action of ['generate', 'evict'] as const) test(`目录统计期间${action === 'generate' ? '生成' : '淘汰'}缩略图不会被旧封面覆盖`, async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/a')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'root')").run();
    const folder = db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES (?,'lib','lib',?)");
    for (let i = 0; i < 20; i++) folder.run(`lib/${String(i).padStart(2, '0')}`, `${i}`);
    const file = db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,thumb_ready) VALUES (?,'lib',?,'lib/00',?,'image/jpeg','image',1,1,?,'mtime',?)");
    file.run('new','new.jpg','new.jpg',20,action === 'evict' ? 1 : 0);
    if (action === 'evict') {
      file.run('old','old.jpg','old.jpg',10,1);
      db.prepare("UPDATE folders SET cover_file_id='new' WHERE path IN ('lib','lib/00')").run();
    }
    setImmediate(() => {
      if (action === 'generate') { db.prepare("UPDATE files SET thumb_ready=1 WHERE id='new'").run(); noteThumbnail(db, 'new'); }
      else { db.prepare("UPDATE files SET thumb_ready=0 WHERE id='new'").run(); replaceEvictedThumbnailCovers(db, 'new'); }
    });
    await materializeFolders(db, 'lib', () => {});
    const covers = db.prepare("SELECT path,cover_file_id FROM folders WHERE path IN ('lib','lib/00') ORDER BY path").all();
    const expected = action === 'generate' ? 'new' : 'old';
    assert.deepEqual(covers, [{ path: 'lib', cover_file_id: expected }, { path: 'lib/00', cover_file_id: expected }]);
  } finally { db.close(); }
});

for (const reason of ['cancel', 'lease'] as const) test(`目录统计让出时${reason === 'cancel' ? '取消' : '失去租约'}会停止写入`, async () => {
  const db = openDatabase(':memory:'); const controller = new AbortController(); let valid = true;
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/a')").run();
    const insert = db.prepare("INSERT INTO folders(path,library_id,parent,name,media_count) VALUES (?,'lib',NULL,?,7)");
    for (let i = 0; i < 32; i++) insert.run(`lib/${i}`, `${i}`);
    setImmediate(() => { if (reason === 'cancel') controller.abort(); else valid = false; });
    await assert.rejects(materializeFolders(db, 'lib', () => { if (!valid) throw new Error('失去租约'); }, controller.signal));
    assert.equal((db.prepare('SELECT count(*) AS n FROM folders WHERE media_count<>7').get() as { n: number }).n, 0);
  } finally { db.close(); }
});

test('旧封面已移出子树且计算期间生成新缩略图时，目录保留新封面', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/a')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'root')").run();
    const folder = db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES (?,'lib','lib',?)");
    for (let i = 0; i < 20; i++) folder.run(`lib/${String(i).padStart(2, '0')}`, `${i}`);
    const file = db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,thumb_ready) VALUES (?,'lib',?,?,?,'image/jpeg','image',1,1,?,'mtime',?)");
    file.run('moved', 'moved.jpg', 'lib/01', 'moved.jpg', 20, 1);
    file.run('new', 'new.jpg', 'lib/00', 'new.jpg', 10, 0);
    db.prepare("UPDATE folders SET cover_file_id='moved' WHERE path='lib/00'").run();
    setImmediate(() => { db.prepare("UPDATE files SET thumb_ready=1 WHERE id='new'").run(); noteThumbnail(db, 'new'); });
    await materializeFolders(db, 'lib', () => {});
    assert.equal((db.prepare("SELECT cover_file_id FROM folders WHERE path='lib/00'").get() as { cover_file_id: string | null }).cover_file_id, 'new');
  } finally { db.close(); }
});

test('目录统计与新缩略图并发时保留子树中拍摄时间最新的封面', async () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片','/a')").run();
    db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES ('lib','lib',NULL,'root')").run();
    const folder = db.prepare("INSERT INTO folders(path,library_id,parent,name) VALUES (?,'lib','lib',?)");
    for (let i = 0; i < 20; i++) folder.run(`lib/${String(i).padStart(2, '0')}`, `${i}`);
    const file = db.prepare("INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,thumb_ready) VALUES (?,'lib',?,'lib/00',?,'image/jpeg','image',1,1,?,'mtime',?)");
    file.run('old','old.jpg','old.jpg',10,1); file.run('best','best.jpg','best.jpg',30,1); file.run('new','new.jpg','new.jpg',20,0);
    db.prepare("UPDATE folders SET cover_file_id='old' WHERE path='lib/00'").run();
    setImmediate(() => { db.prepare("UPDATE files SET thumb_ready=1 WHERE id='new'").run(); noteThumbnail(db, 'new'); });
    await materializeFolders(db, 'lib', () => {});
    assert.equal((db.prepare("SELECT cover_file_id FROM folders WHERE path='lib/00'").get() as { cover_file_id: string | null }).cover_file_id, 'best');
  } finally { db.close(); }
});
