import { z } from 'zod';

/** 统一错误响应：所有非 2xx 响应体均为该结构。 */
export const ApiError = z.object({
  error: z.object({
    /** 机器可读错误码，例如 UNAUTHORIZED、FORBIDDEN、NOT_FOUND、VALIDATION、CONFLICT、INTERNAL。 */
    code: z.string(),
    /** 面向用户的简体中文说明。 */
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const ErrorCode = {
  Unauthorized: 'UNAUTHORIZED',
  Forbidden: 'FORBIDDEN',
  NotFound: 'NOT_FOUND',
  Validation: 'VALIDATION',
  Conflict: 'CONFLICT',
  NotInitialized: 'NOT_INITIALIZED',
  Internal: 'INTERNAL',
} as const;

/** 不透明游标：客户端只回传，不解析。 */
export const Cursor = z.string().min(1);

/** ISO 8601 时间字符串（带时区偏移），例如 2024-10-27T17:42:08+09:00。 */
export const IsoDateTime = z.string();

/** 逗号分隔列表的查询参数（例如 types=image,video），解析为数组。 */
export const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
    return v;
  }, z.array(item));

/** 查询字符串中的布尔值：'1' | 'true' 为真，'0' | 'false' 为假。 */
export const queryBool = z.preprocess((v) => {
  if (v === 'true' || v === '1' || v === true) return true;
  if (v === 'false' || v === '0' || v === false) return false;
  return v;
}, z.boolean());

export const Ok = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof Ok>;
