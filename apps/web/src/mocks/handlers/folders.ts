import { http, HttpResponse } from 'msw/http';
import { allFolders } from '../db';

/**
 * 文件夹补充模拟：路径不存在时返回 404（与真实服务端一致），其余请求不处理、交给 core 的文件夹处理器。
 * 需登记在 core 之前才能先于其生效。
 */
const notFound = (request: Request) => {
  const path = new URL(request.url).searchParams.get('path');
  if (path && !allFolders().includes(path)) {
    return HttpResponse.json({ error: { code: 'NOT_FOUND', message: '文件夹不存在或已被移除' } }, { status: 404 });
  }
  return undefined;
};

export const folderHandlers = [
  http.get('/api/v2/folders/tree', ({ request }) => notFound(request)),
  http.get('/api/v2/folders', ({ request }) => notFound(request)),
];
