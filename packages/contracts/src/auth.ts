import { z } from 'zod';
import { IsoDateTime } from './common.ts';

/**
 * 外观偏好。服务端按用户持久化为 JSON，仅做结构校验；渲染由前端主题引擎完成。
 * accent 为预设 ID 或自定义 #RRGGBB。
 */
const ThemeMode = z.enum(['system', 'light', 'dark']);
/** 中性底色家族：graphite 纯中性、warm 暖灰、cool 冷灰、oled 纯黑（仅影响深色）。 */
const ThemeBase = z.enum(['graphite', 'warm', 'cool', 'oled']);
const ThemeAccent = z.union([
  z.enum(['mono', 'azure', 'teal', 'sage', 'amber', 'coral', 'rose', 'violet', 'dynamic']),
  z.string().regex(/^#[0-9a-fA-F]{6}$/),
]);
/** 圆角风格。 */
const ThemeRadius = z.enum(['sharp', 'default', 'round']);
/** 查看器背景：纯黑、跟随主题底色、或取照片主色的氛围光。 */
const ViewerBackdrop = z.enum(['black', 'theme', 'ambient']);

/** 主题偏好补丁（无默认值，用于局部更新）。accent=dynamic 表示随当前照片动态取色。 */
export const ThemePatch = z
  .object({ mode: ThemeMode, base: ThemeBase, accent: ThemeAccent, radius: ThemeRadius, viewerBackdrop: ViewerBackdrop })
  .partial();

export const ThemePreference = z.object({
  mode: ThemeMode.default('system'),
  base: ThemeBase.default('graphite'),
  accent: ThemeAccent.default('mono'),
  radius: ThemeRadius.default('default'),
  viewerBackdrop: ViewerBackdrop.default('ambient'),
});
export type ThemePreference = z.infer<typeof ThemePreference>;

export const Preferences = z.object({
  theme: ThemePreference.default(ThemePreference.parse({})),
  locale: z.enum(['zh-CN', 'en']).default('zh-CN'),
  /** 网格行高档位 1（最密）–5（最疏）。 */
  density: z.number().int().min(1).max(5).default(3),
  gridStyle: z.enum(['justified', 'square']).default('justified'),
  /** 视频悬停预览。 */
  hoverPreview: z.boolean().default(true),
  reduceMotion: z.enum(['system', 'on', 'off']).default('system'),
  /** 登录后的起始页。 */
  startPage: z.enum(['photos', 'memories', 'folders', 'albums']).default('photos'),
});
export type Preferences = z.infer<typeof Preferences>;
export const defaultPreferences = (): Preferences => Preferences.parse({});

export const Role = z.enum(['admin', 'user']);
export type Role = z.infer<typeof Role>;

export const User = z.object({
  id: z.string(),
  username: z.string(),
  role: Role,
  /** 可访问的虚拟文件夹前缀；null 表示全部。admin 恒为 null。 */
  allowedPaths: z.array(z.string()).nullable(),
  preferences: Preferences,
  createdAt: IsoDateTime,
  lastLoginAt: IsoDateTime.nullable(),
});
export type User = z.infer<typeof User>;

/** GET /api/v2/auth/state（匿名可调用） */
export const AuthState = z.object({
  /** false 时只能调用 setup。 */
  initialized: z.boolean(),
  user: User.nullable(),
  siteName: z.string(),
  version: z.string(),
});
export type AuthState = z.infer<typeof AuthState>;

export const Credentials = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});
/** POST /api/v2/auth/setup：仅在 initialized=false 时可用，创建首个管理员并登录。密码至少 8 位。 */
export const SetupBody = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(8).max(256),
  siteName: z.string().trim().min(1).max(80).optional(),
});
/** POST /api/v2/auth/login：成功后设置 HttpOnly 会话 Cookie `luvia_session`（SameSite=Lax）。remember=true 时有效期 30 天，否则为会话 Cookie。 */
export const LoginBody = Credentials.extend({ remember: z.boolean().default(true) });
export const UserResponse = z.object({ user: User });

/** PATCH /api/v2/me/preferences：深度合并，返回完整偏好。 */
export const PreferencesPatch = z
  .object({
    theme: ThemePatch,
    locale: Preferences.shape.locale.unwrap(),
    density: z.number().int().min(1).max(5),
    gridStyle: Preferences.shape.gridStyle.unwrap(),
    hoverPreview: z.boolean(),
    reduceMotion: Preferences.shape.reduceMotion.unwrap(),
    startPage: Preferences.shape.startPage.unwrap(),
  })
  .partial();
export type PreferencesPatch = z.infer<typeof PreferencesPatch>;
/** POST /api/v2/me/password */
export const ChangePasswordBody = z.object({ current: z.string().min(1), next: z.string().min(8).max(256) });

/**
 * 个人访问令牌：供 Android、macOS 小组件、Wallpaper Engine 等非浏览器客户端使用，
 * 以 `Authorization: Bearer <token>` 调用 v2；旧版兼容接口另允许 `?token=`。
 * scope=read 可读全部可见媒体；scope=wallpaper 仅可调用随机媒体与媒体资源接口。
 */
export const ApiToken = z.object({
  id: z.string(),
  name: z.string(),
  scope: z.enum(['read', 'wallpaper']),
  /** 令牌前 8 位，用于辨认。 */
  prefix: z.string(),
  createdAt: IsoDateTime,
  lastUsedAt: IsoDateTime.nullable(),
  expiresAt: IsoDateTime.nullable(),
});
export type ApiToken = z.infer<typeof ApiToken>;
export const ApiTokenList = z.object({ tokens: z.array(ApiToken) });
export const CreateTokenBody = z.object({
  name: z.string().trim().min(1).max(80),
  scope: z.enum(['read', 'wallpaper']).default('read'),
  expiresAt: IsoDateTime.nullable().optional(),
});
/** 明文 token 只在创建响应中出现一次。 */
export const CreatedToken = z.object({ token: z.string(), meta: ApiToken });
