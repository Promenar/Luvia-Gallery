import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/core/database.ts';
import { FolderReader } from '../src/core/folder-reader.ts';

test('文件夹列表返回文件系统目录时间，并对仅获子目录权限的父级隐藏时间', () => {
  const db = openDatabase(':memory:');
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','库','/fixture')").run();
    db.prepare(`INSERT INTO folders(path,library_id,parent,name,mtime_ms) VALUES
      ('lib','lib',NULL,'库',1000),('lib/a','lib','lib','a',2000),('lib/a/deep','lib','lib/a','deep',3000)`).run();
    const reader = new FolderReader(db);
    const admin = { id: 'u', allowedPaths: null, isAdmin: true };
    assert.equal(reader.list('lib', admin)?.folders[0]?.modifiedAt, new Date(2000).toISOString());
    const restricted = { id: 'u', allowedPaths: ['lib/a/deep'], isAdmin: false };
    assert.equal(reader.list('lib', restricted)?.folders[0]?.modifiedAt, null);
    assert.equal(reader.list('lib/a', restricted)?.folders[0]?.modifiedAt, new Date(3000).toISOString());
  } finally { db.close(); }
});
