import { z } from 'zod';
import { Cursor, IsoDateTime } from './common.ts';
import { MediaItem } from './media.ts';

export const ShareTarget = z.discriminatedUnion('type', [
  z.object({ type: z.literal('album'), albumId: z.string() }),
  z.object({ type: z.literal('folder'), path: z.string() }),
  z.object({ type: z.literal('media'), ids: z.array(z.string()).min(1).max(5000) }),
]);
export type ShareTarget = z.infer<typeof ShareTarget>;

export const Share = z.object({
  id: z.string(),
  /** 公开链接令牌（随机 ≥ 128 bit），访客地址为 /s/:token。 */
  token: z.string(),
  title: z.string(),
  target: ShareTarget,
  ownerUsername: z.string(),
  hasPassword: z.boolean(),
  allowDownload: z.boolean(),
  expiresAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  viewCount: z.number().int(),
  mediaCount: z.number().int(),
  cover: MediaItem.nullable(),
});
export type Share = z.infer<typeof Share>;

/** POST /api/v2/shares（只能分享自己可见范围内的内容） */
export const CreateShareBody = z.object({
  target: ShareTarget,
  title: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(4).max(128).nullable().optional(),
  allowDownload: z.boolean().default(false),
  expiresAt: IsoDateTime.nullable().optional(),
});
/** GET /api/v2/shares：自己的分享；admin 加 ?all=1 查看全部。DELETE /api/v2/shares/:id 立即撤销。 */
export const ShareList = z.object({ shares: z.array(Share) });

/**
 * 访客接口（无需登录）：
 * - GET  /api/v2/public/shares/:token            → PublicShare（过期/撤销 404）
 * - POST /api/v2/public/shares/:token/unlock     { password } → 设置该分享专用 Cookie，204
 * - GET  /api/v2/public/shares/:token/media?cursor=&limit= → MediaPage
 * - GET  /api/v2/public/shares/:token/media/:id/thumb?size=&v= / original / preview / hls/index.m3u8
 * 访客只能访问分享目标集合内的媒体（服务端逐项校验）。
 */
export const PublicShare = z.object({
  title: z.string(),
  ownerUsername: z.string(),
  requiresPassword: z.boolean(),
  /** requiresPassword 且未解锁时为 false，此时 mediaCount/cover 不返回内容。 */
  unlocked: z.boolean(),
  allowDownload: z.boolean(),
  expiresAt: IsoDateTime.nullable(),
  mediaCount: z.number().int().nullable(),
  cover: MediaItem.nullable(),
});
export type PublicShare = z.infer<typeof PublicShare>;
export const UnlockShareBody = z.object({ password: z.string().min(1).max(128) });
export const PublicMediaQuery = z.object({ cursor: Cursor.optional(), limit: z.coerce.number().int().min(1).max(500).default(120) });

export const shareMediaUrls = {
  thumb: (token: string, id: string, size: 's' | 'm' | 'l', v: number) =>
    `/api/v2/public/shares/${token}/media/${encodeURIComponent(id)}/thumb?size=${size}&v=${v}`,
  original: (token: string, id: string) => `/api/v2/public/shares/${token}/media/${encodeURIComponent(id)}/original`,
  preview: (token: string, id: string) => `/api/v2/public/shares/${token}/media/${encodeURIComponent(id)}/preview`,
  hls: (token: string, id: string) => `/api/v2/public/shares/${token}/media/${encodeURIComponent(id)}/hls/index.m3u8`,
};
