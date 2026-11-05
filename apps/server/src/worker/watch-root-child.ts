import Database from 'better-sqlite3';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { confirmLibraryMount } from '../watch/root-guard.ts';

type Request = { kind: 'allowed' | 'confirm'; root: string; allowedRoots: string[]; database: string; libraryId: string; owner: string; token: string };

process.once('message', (message: Request) => {
  void (async () => {
    if (message.kind === 'allowed') {
      const actual = await realpath(message.root).catch(() => path.resolve(message.root));
      const roots = await Promise.all(message.allowedRoots.map((root) => realpath(root).catch(() => path.resolve(root))));
      return roots.some((root) => { const rel = path.relative(root, actual); return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)); });
    }
    const db = new Database(message.database);
    try {
      return await confirmLibraryMount(db, { id: message.libraryId, root: message.root }, { allowedRoots: message.allowedRoots,
        assertLease: () => {
          if (!db.prepare('SELECT 1 FROM watch_leases WHERE library_id=? AND owner=? AND token=? AND lease_expires_at>unixepoch()')
            .get(message.libraryId, message.owner, message.token)) throw new Error('监控租约已失效');
        } });
    } finally { db.close(); }
  })().then((result) => { process.send?.({ result }, () => process.exit(0)); }, () => { process.send?.({ error: true }, () => process.exit(1)); });
});
