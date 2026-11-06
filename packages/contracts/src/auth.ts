import { z } from 'zod';
import { IsoDateTime } from './common.ts';
import { MediaSort } from './media.ts';

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
  accent: ThemeAccent.default('dynamic'),
  radius: ThemeRadius.default('default'),
  viewerBackdrop: ViewerBackdrop.default('ambient'),
});
export type ThemePreference = z.infer<typeof ThemePreference>;

/**
 * 首页大图轮播的内容来源。memories 为往年同期；favorites 为收藏的媒体与收藏文件夹之下的媒体；
 * library 为全部可见媒体；folder 为 heroFolder 指定文件夹及其子孙。后三者随机抽取（GET /api/v2/media/random）。
 */
const HeroSource = z.enum(['memories', 'favorites', 'library', 'folder']);
export const HomePreference = z.object({
  heroSource: HeroSource.default('memories'),
  /** heroSource=folder 时的虚拟文件夹路径；文件夹不存在或无权访问时前端回退到 library。 */
  heroFolder: z.string().nullable().default(null),
});
/**
 * 幻灯片播放。播放范围由打开查看器的位置决定（时间线=全部，文件夹=当前文件夹，相册=当前相册……），不在偏好中保存。
 * 图片按 intervalSec 切换；视频播放完毕后自动切换下一项。
 */
export const SlideshowPreference = z.object({
  intervalSec: z.number().int().min(2).max(120).default(5),
  order: z.enum(['sequential', 'shuffle']).default('sequential'),
  /** 图片停留期间缓慢推近。 */
  kenBurns: z.boolean().default(true),
  /** 播完后从头循环。 */
  loop: z.boolean().default(true),
});

export const Preferences = z.object({
  theme: ThemePreference.default(ThemePreference.parse({})),
  home: HomePreference.default(HomePreference.parse({})),
  slideshow: SlideshowPreference.default(SlideshowPreference.parse({})),
  /** 文件夹视图中媒体网格是否包含子文件夹内容（默认只显示直接位于该文件夹的媒体）。 */
  folderIncludeSubfolders: z.boolean().default(false),
  locale: z.enum(['zh-CN', 'en']).default('zh-CN'),
  /** 网格行高档位 1（最密）–5（最疏）。 */
  density: z.number().int().min(1).max(5).default(3),
  gridStyle: z.enum(['justified', 'square']).default('justified'),
  /** 照片时间线的排序与分组依据：modified 文件修改时间（默认，导入后立即可用），taken 拍摄时间（随后台读取逐步完善）。 */
  timelineBasis: z.enum(['modified', 'taken']).default('modified'),
  /** 文件夹、相册、收藏中媒体网格的排序，默认按修改时间从新到旧。 */
  mediaSort: MediaSort.default('modified_desc'),
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
    home: z.object({ heroSource: HeroSource, heroFolder: z.string().nullable() }).partial(),
    slideshow: z
      .object({
        intervalSec: SlideshowPreference.shape.intervalSec.unwrap(),
        order: SlideshowPreference.shape.order.unwrap(),
        kenBurns: z.boolean(),
        loop: z.boolean(),
      })
      .partial(),
    folderIncludeSubfolders: z.boolean(),
    locale: Preferences.shape.locale.unwrap(),
    density: z.number().int().min(1).max(5),
    gridStyle: Preferences.shape.gridStyle.unwrap(),
    timelineBasis: Preferences.shape.timelineBasis.unwrap(),
    mediaSort: MediaSort,
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
/**
 * 壁纸播放设置，保存在 scope=wallpaper 的令牌上。v1 兼容接口 /api/scan/results?random=true 用该令牌访问时
 * 按此设置抽取内容，因此 Wallpaper Engine 壁纸端无需改动即可在控制台调整播放内容。
 */
export const WallpaperConfig = z.object({
  source: z.enum(['library', 'favorites', 'folder']).default('library'),
  /** source=folder 时的虚拟文件夹路径（含子孙）。 */
  folder: z.string().nullable().default(null),
  /** 壁纸端切换间隔，写入兼容响应供新版壁纸读取；旧壁纸端忽略。 */
  intervalSec: z.number().int().min(5).max(3600).default(30),
  landscapeOnly: z.boolean().default(true),
  includeVideos: z.boolean().default(false),
});
export type WallpaperConfig = z.infer<typeof WallpaperConfig>;

export const ApiToken = z.object({
  id: z.string(),
  name: z.string(),
  scope: z.enum(['read', 'wallpaper']),
  /** 仅 scope=wallpaper 有值。 */
  wallpaper: WallpaperConfig.nullable(),
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
  wallpaper: WallpaperConfig.optional(),
});
/** PATCH /api/v2/me/tokens/:id：改名或调整壁纸设置（不可改 scope，不重新签发）。 */
export const UpdateTokenBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  wallpaper: WallpaperConfig.partial().optional(),
});
/** 明文 token 只在创建响应中出现一次。 */
export const CreatedToken = z.object({ token: z.string(), meta: ApiToken });
