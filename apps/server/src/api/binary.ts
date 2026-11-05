import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export async function sendFile(req: FastifyRequest, reply: FastifyReply, filename: string, options: { mime: string; name: string; download?: boolean; etagKey: string; authorize?: () => void }) {
  let handle;
  try { handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '媒体不可访问' } }); }
  try {
    const info = await handle.stat();
    if (!info.isFile()) { await handle.close(); return reply.code(404).send({ error: { code: 'NOT_FOUND', message: '媒体不可访问' } }); }
    options.authorize?.();
    const etag = `W/"${createHash('sha256').update(`${options.etagKey}:${info.size}:${info.mtimeMs}`).digest('base64url').slice(0, 24)}"`;
    reply.header('ETag', etag).header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, no-cache');
    if (req.headers['if-none-match']?.split(',').map((part) => part.trim()).some((tag) => tag === '*' || tag === etag)) {
      await handle.close(); return reply.code(304).send();
    }
    let start = 0; let end = info.size - 1; let partial = false;
    const range = req.headers.range;
    if (range && !req.headers['if-range']) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]) || info.size === 0) {
        await handle.close(); return reply.header('Content-Range', `bytes */${info.size}`).code(416).send({ error: { code: 'VALIDATION', message: '请求范围无效' } });
      }
      if (!match[1]) {
        const suffix = Number(match[2]);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) { await handle.close(); return reply.header('Content-Range', `bytes */${info.size}`).code(416).send({ error: { code: 'VALIDATION', message: '请求范围无效' } }); }
        start = Math.max(0, info.size - suffix);
      } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : info.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= info.size || start > end) {
          await handle.close(); return reply.header('Content-Range', `bytes */${info.size}`).code(416).send({ error: { code: 'VALIDATION', message: '请求范围无效' } });
        }
        end = Math.min(end, info.size - 1);
      }
      partial = true;
    }
    reply.type(options.mime).header('Content-Length', info.size === 0 ? 0 : end - start + 1);
    if (options.download) reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(options.name)}`);
    if (partial) reply.code(206).header('Content-Range', `bytes ${start}-${end}/${info.size}`);
    if (info.size === 0) { await handle.close(); return reply.send(); }
    return reply.send(handle.createReadStream({ start, end, autoClose: true }));
  } catch (error) { await handle.close().catch(() => {}); throw error; }
}
