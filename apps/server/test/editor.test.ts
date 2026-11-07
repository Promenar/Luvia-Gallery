import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { openDatabase } from '../src/core/database.ts';
import { scanLibrary } from '../src/worker/scan.ts';
import { extractMetadataNow } from '../src/worker/metadata.ts';
import { randomBytes } from 'node:crypto';
import { editorConfig, runInference } from '../src/editor/service.ts';

type FileRow = { id: string; size: number; modified_at: number; cache_generation: number };

async function startStub() {
  let delayInpaint = false;
  let echoSource = false;
  let lossyEcho = false;
  let nativeMaxPixels = 40_000_000;
  const inputSizes: Array<{ width: number; height: number }> = [];
  let requestBody = Buffer.alloc(0);
  let lastResponse = Buffer.alloc(0);
  let result: Buffer = await sharp({ create: { width: 10, height: 8, channels: 3, background: '#dddddd' } }).png().toBuffer();
  const server = createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ models: [
        { id: 'migan', available: true, device: 'cpu', maxPixels: nativeMaxPixels, features: ['mask'] },
        { id: 'lama', available: false, reason: '未安装权重', device: null, maxPixels: null, features: ['mask'] },
        { id: 'slbr', available: true, device: 'cpu', maxPixels: 40_000_000, features: ['mask', 'detect'] },
      ] }));
      return;
    }
    if (req.url?.startsWith('/v1/inpaint')) {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        requestBody = Buffer.concat(chunks);
        let response = result;
        if (echoSource) {
          const marker = Buffer.from('Content-Disposition: form-data; name="image"; filename="source"\r\nContent-Type: application/octet-stream\r\n\r\n');
          const start = requestBody.indexOf(marker) + marker.length;
          const boundary = req.headers['content-type']!.split('boundary=')[1]!;
          const end = requestBody.indexOf(Buffer.from(`\r\n--${boundary}`), start);
          const bytes = requestBody.subarray(start, end);
          const meta = await sharp(bytes).metadata();
          inputSizes.push({ width: meta.width!, height: meta.height! });
          const maskMarker = Buffer.from('Content-Disposition: form-data; name="mask"; filename="mask.png"\r\nContent-Type: image/png\r\n\r\n');
          const maskStart = requestBody.indexOf(maskMarker) + maskMarker.length;
          const maskEnd = requestBody.indexOf(Buffer.from(`\r\n--${boundary}`), maskStart);
          const selected = await sharp(requestBody.subarray(maskStart, maskEnd)).removeAlpha().greyscale().raw().toBuffer();
          const pixels = await sharp(bytes).ensureAlpha().raw().toBuffer();
          for (let i = 0; i < selected.length; i++) if (selected[i]! > 127) {
            pixels[i * 4] = 200; pixels[i * 4 + 1] = 100; pixels[i * 4 + 2] = 50;
          }
          response = lossyEcho ? await sharp(bytes).jpeg({ quality: 40 }).toBuffer()
            : await sharp(pixels, { raw: { width: meta.width!, height: meta.height!, channels: 4 } }).png().toBuffer();
        }
        lastResponse = Buffer.from(response);
        const finish = () => { res.setHeader('content-type', 'image/png'); res.end(response); };
        if (delayInpaint) setTimeout(finish, 500); else finish();
      });
      return;
    }
    if (req.url?.startsWith('/v1/cancel/')) { res.statusCode = 204; res.end(); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    getRequest: () => requestBody,
    getResponse: () => lastResponse,
    setDelay: (value: boolean) => { delayInpaint = value; },
    setResult: (value: Buffer) => { result = value; },
    setEchoSource: () => { echoSource = true; },
    setLossyEcho: () => { echoSource = true; lossyEcho = true; },
    setMaxPixels: (value: number) => { nativeMaxPixels = value; },
    inputSizes,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function setup(serviceUrl: string) {
  process.env.EDITOR_SERVICE_URL = serviceUrl;
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-editor-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-editor-cache-'));
  const db = openDatabase(':memory:');
  const { createApp } = await import('../src/api/app.ts');
  const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  const created = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
  const headers = { cookie: (created.headers['set-cookie'] as string).split(';')[0]!, 'x-luvia-request': '1' };
  await writeFile(path.join(root, 'photo.jpg'), await sharp({ create: { width: 10, height: 8, channels: 3, background: '#999999' } }).jpeg().toBuffer());
  db.prepare("INSERT INTO libraries(id,name,root) VALUES ('lib','测试',?)").run(root);
  await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
  db.prepare("UPDATE files SET width=10,height=8,mime='image/jpeg',media_type='image'").run();
  const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as FileRow;
  return { root, cache, db, app, headers, row };
}

const sourceOf = (row: FileRow) => ({ size: row.size, modifiedAt: row.modified_at, generation: row.cache_generation });
const maskOf = async () => {
  const data = await sharp({ create: { width: 10, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer();
  return { data: data.toString('base64'), width: 10, height: 8 };
};

async function waitForJob(app: Awaited<ReturnType<typeof setup>>['app'], headers: Record<string, string>, id: string) {
  for (let i = 0; i < 100; i++) {
    const res = await app.inject({ method: 'GET', url: `/api/v2/editor/jobs/${id}`, headers });
    assert.equal(res.statusCode, 200, res.body);
    const job = res.json();
    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') return job;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('等待修复作业超时');
}

test('能力探测只暴露真实可用的模型', async () => {
  const stub = await startStub();
  const { root, cache, db, app, headers } = await setup(stub.url);
  try {
    const res = await app.inject({ method: 'GET', url: '/api/v2/editor/capabilities', headers });
    assert.equal(res.statusCode, 200, res.body);
    const caps = res.json();
    assert.equal(caps.models.find((m: { id: string }) => m.id === 'migan').available, true, res.body);
    assert.equal(caps.models.find((m: { id: string }) => m.id === 'lama').available, false);
    assert.equal(caps.models.find((m: { id: string }) => m.id === 'lama').reason, '未安装权重');
    assert.equal(caps.models.find((m: { id: string }) => m.id === 'slbr').features.includes('detect'), true);
    assert.equal(caps.mask.maxEdge > 0, true);
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('超过四千万像素的图片按蒙版分块推理并生成原尺寸预览', async () => {
  const stub = await startStub();
  stub.setEchoSource();
  const { root, cache, db, app, headers } = await setup(stub.url);
  try {
    const original = await sharp({ create: { width: 8000, height: 5100, channels: 3, background: '#768696' } }).jpeg().toBuffer();
    await writeFile(path.join(root, 'photo.jpg'), original);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare('UPDATE files SET width=8000,height=5100').run();
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as FileRow;
    const white = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#fff' } }).png().toBuffer();
    const mask = await sharp({ create: { width: 800, height: 510, channels: 3, background: '#000' } })
      .composite([{ input: white, left: 5, top: 5 }, { input: white, left: 780, top: 490 }]).png().toBuffer();
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: { data: mask.toString('base64'), width: 800, height: 510 } } });
    assert.equal(created.statusCode, 200, created.body);
    let job;
    for (let i = 0; i < 600; i++) {
      job = (await app.inject({ method: 'GET', url: `/api/v2/editor/jobs/${created.json().id}`, headers })).json();
      if (['succeeded', 'failed', 'cancelled'].includes(job.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(job.status, 'succeeded', JSON.stringify(job));
    assert.equal(stub.inputSizes.length, 2);
    assert.ok(stub.inputSizes.every((size) => size.width <= 1280 && size.height <= 1280));
    const result = await app.inject({ method: 'GET', url: job.resultUrl, headers });
    const meta = await sharp(result.rawPayload).metadata();
    assert.deepEqual([meta.width, meta.height], [8000, 5100]);
    const fixedPixel = await sharp(result.rawPayload).extract({ left: 60, top: 60, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    const untouchedPixel = await sharp(result.rawPayload).extract({ left: 4000, top: 2500, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    const originalPixel = await sharp(original).extract({ left: 4000, top: 2500, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.deepEqual([...fixedPixel], [200, 100, 50]);
    assert.deepEqual(untouchedPixel, originalPixel);
    assert.deepEqual(await readFile(path.join(root, 'photo.jpg')), original);
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('分块修复按 EXIF 方向映射蒙版并保留透明通道', async () => {
  const stub = await startStub();
  stub.setEchoSource();
  stub.setMaxPixels(1_638_400);
  const { root, cache, db, app, headers } = await setup(stub.url);
  try {
    const original = await sharp({ create: { width: 2000, height: 1000, channels: 4, background: { r: 60, g: 90, b: 120, alpha: 0.25 } } })
      .png().withMetadata({ orientation: 6 }).toBuffer();
    await writeFile(path.join(root, 'photo.jpg'), original);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare('UPDATE files SET width=1000,height=2000').run();
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as FileRow;
    const white = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#fff' } }).png().toBuffer();
    const mask = await sharp({ create: { width: 100, height: 200, channels: 3, background: '#000' } })
      .composite([{ input: white, left: 10, top: 20 }]).png().toBuffer();
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: { data: mask.toString('base64'), width: 100, height: 200 } } });
    assert.equal(created.statusCode, 200, created.body);
    const job = await waitForJob(app, headers, created.json().id);
    assert.equal(job.status, 'succeeded', JSON.stringify(job));
    const result = await app.inject({ method: 'GET', url: job.resultUrl!, headers });
    const meta = await sharp(result.rawPayload).metadata();
    assert.deepEqual([meta.width, meta.height, meta.hasAlpha], [1000, 2000, true]);
    const fixedPixel = await sharp(result.rawPayload).extract({ left: 110, top: 210, width: 1, height: 1 }).raw().toBuffer();
    assert.deepEqual([...fixedPixel], [200, 100, 50, 64]);
    const untouched = await sharp(result.rawPayload).extract({ left: 500, top: 1500, width: 1, height: 1 }).raw().toBuffer();
    const expected = await sharp(original).rotate().extract({ left: 500, top: 1500, width: 1, height: 1 }).raw().toBuffer();
    assert.deepEqual(untouched, expected);
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('透明广色域图片的未选区域保持原像素', async () => {
  const stub = await startStub();
  stub.setEchoSource();
  stub.setMaxPixels(1_638_400);
  const { root, cache, db, app, headers } = await setup(stub.url);
  try {
    const width = 2000, height = 1000;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = x % 256; pixels[i + 1] = y % 256; pixels[i + 2] = (x + y) % 256; pixels[i + 3] = 16 + (x * 7 + y) % 240;
    }
    const original = await sharp(pixels, { raw: { width, height, channels: 4 } }).withIccProfile('p3').png().toBuffer();
    await writeFile(path.join(root, 'photo.jpg'), original);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare('UPDATE files SET width=2000,height=1000').run();
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as FileRow;
    const white = await sharp({ create: { width: 3, height: 3, channels: 3, background: '#fff' } }).png().toBuffer();
    const mask = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#000' } })
      .composite([{ input: white, left: 10, top: 10 }]).png().toBuffer();
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: { data: mask.toString('base64'), width: 200, height: 100 } } });
    assert.equal(created.statusCode, 200, created.body);
    const job = await waitForJob(app, headers, created.json().id);
    assert.equal(job.status, 'succeeded', JSON.stringify(job));
    const result = await app.inject({ method: 'GET', url: job.resultUrl!, headers });
    for (const left of [600, 1500]) {
      const rect = { left, top: 500, width: 50, height: 50 };
      assert.deepEqual(await sharp(result.rawPayload).extract(rect).raw().toBuffer(), await sharp(original).extract(rect).raw().toBuffer());
    }
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('透明白色蒙版背景不会触发额外分块', async () => {
  const stub = await startStub();
  stub.setEchoSource();
  stub.setMaxPixels(1_638_400);
  const { root, cache, db, app, headers } = await setup(stub.url);
  try {
    const original = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#789' } }).png().toBuffer();
    await writeFile(path.join(root, 'photo.jpg'), original);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare('UPDATE files SET width=3000,height=1000').run();
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as FileRow;
    const white = await sharp({ create: { width: 3, height: 3, channels: 4, background: '#fff' } }).png().toBuffer();
    const mask = await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
      .composite([{ input: white, left: 250, top: 50 }]).png().toBuffer();
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: { data: mask.toString('base64'), width: 300, height: 100 } } });
    assert.equal(created.statusCode, 200, created.body);
    const job = await waitForJob(app, headers, created.json().id);
    assert.equal(job.status, 'succeeded', JSON.stringify(job));
    assert.equal(stub.inputSizes.length, 1);
    const result = await app.inject({ method: 'GET', url: job.resultUrl!, headers });
    assert.deepEqual([...await sharp(result.rawPayload).extract({ left: 2510, top: 510, width: 1, height: 1 }).raw().toBuffer()], [200, 100, 50]);
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('广色域图片分块只修改蒙版区域，未选区域保持原有色彩', async () => {
  const stub = await startStub();
  stub.setLossyEcho();
  stub.setMaxPixels(1_638_400);
  const { root, cache, db, app, headers } = await setup(stub.url);
  try {
    const original = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: { r: 240, g: 25, b: 11 } } })
      .withIccProfile('p3').png().toBuffer();
    await writeFile(path.join(root, 'photo.jpg'), original);
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare('UPDATE files SET width=2000,height=1000').run();
    const row = db.prepare('SELECT id,size,modified_at,cache_generation FROM files').get() as FileRow;
    const white = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
    const mask = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#000' } })
      .composite([{ input: white, left: 10, top: 10 }]).png().toBuffer();
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: { data: mask.toString('base64'), width: 200, height: 100 } } });
    assert.equal(created.statusCode, 200, created.body);
    const job = await waitForJob(app, headers, created.json().id);
    assert.equal(job.status, 'succeeded', JSON.stringify(job));
    const result = await app.inject({ method: 'GET', url: job.resultUrl!, headers });
    assert.deepEqual((await sharp(result.rawPayload).metadata()).icc, (await sharp(original).metadata()).icc);
    for (const left of [600, 1500]) {
      const rect = { left, top: 500, width: 1, height: 1 };
      assert.deepEqual(await sharp(result.rawPayload).extract(rect).raw().toBuffer(), await sharp(original).extract(rect).raw().toBuffer());
    }
    const resultPixel = await sharp(result.rawPayload).extract({ left: 110, top: 110, width: 1, height: 1 }).raw().toBuffer();
    const inferencePixel = await sharp(stub.getResponse()).extract({ left: 110, top: 110, width: 1, height: 1 }).raw().toBuffer();
    assert.ok(resultPixel.every((value, i) => Math.abs(value - inferencePixel[i]!) <= 3), `结果色彩 ${resultPixel} 与推理结果 ${inferencePixel} 不一致`);
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('创建修复作业、读取结果并保存副本', async () => {
  const stub = await startStub();
  const { root, cache, db, app, headers, row } = await setup(stub.url);
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: await maskOf() } });
    assert.equal(created.statusCode, 200, created.body);
    const job = await waitForJob(app, headers, created.json().id);
    assert.equal(job.status, 'succeeded', JSON.stringify(job));
    assert.ok(job.resultUrl);

    const result = await app.inject({ method: 'GET', url: job.resultUrl, headers });
    assert.equal(result.statusCode, 200);
    assert.match(String(result.headers['content-type']), /image\/png/);
    assert.ok(result.rawPayload.length > 0);

    const saved = await app.inject({ method: 'POST', url: `/api/v2/editor/jobs/${job.id}/save-copy`, headers,
      payload: { name: 'photo-fixed.png', source: sourceOf(row) } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().status, 'saved');
    assert.ok(saved.json().mediaId);
    const newFile = db.prepare("SELECT id,name,folder,width,height FROM files WHERE name='photo-fixed.png'").get() as { id: string; name: string; folder: string; width: number; height: number };
    assert.equal(newFile.width, 10);
    assert.equal(newFile.height, 8);
    assert.equal(newFile.folder, 'lib');
    assert.ok((await stat(path.join(root, 'photo-fixed.png'))).isFile());
    assert.equal((db.prepare("SELECT direct_media_count FROM folders WHERE path='lib'").get() as { direct_media_count: number }).direct_media_count, 2);
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('蒙版尺寸或宽高比不一致时拒绝创建', async () => {
  const stub = await startStub();
  const { root, cache, db, app, headers, row } = await setup(stub.url);
  try {
    const mask = await maskOf();
    const wrongSize = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: { ...mask, width: 9 } } });
    assert.equal(wrongSize.statusCode, 400);
    assert.equal(wrongSize.json().error.code, 'INVALID_MASK');
    const square = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
    const wrongRatio = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: { data: square.toString('base64'), width: 8, height: 8 } } });
    assert.equal(wrongRatio.statusCode, 400);
    assert.equal(wrongRatio.json().error.code, 'INVALID_MASK');
    const unavailable = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'lama', mask } });
    assert.equal(unavailable.statusCode, 409);
    assert.equal(unavailable.json().error.code, 'MODEL_UNAVAILABLE');
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('运行中的作业可以取消，取消后不产生结果', async () => {
  const stub = await startStub();
  stub.setDelay(true);
  const { root, cache, db, app, headers, row } = await setup(stub.url);
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: await maskOf() } });
    assert.equal(created.statusCode, 200, created.body);
    const id = created.json().id;
    for (let i = 0; i < 40; i++) {
      const job = await app.inject({ method: 'GET', url: `/api/v2/editor/jobs/${id}`, headers });
      if (job.json().status === 'running') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const cancelled = await app.inject({ method: 'POST', url: `/api/v2/editor/jobs/${id}/cancel`, headers });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().status, 'cancelled');
    const result = await app.inject({ method: 'GET', url: `/api/v2/editor/jobs/${id}/result`, headers });
    assert.equal(result.statusCode, 404);
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('推理服务未配置时能力全部不可用，创建作业被拒绝', async () => {
  delete process.env.EDITOR_SERVICE_URL;
  const root = await mkdtemp(path.join(tmpdir(), 'luvia-editor-off-'));
  const cache = await mkdtemp(path.join(tmpdir(), 'luvia-editor-off-cache-'));
  const db = openDatabase(':memory:');
  const { createApp } = await import('../src/api/app.ts');
  const app = await createApp({ db, legacyPending: false, cacheDir: cache });
  const created = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', payload: { username: 'admin', password: 'test password' } });
  const headers = { cookie: (created.headers['set-cookie'] as string).split(';')[0]!, 'x-luvia-request': '1' };
  try {
    const caps = await app.inject({ method: 'GET', url: '/api/v2/editor/capabilities', headers });
    assert.equal(caps.statusCode, 200, caps.body);
    assert.equal(caps.json().models.every((m: { available: boolean }) => !m.available), true);
    assert.equal(caps.json().models[0].reason, '未配置图像修复推理服务');
  } finally { await app.close(); db.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('只读媒体库拒绝保存副本', async () => {
  const stub = await startStub();
  const { root, cache, db, app, headers, row } = await setup(stub.url);
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: await maskOf() } });
    const job = await waitForJob(app, headers, created.json().id);
    await chmod(root, 0o555);
    try {
      const saved = await app.inject({ method: 'POST', url: `/api/v2/editor/jobs/${job.id}/save-copy`, headers,
        payload: { name: 'readonly.png', source: sourceOf(row) } });
      assert.equal(saved.statusCode, 409, saved.body);
      assert.equal(saved.json().error.code, 'MEDIA_READ_ONLY');
    } finally { await chmod(root, 0o755); }
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});


test('拒绝与原图等比例但分辨率降低的推理结果', async () => {
  const stub = await startStub();
  stub.setResult(await sharp({ create: { width: 5, height: 4, channels: 3, background: '#ddd' } }).png().toBuffer());
  const { root, cache, db, app, headers, row } = await setup(stub.url);
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: await maskOf() } });
    const job = await waitForJob(app, headers, created.json().id);
    assert.equal(job.status, 'failed', JSON.stringify(job));
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('保存副本后正常提取元数据不会改变原拍摄时间', async () => {
  const stub = await startStub();
  const { root, cache, db, app, headers, row } = await setup(stub.url);
  try {
    db.prepare("UPDATE files SET taken_at=946684800,taken_at_source='metadata' WHERE id=?").run(row.id);
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: await maskOf() } });
    const job = await waitForJob(app, headers, created.json().id);
    for (const ext of ['png', 'jpg', 'webp']) {
      const saved = await app.inject({ method: 'POST', url: `/api/v2/editor/jobs/${job.id}/save-copy`, headers,
        payload: { name: `dated.${ext}`, source: sourceOf(row) } });
      assert.equal(saved.statusCode, 200, saved.body);
      await extractMetadataNow(db, saved.json().mediaId);
      const copy = db.prepare('SELECT taken_at FROM files WHERE id=?').get(saved.json().mediaId) as { taken_at: number };
      assert.equal(copy.taken_at, 946684800, ext);
    }
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('编辑接口接收能力接口允许的大于 1 MiB 的蒙版', async () => {
  const stub = await startStub();
  const { root, cache, db, app, headers, row } = await setup(stub.url);
  try {
    const data = await sharp(randomBytes(1000 * 800 * 3), { raw: { width: 1000, height: 800, channels: 3 } }).png().toBuffer();
    assert.ok(data.length > 1024 * 1024);
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: { data: data.toString('base64'), width: 1000, height: 800 } } });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal((await waitForJob(app, headers, created.json().id)).status, 'succeeded');
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});


test('推理请求按 EXIF 校正原图方向并使蒙版对应像素空间', async () => {
  const stub = await startStub();
  stub.setResult(await sharp({ create: { width: 8, height: 10, channels: 3, background: '#ddd' } }).png().toBuffer());
  const { root, cache, db, app, headers, row } = await setup(stub.url);
  try {
    const file = path.join(root, 'photo.jpg');
    await writeFile(file, await sharp({ create: { width: 10, height: 8, channels: 3, background: '#999' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer());
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare('UPDATE files SET width=8,height=10 WHERE id=?').run(row.id);
    const fresh = db.prepare('SELECT id,size,modified_at,cache_generation FROM files WHERE id=?').get(row.id) as FileRow;
    const mask = await sharp({ create: { width: 4, height: 5, channels: 3, background: '#fff' } }).png().toBuffer();
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: fresh.id, source: sourceOf(fresh), model: 'migan', mask: { data: mask.toString('base64'), width: 4, height: 5 } } });
    assert.equal(created.statusCode, 200, created.body);
    assert.equal((await waitForJob(app, headers, created.json().id)).status, 'succeeded');
    const body = stub.getRequest();
    const part = (name: string) => {
      const start = body.indexOf(Buffer.from(`name="${name}";`));
      const dataStart = body.indexOf(Buffer.from('\r\n\r\n'), start) + 4;
      const end = body.indexOf(Buffer.from('\r\n------luvia-'), dataStart);
      assert.ok(start >= 0 && dataStart >= 4 && end > dataStart);
      return body.subarray(dataStart, end);
    };
    const imageMeta = await sharp(part('image')).metadata();
    const sourceProfile = (await sharp(file).metadata()).icc;
    assert.ok(sourceProfile?.length);
    assert.deepEqual(imageMeta.icc, sourceProfile);
    const maskMeta = await sharp(part('mask')).metadata();
    assert.deepEqual([imageMeta.width, imageMeta.height, imageMeta.orientation ?? 1], [8, 10, 1]);
    assert.deepEqual([maskMeta.width, maskMeta.height], [8, 10]);
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});

test('推理响应无长度信息且超过上限时提前停止读取', async () => {
  let sent = 0;
  const server = createServer((req, res) => {
    req.resume(); req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      const send = () => {
        if (res.destroyed || sent >= 8 * 1024 * 1024) { res.end(); return; }
        sent += 16384; res.write(Buffer.alloc(16384)); setImmediate(send);
      };
      send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const config = { ...editorConfig(), url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, maxResultBytes: 65536 };
    await assert.rejects(runInference(config, { jobId: 'test', model: 'migan', image: Buffer.alloc(1), mask: Buffer.alloc(1), signal: new AbortController().signal }), /超过大小限制/);
    assert.ok(sent < 8 * 1024 * 1024, `读取过多响应：${sent}`);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});


test('修复后原图在同一秒内变化时拒绝保存副本', async () => {
  const stub = await startStub();
  const { root, cache, db, app, headers, row } = await setup(stub.url);
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: await maskOf() } });
    const job = await waitForJob(app, headers, created.json().id);
    assert.equal(job.status, 'succeeded');
    const original = path.join(root, 'photo.jpg');
    const changed = await readFile(original);
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
    await writeFile(original, changed);
    await utimes(original, row.modified_at + 0.5, row.modified_at + 0.5);
    const saved = await app.inject({ method: 'POST', url: `/api/v2/editor/jobs/${job.id}/save-copy`, headers,
      payload: { name: 'changed.png', source: sourceOf(row) } });
    assert.equal(saved.statusCode, 409, saved.body);
    assert.equal(saved.json().error.code, 'MEDIA_CHANGED');
    await assert.rejects(stat(path.join(root, 'changed.png')));
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});


test('保存修复副本时保留推理结果的颜色配置', async () => {
  const stub = await startStub();
  const result = await sharp({ create: { width: 10, height: 8, channels: 3, background: '#ddd' } }).png().withIccProfile('srgb').toBuffer();
  stub.setResult(result);
  const { root, cache, db, app, headers, row } = await setup(stub.url);
  try {
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: row.id, source: sourceOf(row), model: 'migan', mask: await maskOf() } });
    const job = await waitForJob(app, headers, created.json().id);
    const saved = await app.inject({ method: 'POST', url: `/api/v2/editor/jobs/${job.id}/save-copy`, headers,
      payload: { name: 'profile.png', source: sourceOf(row) } });
    assert.equal(saved.statusCode, 200, saved.body);
    const before = (await sharp(result).metadata()).icc;
    const after = (await sharp(path.join(root, 'profile.png')).metadata()).icc;
    assert.ok(before?.length);
    assert.deepEqual(after, before);
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});


test('含 EXIF 方向的高位深原图不能在推理前静默降精度', async () => {
  const stub = await startStub();
  stub.setResult(await sharp({ create: { width: 8, height: 10, channels: 3, background: '#ddd' } }).png().toBuffer());
  const { root, cache, db, app, headers, row } = await setup(stub.url);
  try {
    const sourceFile = path.join(root, 'photo.jpg');
    await writeFile(sourceFile, await sharp({ create: { width: 10, height: 8, channels: 3, background: '#aaa' } })
      .toColourspace('rgb16').png().withMetadata({ orientation: 6 }).toBuffer());
    await scanLibrary(db, { id: 'lib', root }, { allowedRoots: [root] });
    db.prepare('UPDATE files SET width=8,height=10 WHERE id=?').run(row.id);
    const fresh = db.prepare('SELECT id,size,modified_at,cache_generation FROM files WHERE id=?').get(row.id) as FileRow;
    const mask = await sharp({ create: { width: 8, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
    const created = await app.inject({ method: 'POST', url: '/api/v2/editor/jobs', headers,
      payload: { mediaId: fresh.id, source: sourceOf(fresh), model: 'migan', mask: { data: mask.toString('base64'), width: 8, height: 10 } } });
    assert.equal(created.statusCode, 200, created.body);
    const job = await waitForJob(app, headers, created.json().id);
    assert.equal(job.status, 'failed', JSON.stringify(job));
    assert.match(job.error, /高位深/);
  } finally { await app.close(); db.close(); await stub.close(); await rm(root, { recursive: true, force: true }); await rm(cache, { recursive: true, force: true }); }
});


test('默认响应大小限制允许超过 64 MiB 的修复结果', async () => {
  const bytes = 65 * 1024 * 1024;
  const server = createServer((req, res) => { req.resume(); req.on('end', () => {
    res.setHeader('content-type', 'image/png'); res.end(Buffer.alloc(bytes));
  }); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const previous = process.env.EDITOR_MAX_RESULT_BYTES;
  delete process.env.EDITOR_MAX_RESULT_BYTES;
  try {
    const config = { ...editorConfig(), url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
    const result = await runInference(config, { jobId: 'large-result', model: 'migan', image: Buffer.alloc(1), mask: Buffer.alloc(1), signal: new AbortController().signal });
    assert.equal(result.data.length, bytes);
  } finally {
    if (previous === undefined) delete process.env.EDITOR_MAX_RESULT_BYTES; else process.env.EDITOR_MAX_RESULT_BYTES = previous;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
