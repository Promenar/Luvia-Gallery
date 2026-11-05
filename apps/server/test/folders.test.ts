import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FolderListing, FolderTree, FavoriteFolders } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';

test('扫描物化全部目录并排除 NAS 隐藏目录，接口返回层级与收藏', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-folders-'));
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    await mkdir(path.join(root, 'parent', 'child'), { recursive: true });
    await mkdir(path.join(root, 'empty'));
    await mkdir(path.join(root, '@eaDir'));
    await mkdir(path.join(root, '.hidden'));
    await writeFile(path.join(root, 'parent', 'child', 'a.jpg'), 'image');
    await writeFile(path.join(root, '@eaDir', 'bad.jpg'), 'image');
    await writeFile(path.join(root, '.hidden', 'bad.jpg'), 'image');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const top = await app.inject({ method: 'GET', url: '/api/v2/folders', headers: { cookie } });
    assert.equal(top.statusCode, 200);
    const rootEntry = FolderListing.parse(top.json()).folders[0]!;
    assert.equal(rootEntry.path, 'lib'); assert.equal(rootEntry.mediaCount, 1); assert.equal(rootEntry.childCount, 2);
    const listing = await app.inject({ method: 'GET', url: '/api/v2/folders?path=lib', headers: { cookie } });
    const folderList = FolderListing.parse(listing.json());
    assert.deepEqual(folderList.folders.map((folder) => folder.name), ['empty', 'parent']);
    assert.equal(folderList.folders[1]?.mediaCount, 1);
    assert.equal(folderList.folders[1]?.childCount, 1);
    const tree = await app.inject({ method: 'GET', url: '/api/v2/folders/tree?path=lib%2Fparent', headers: { cookie } });
    assert.equal(FolderTree.parse(tree.json()).nodes[0]?.path, 'lib/parent/child');
    const fav = await app.inject({ method: 'PUT', url: '/api/v2/folders/favorite', headers: { cookie, 'x-luvia-request': '1' }, payload: { path: 'lib/parent', favorite: true } });
    assert.equal(fav.statusCode, 200);
    const favorites = await app.inject({ method: 'GET', url: '/api/v2/folders/favorites', headers: { cookie } });
    assert.equal(FavoriteFolders.parse(favorites.json()).folders[0]?.path, 'lib/parent');
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('受限用户的祖先目录统计与宿主机路径遵守权限设置', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-folder-access-'));
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false });
  try {
    await mkdir(path.join(root, 'allowed')); await mkdir(path.join(root, 'private'));
    await writeFile(path.join(root, 'allowed', 'a.jpg'), 'a');
    await writeFile(path.join(root, 'private', 'b.jpg'), 'b');
    db.prepare("INSERT INTO libraries(id,name,root,host_root,host_root_source) VALUES ('lib','照片',?,'/volume/photos','manual')").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const admin = FolderListing.parse((await app.inject({ method: 'GET', url: '/api/v2/folders?path=lib', headers: { cookie } })).json());
    assert.equal(admin.hostPath, '/volume/photos');
    assert.equal(admin.hostRoot, '/volume/photos');
    db.prepare("UPDATE users SET role='user',allowed_paths=? WHERE username='admin'").run(JSON.stringify(['lib/allowed']));
    const rootList = FolderListing.parse((await app.inject({ method: 'GET', url: '/api/v2/folders', headers: { cookie } })).json());
    assert.equal(rootList.folders[0]?.mediaCount, 1);
    assert.equal(rootList.folders[0]?.childCount, 1);
    assert.equal(rootList.folders[0]?.hostPath, null);
    const limited = FolderListing.parse((await app.inject({ method: 'GET', url: '/api/v2/folders?path=lib', headers: { cookie } })).json());
    assert.deepEqual(limited.folders.map((item) => item.name), ['allowed']);
    assert.equal(limited.hostPath, null); assert.equal(limited.hostRoot, null);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/v2/folders/favorite', headers: { cookie, 'x-luvia-request': '1' }, payload: { path: 'lib/private', favorite: true } })).statusCode, 403);
    db.prepare("INSERT INTO settings(key,value) VALUES ('folders.exposeHostPaths','true')").run();
    const enabled = FolderListing.parse((await app.inject({ method: 'GET', url: '/api/v2/folders?path=lib', headers: { cookie } })).json());
    assert.equal(enabled.hostRoot, '/volume/photos');
    assert.equal(enabled.folders[0]?.hostPath, '/volume/photos/allowed');
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('v1 祖先目录只暴露受限用户有权查看的统计', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-v1-ancestor-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    await mkdir(path.join(root, 'allowed'));
    await writeFile(path.join(root, 'private-a.jpg'), 'a');
    await writeFile(path.join(root, 'private-b.jpg'), 'b');
    await writeFile(path.join(root, 'allowed', 'visible.jpg'), 'c');
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare("UPDATE files SET modified_at=200 WHERE folder='lib'").run();
    db.prepare("UPDATE files SET modified_at=100 WHERE folder='lib/allowed'").run();
    db.prepare("UPDATE folders SET latest_at=200 WHERE path='lib'").run();
    db.prepare("UPDATE folders SET latest_at=100 WHERE path='lib/allowed'").run();
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const admin = (await app.inject({ method: 'GET', url: '/api/library/folders', headers: { cookie } })).json().folders[0];
    assert.equal(admin.mediaCount, 2); assert.equal(admin.lastModified, 200);
    db.prepare("UPDATE users SET role='user',allowed_paths=? WHERE username='admin'").run(JSON.stringify(['lib/allowed']));
    const limited = (await app.inject({ method: 'GET', url: '/api/library/folders', headers: { cookie } })).json().folders[0];
    assert.deepEqual({ mediaCount: limited.mediaCount, lastModified: limited.lastModified }, { mediaCount: 1, lastModified: 100 });
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});
