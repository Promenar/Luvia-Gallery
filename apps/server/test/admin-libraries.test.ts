import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AdminSettings, Library, MountList } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';

test('媒体库只能建立在检测到的挂载内，宿主路径遵循手动优先', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'luvia-admin-'));
  const mount = path.join(base, 'mount'); const photos = path.join(mount, 'photos'); const outside = path.join(base, 'outside');
  await mkdir(mount); await mkdir(photos); await mkdir(outside); await symlink(outside, path.join(mount, 'escape'));
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false, mounts: async () => [{ containerPath: mount, hostPath: '/volume/archive', kind: 'candidate', libraryId: null, readOnly: true, mediaEstimate: null }], systemRoots: [] });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const headers = { cookie, 'x-luvia-request': '1' };
    const create = (root: string) => app.inject({ method: 'POST', url: '/api/v2/admin/libraries', headers, payload: { name: '照片', root } });
    assert.equal((await create(outside)).statusCode, 400);
    assert.equal((await create(path.join(mount, 'escape'))).statusCode, 400);
    const response = await create(photos);
    assert.equal(response.statusCode, 200);
    const library = Library.parse(response.json());
    assert.equal(library.hostRoot, '/volume/archive/photos');
    assert.equal(library.hostRootSource, 'auto');
    assert.deepEqual(library.exclude, ['@eaDir', '#recycle', '.*', '.thumbnails']);
    const patched = await app.inject({ method: 'PATCH', url: `/api/v2/admin/libraries/${library.id}`, headers, payload: { hostRoot: '/manual/photos' } });
    assert.equal(Library.parse(patched.json()).hostRootSource, 'manual');
    const reset = await app.inject({ method: 'PATCH', url: `/api/v2/admin/libraries/${library.id}`, headers, payload: { hostRoot: null } });
    assert.equal(Library.parse(reset.json()).hostRoot, '/volume/archive/photos');
    db.prepare("INSERT INTO settings(key,value) VALUES('mount.estimates',?)").run(JSON.stringify({ [mount]: 7 }));
    const detected = MountList.parse((await app.inject({ method: 'GET', url: '/api/v2/admin/mounts', headers: { cookie } })).json()).mounts[0];
    assert.equal(detected?.containerPath, mount);
    assert.equal(detected?.mediaEstimate, 7);
  } finally { await app.close(); db.close(); await rm(base, { recursive: true, force: true }); }
});

test('管理设置深度合并并提供安全默认值', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const headers = { cookie, 'x-luvia-request': '1' };
    const initial = AdminSettings.parse((await app.inject({ method: 'GET', url: '/api/v2/admin/settings', headers })).json());
    assert.equal(initial.libraries.autoEnableNewMounts, false); assert.equal(initial.folders.exposeHostPaths, false); assert.equal(initial.publicUrl, null);
    const response = await app.inject({ method: 'PATCH', url: '/api/v2/admin/settings', headers, payload: { publicUrl: 'https://gallery.example', libraries: { autoEnableNewMounts: true }, folders: { exposeHostPaths: true } } });
    assert.equal(response.statusCode, 200);
    const updated = AdminSettings.parse(response.json());
    assert.equal(updated.publicUrl, 'https://gallery.example'); assert.equal(updated.libraries.autoEnableNewMounts, true); assert.equal(updated.folders.exposeHostPaths, true);
    assert.deepEqual(updated.scan, initial.scan);
  } finally { await app.close(); db.close(); }
});
