import { z } from 'zod';
import { Job } from './admin.ts';

/**
 * GET /api/v2/events：Server-Sent Events，需登录。
 * 每条消息 `event:` 为下列 type，`data:` 为对应 JSON。服务端每 25 秒发送 `: ping` 注释保持连接。
 * - job：作业状态或进度变化（仅 admin 收到；进度至多每秒推送一次）
 * - library：媒体集合发生变化（实时监控、轮询对账或扫描落库后批量推送，至多每 2 秒一条），客户端据此使相关查询失效
 * - session：会话失效（被撤销或密码重置），客户端应跳转登录
 */
export const LibraryChangedEvent = z.object({
  /** 来源媒体库；null 表示跨库或全局变化。 */
  libraryId: z.string().nullable(),
  source: z.enum(['watch', 'poll', 'scan']),
  /** 受影响的虚拟文件夹前缀；空数组表示全局变化。 */
  folders: z.array(z.string()),
  added: z.number().int(),
  removed: z.number().int(),
  updated: z.number().int(),
  /** 识别为移动或改名的数量（不计入 added/removed）。 */
  moved: z.number().int(),
});
export type LibraryChangedEvent = z.infer<typeof LibraryChangedEvent>;

export const SessionEvent = z.object({ reason: z.enum(['revoked', 'expired', 'password_changed']) });

export const ServerEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('job'), data: Job }),
  z.object({ type: z.literal('library'), data: LibraryChangedEvent }),
  z.object({ type: z.literal('session'), data: SessionEvent }),
]);
export type ServerEvent = z.infer<typeof ServerEvent>;
