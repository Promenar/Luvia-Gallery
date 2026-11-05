import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

for (const phase of ['realpath', 'open'] as const) test(`原文件在 ${phase} 等待期间撤销会话后不返回内容`, async () => {
  const root = fileURLToPath(new URL('./fixtures', import.meta.url));
  const filename = path.join(root, 'synthetic.heic'); const info = await fs.promises.stat(filename);
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  const original = fs.promises[phase]; let release!: () => void; let entered!: () => void; let armed = true;
  const blocked = new Promise<void>((resolve) => { release = resolve; }); const reached = new Promise<void>((resolve) => { entered = resolve; });
  try {
    db.prepare('INSERT INTO libraries(id,name,root) VALUES (?,?,?)').run('lib', '合成', root);
    db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source)
      VALUES ('media','lib','synthetic.heic','lib','synthetic.heic','image/heic','image',?,?,?,'mtime')`).run(info.size, Math.floor(info.mtimeMs / 1000), 1);
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    Object.defineProperty(fs.promises, phase, { configurable: true, writable: true, value: async (...args: unknown[]) => {
      const matches = path.resolve(String(args[0])) === (phase === 'realpath' ? root : filename);
      if (armed && matches) { armed = false; entered(); await blocked; }
      return Reflect.apply(original, fs.promises, args);
    } });
    syncBuiltinESMExports();
    const response = app.inject({ method: 'GET', url: '/api/v2/media/media/original', headers: { cookie } });
    await Promise.race([reached, new Promise<never>((_resolve, reject) => { const timer = setTimeout(() => reject(new Error('未进入测试屏障')), 3000); timer.unref(); })]);
    db.prepare('DELETE FROM sessions').run(); release();
    assert.equal((await response).statusCode, 401);
  } finally {
    release(); Object.defineProperty(fs.promises, phase, { configurable: true, writable: true, value: original }); syncBuiltinESMExports();
    await app.close(); db.close();
  }
});
