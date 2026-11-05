import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { DownloadTicket } from '@luvia/contracts';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';

test('下载票据只能使用一次，ZIP 包含授权媒体且权限变化后失效', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-downloads-')); const output = await mkdtemp(path.join(tmpdir(), 'luvia-zip-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    await sharp({ create: { width: 16, height: 12, channels: 3, background: '#789' } }).jpeg().toFile(path.join(root, 'one.jpg'));
    await sharp({ create: { width: 16, height: 12, channels: 3, background: '#456' } }).jpeg().toFile(path.join(root, 'two.jpg'));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const ids = db.prepare('SELECT id,name FROM files ORDER BY name').all() as { id: string; name: string }[];
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!; const headers = { cookie, 'x-luvia-request': '1' };
    const issue = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/v2/downloads', headers, payload });
    assert.equal((await issue({ ids: ['not-found'] })).statusCode, 403);
    const issued = await issue({ ids: [ids[0]!.id, ids[1]!.id] });
    assert.equal(issued.statusCode, 200);
    const ticket = DownloadTicket.parse(issued.json());
    assert.equal((await app.inject({ method: 'GET', url: ticket.url })).statusCode, 401);
    const response = await app.inject({ method: 'GET', url: ticket.url, headers: { cookie } });
    assert.equal(response.statusCode, 200); assert.match(String(response.headers['content-type']), /^application\/zip/);
    const zip = path.join(output, 'fixture.zip'); await writeFile(zip, response.rawPayload);
    const listing = await promisify(execFile)('unzip', ['-Z1', zip]);
    assert.deepEqual(listing.stdout.trim().split('\n').sort(), ['lib/one.jpg', 'lib/two.jpg']);
    const zipInfo = await promisify(execFile)('unzip', ['-v', zip]); assert.match(zipInfo.stdout, /Stored/);
    assert.equal((await app.inject({ method: 'GET', url: ticket.url, headers: { cookie } })).statusCode, 404);
    const second = DownloadTicket.parse((await issue({ ids: [ids[0]!.id] })).json());
    db.prepare("UPDATE users SET role='user',allowed_paths=? WHERE username='admin'").run(JSON.stringify(['lib/private']));
    assert.equal((await app.inject({ method: 'GET', url: second.url, headers: { cookie } })).statusCode, 403);
    db.prepare("UPDATE users SET role='admin',allowed_paths=NULL WHERE username='admin'").run();
    const concurrent = DownloadTicket.parse((await issue({ folder: 'lib' })).json());
    const attempts = await Promise.all([app.inject({ method: 'GET', url: concurrent.url, headers: { cookie } }), app.inject({ method: 'GET', url: concurrent.url, headers: { cookie } })]);
    assert.deepEqual(attempts.map((result) => result.statusCode).sort(), [200, 404]);
    const album = await app.inject({ method: 'POST', url: '/api/v2/albums', headers, payload: { name: '单张', ids: [ids[0]!.id] } });
    const albumTicket = DownloadTicket.parse((await issue({ albumId: album.json().id })).json());
    const albumZip = await app.inject({ method: 'GET', url: albumTicket.url, headers: { cookie } });
    assert.equal(albumZip.statusCode, 200);
    const albumFile = path.join(output, 'album.zip'); await writeFile(albumFile, albumZip.rawPayload);
    assert.equal((await promisify(execFile)('unzip', ['-Z1', albumFile])).stdout.trim(), 'lib/one.jpg');
    const expired = DownloadTicket.parse((await issue({ ids: [ids[0]!.id] })).json());
    db.prepare('UPDATE download_tickets SET expires_at=1').run();
    assert.equal((await app.inject({ method: 'GET', url: expired.url, headers: { cookie } })).statusCode, 404);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(output, { recursive: true, force: true }); }
});

test('每用户 ZIP 并发上限保护票据并在下载结束后释放', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-zip-limit-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  try {
    await writeFile(path.join(root, 'large.jpg'), Buffer.alloc(4 * 1024 * 1024, 42));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const { id } = db.prepare('SELECT id FROM files').get() as { id: string };
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    await app.inject({ method: 'POST', url: '/api/v2/admin/users', headers: { cookie, 'x-luvia-request': '1' }, payload: { username: 'other', password: 'test password' } });
    const otherLogin = await app.inject({ method: 'POST', url: '/api/v2/auth/login', payload: { username: 'other', password: 'test password' } });
    const otherCookie = (otherLogin.headers['set-cookie'] as string).split(';')[0]!;
    const tickets: string[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({ method: 'POST', url: '/api/v2/downloads', headers: { cookie, 'x-luvia-request': '1' }, payload: { ids: [id] } });
      tickets.push(response.json().url);
    }
    const otherTicket = await app.inject({ method: 'POST', url: '/api/v2/downloads', headers: { cookie: otherCookie, 'x-luvia-request': '1' }, payload: { ids: [id] } });
    const results = await Promise.all([...tickets.map((url) => app.inject({ method: 'GET', url, headers: { cookie } })),
      app.inject({ method: 'GET', url: otherTicket.json().url, headers: { cookie: otherCookie } })]);
    const responses = results.slice(0, 3);
    assert.equal(results[3]!.statusCode, 200);
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 200, 429]);
    const rejected = responses.findIndex((response) => response.statusCode === 429);
    assert.equal((await app.inject({ method: 'GET', url: tickets[rejected]!, headers: { cookie } })).statusCode, 200);
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});

test('ZIP 客户端中断后回收并发名额', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-zip-abort-'));
  const db = openDatabase(':memory:'); const app = await createApp({ db, legacyPending: false });
  const controllers = Array.from({ length: 3 }, () => new AbortController());
  try {
    await writeFile(path.join(root, 'large.jpg'), Buffer.alloc(4 * 1024 * 1024, 42));
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','照片',?)").run(root);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    const { id } = db.prepare('SELECT id FROM files').get() as { id: string };
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    const tickets: string[] = [];
    for (let i = 0; i < 3; i++) {
      const response = await app.inject({ method: 'POST', url: '/api/v2/downloads', headers: { cookie, 'x-luvia-request': '1' }, payload: { ids: [id] } });
      tickets.push(response.json().url);
    }
    for (let i = 0; i < 2; i++) {
      const response = await app.inject({ method: 'GET', url: tickets[i]!, headers: { cookie }, payloadAsStream: true, signal: controllers[i]!.signal });
      assert.equal(response.statusCode, 200); response.stream().on('error', () => {});
    }
    assert.equal((await app.inject({ method: 'GET', url: tickets[2]!, headers: { cookie } })).statusCode, 429);
    controllers[0]!.abort();
    let status = 429;
    for (let i = 0; i < 50 && status === 429; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const response = await app.inject({ method: 'GET', url: tickets[2]!, headers: { cookie }, payloadAsStream: true, signal: controllers[2]!.signal });
      status = response.statusCode; response.stream().on('error', () => {});
    }
    assert.equal(status, 200);
  } finally { for (const controller of controllers) controller.abort(); await app.close(); db.close(); await rm(root, { recursive: true, force: true }); }
});
