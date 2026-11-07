import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import * as service from '../src/editor/service.ts';

test('自动检测使用独立推理接口并返回原尺寸蒙版', async () => {
  let route = '';
  let request = Buffer.alloc(0);
  const mask = await sharp({ create: { width: 7, height: 5, channels: 3, background: '#808080' } }).greyscale().png().toBuffer();
  const server = createServer((req, res) => {
    route = req.url ?? '';
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      request = Buffer.concat(chunks);
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(mask);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const config = { ...service.editorConfig(), url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
    const image = Buffer.from('示例图片');
    const actual = await service.runDetection(config, { jobId: 'job-12345', image, signal: new AbortController().signal });
    assert.equal(route, '/v1/detect');
    assert.ok(request.includes(image));
    assert.ok(request.includes(Buffer.from('job-12345')));
    assert.deepEqual(actual, mask);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('服务未声明检测能力时不可推测其支持 SLBR 检测', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ models: [{ id: 'slbr', available: true, device: 'cpu', maxPixels: 1000 }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const config = { ...service.editorConfig(), url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
    const models = await service.probeModels(config);
    assert.deepEqual(models.find((model) => model.id === 'slbr')?.features, ['mask']);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('推理服务没有响应时检测请求会在配置时间内结束', async () => {
  const server = createServer((_req, _res) => {});
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const config = { ...service.editorConfig(), url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, inferenceTimeoutMs: 80 };
    await assert.rejects(service.runDetection(config, { jobId: 'job-timeout', image: Buffer.from('x'), signal: new AbortController().signal }));
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
