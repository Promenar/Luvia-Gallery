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
  await mkdir(mount); await mkdir(photos); await mkdir(path.join(photos, 'child')); await mkdir(outside); await symlink(outside, path.join(mount, 'escape'));
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
    const listed = await app.inject({ method: 'GET', url: '/api/v2/admin/libraries', headers: { cookie } });
    assert.deepEqual(listed.json().libraries.map((item: { id: string }) => item.id), [library.id]);
    const filesystem = await app.inject({ method: 'GET', url: `/api/v2/admin/fs?path=${encodeURIComponent(photos)}`, headers: { cookie } });
    assert.equal(filesystem.statusCode, 200); assert.deepEqual(filesystem.json().dirs.map((item: { name: string }) => item.name), ['child']);
    assert.equal((await app.inject({ method: 'GET', url: `/api/v2/admin/fs?path=${encodeURIComponent(outside)}`, headers: { cookie } })).statusCode, 400);
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
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/v2/admin/libraries/${library.id}`, headers })).statusCode, 204);
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/v2/admin/libraries', headers: { cookie } })).json().libraries, []);
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

test('媒体库监控设置持久保存并在接口返回', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'luvia-watch-settings-'));
  const db = openDatabase(':memory:');
  const app = await createApp({ db, legacyPending: false, mounts: async () => [{ containerPath: base, hostPath: null, kind: 'candidate', libraryId: null, readOnly: true, mediaEstimate: null }], systemRoots: [] });
  try {
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!; const headers = { cookie, 'x-luvia-request': '1' };
    const response = await app.inject({ method: 'POST', url: '/api/v2/admin/libraries', headers, payload: { name: '照片', root: base, watch: { mode: 'poll', pollIntervalSec: 90 } } });
    assert.equal(response.statusCode, 200); const created = Library.parse(response.json());
    assert.equal(created.watch.mode, 'poll'); assert.equal(created.watch.pollIntervalSec, 90);
    const updated = await app.inject({ method: 'PATCH', url: `/api/v2/admin/libraries/${created.id}`, headers, payload: { watch: { mode: 'off' } } });
    assert.equal(updated.statusCode, 200); assert.equal(Library.parse(updated.json()).watch.mode, 'off');
    const list = await app.inject({ method: 'GET', url: '/api/v2/admin/libraries', headers });
    assert.equal(Library.parse(list.json().libraries[0]).watch.pollIntervalSec, 90);
  } finally { await app.close(); db.close(); await rm(base, { recursive: true, force: true }); }
});

test('媒体库接口返回持有租约的运行状态及成功对账时间', async () => {
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    db.prepare("INSERT INTO libraries(id,name,root,last_scan_at,watch_mode) VALUES ('lib','照片','/lib',1700000000,'watch')").run();
    db.prepare("INSERT INTO library_watch_state(library_id,state,watched_dirs,last_event_at,degraded_reason) VALUES ('lib','watching',12,'2026-01-01T00:00:00.000Z',NULL)").run();
    db.prepare("INSERT INTO watch_leases VALUES ('lib','worker','token',unixepoch()+30)").run();
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const res = await app.inject({ method: 'GET', url: '/api/v2/admin/libraries', headers: { cookie } });
    const watch = Library.parse(res.json().libraries[0]).watch;
    assert.equal(watch.state, 'watching'); assert.equal(watch.watchedDirs, 12); assert.equal(watch.lastEventAt, '2026-01-01T00:00:00.000Z');
    assert.equal(watch.lastReconcileAt, new Date(1700000000 * 1000).toISOString());
    db.prepare("UPDATE watch_leases SET lease_expires_at=0 WHERE library_id='lib'").run();
    const stale = await app.inject({ method: 'GET', url: '/api/v2/admin/libraries', headers: { cookie } });
    assert.equal(Library.parse(stale.json().libraries[0]).watch.state, 'starting');
  } finally { await app.close(); db.close(); }
});
