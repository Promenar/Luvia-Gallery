import { http, HttpResponse } from 'msw/http';

/**
 * 照片时间线用到的模拟接口：打包下载。
 * 返回一次性地址，下载内容为一个很小的占位文件（模拟环境不生成真实 ZIP）。
 */
const tickets = new Map<string, { ids: string[]; fileName: string }>();

export const photosHandlers = [
  http.post('/api/v2/downloads', async ({ request }) => {
    const body = (await request.json()) as { ids?: string[]; folder?: string; albumId?: string };
    const token = Math.random().toString(36).slice(2, 10);
    const count = body.ids?.length ?? 0;
    const fileName = body.ids ? `Luvia-${count}项.zip` : body.folder ? `${body.folder.split('/').pop()}.zip` : '相册.zip';
    tickets.set(token, { ids: body.ids ?? [], fileName });
    return HttpResponse.json({ url: `/api/v2/downloads/${token}`, expiresAt: new Date(Date.now() + 600_000).toISOString(), fileName });
  }),
  http.get('/api/v2/downloads/:token', ({ params }) => {
    const t = tickets.get(String(params.token));
    if (!t) return HttpResponse.json({ error: { code: 'NOT_FOUND', message: '下载地址已过期，请重新发起下载' } }, { status: 404 });
    tickets.delete(String(params.token));
    return new HttpResponse(`模拟下载：${t.ids.length} 项\n`, {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(t.fileName)}` },
    });
  }),
];
