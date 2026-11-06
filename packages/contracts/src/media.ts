import { z } from 'zod';
import { csv, Cursor, IsoDateTime, queryBool } from './common.ts';

export const MediaType = z.enum(['image', 'video', 'audio']);
export type MediaType = z.infer<typeof MediaType>;

/**
 * 视频可播放性：
 * - direct：浏览器可直接播放原文件（H.264/AAC MP4、WebM 等）
 * - transcode：需经 HLS 按需转码播放（MKV/AVI/非 Safari 的 HEVC 等）
 * - unsupported：无法播放（转码关闭或 ffprobe 失败）
 * 非视频媒体为 null。
 */
export const Playability = z.enum(['direct', 'transcode', 'unsupported']);
export type Playability = z.infer<typeof Playability>;

/** 拍摄时间来源：exif/quicktime 元数据、文件名中的日期、文件修改时间回退。 */
export const TakenAtSource = z.enum(['metadata', 'filename', 'mtime']);

/**
 * 列表中的媒体项。
 * 所有媒体 URL 由客户端按 id 拼接（见 mediaUrls），使用会话 Cookie 鉴权，不在 URL 中携带令牌。
 */
export const MediaItem = z.object({
  /** 稳定不透明 ID（与路径一一对应，重命名会变化）。 */
  id: z.string(),
  name: z.string(),
  /** 虚拟文件夹路径：`<libraryId>/<相对目录>`，媒体库根目录为 `<libraryId>`。绝不包含服务器绝对路径。 */
  folder: z.string(),
  mediaType: MediaType,
  mime: z.string(),
  /** 字节数。 */
  size: z.number().int().nonnegative(),
  /** 已按 EXIF 方向校正后的宽高；未知为 null。 */
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  /** 秒，仅视频/音频。 */
  durationSec: z.number().nonnegative().nullable(),
  /** 拍摄时间（ISO 8601，带偏移）；缺失元数据时回退为修改时间，因此始终有值。 */
  takenAt: IsoDateTime,
  takenAtSource: TakenAtSource,
  /** 文件修改时间，Unix 秒。 */
  modifiedAt: z.number().int(),
  favorite: z.boolean(),
  /** ThumbHash（base64），用于加载前占位；尚未生成时为 null。 */
  thumbhash: z.string().nullable(),
  /** 缩略图版本号，变化时客户端 URL 追加 ?v= 以绕过缓存；0 表示尚无缩略图。 */
  thumbVersion: z.number().int().nonnegative(),
  hasLocation: z.boolean(),
  playability: Playability.nullable(),
  /** 是否有服务端生成的悬停预览短片（仅视频）。 */
  hasPreview: z.boolean(),
});
export type MediaItem = z.infer<typeof MediaItem>;

export const Exif = z.object({
  make: z.string().nullable(),
  model: z.string().nullable(),
  lens: z.string().nullable(),
  /** 例如 2.8 */
  fNumber: z.number().nullable(),
  /** 秒，例如 0.004 表示 1/250 */
  exposureTime: z.number().nullable(),
  iso: z.number().nullable(),
  /** 毫米 */
  focalLength: z.number().nullable(),
  focalLength35: z.number().nullable(),
  software: z.string().nullable(),
});
export type Exif = z.infer<typeof Exif>;

export const VideoInfo = z.object({
  codec: z.string().nullable(),
  audioCodec: z.string().nullable(),
  container: z.string().nullable(),
  fps: z.number().nullable(),
  bitrate: z.number().nullable(),
});
export type VideoInfo = z.infer<typeof VideoInfo>;

export const Breadcrumb = z.object({ name: z.string(), path: z.string() });
export type Breadcrumb = z.infer<typeof Breadcrumb>;

export const MediaDetail = MediaItem.extend({
  exif: Exif.nullable(),
  location: z.object({ lat: z.number(), lon: z.number(), altitude: z.number().nullable() }).nullable(),
  video: VideoInfo.nullable(),
  /** 媒体库显示名。 */
  libraryName: z.string(),
  /** 从媒体库根到所在文件夹的面包屑。 */
  breadcrumbs: z.array(Breadcrumb),
  /** 所属手动相册 ID 列表（当前用户可见）。 */
  albumIds: z.array(z.string()),
});
export type MediaDetail = z.infer<typeof MediaDetail>;

export const MediaSort = z.enum(['taken_desc', 'taken_asc', 'modified_desc', 'name_asc', 'size_desc']);
export type MediaSort = z.infer<typeof MediaSort>;

export const Orientation = z.enum(['landscape', 'portrait', 'square']);

/**
 * 媒体筛选条件。既是列表查询参数，也是智能相册的保存格式（JSON 时数组为真数组）。
 */
export const MediaFilter = z.object({
  /** 文件名/路径全文检索（trigram，支持中文子串；1–2 个字符走前缀匹配）。 */
  q: z.string().trim().min(1).max(200).optional(),
  types: csv(MediaType).optional(),
  /** from/to 区间与时间线分桶依据的时间：taken 拍摄时间（缺省），modified 文件修改时间。 */
  timeField: z.enum(['taken', 'modified']).optional(),
  /** timeField 指定时间的区间，Unix 秒，左闭右开。 */
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  /** 相机型号（与 facets.cameras[].name 完全匹配），可多选。 */
  cameras: csv(z.string()).optional(),
  orientation: Orientation.optional(),
  hasLocation: queryBool.optional(),
  favorite: queryBool.optional(),
  /** 限定在该虚拟文件夹之下（含子孙）。 */
  under: z.string().optional(),
});
export type MediaFilter = z.infer<typeof MediaFilter>;

/**
 * GET /api/v2/media
 * scope：
 * - all：全部可见媒体
 * - folder：仅 folder 参数指定文件夹的直接子媒体（recursive=true 时含子孙）
 * - album：albumId 指定相册中的媒体
 * - favorites：当前用户收藏的媒体（含收藏文件夹之下的媒体）
 * 处于删除宽限期（文件已从磁盘消失）的媒体不出现在列表、分桶、筛选候选、随机、回忆与 v1 兼容接口中；
 * 其收藏、相册关系与缩略图保留，文件在宽限期内重新出现（含移动后被识别）时恢复原媒体 ID。
 */
export const MediaListQuery = MediaFilter.extend({
  scope: z.enum(['all', 'folder', 'album', 'favorites']).default('all'),
  folder: z.string().optional(),
  recursive: queryBool.optional(),
  albumId: z.string().optional(),
  sort: MediaSort.default('taken_desc'),
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(120),
});
export type MediaListQuery = z.input<typeof MediaListQuery>;

export const MediaPage = z.object({
  items: z.array(MediaItem),
  nextCursor: Cursor.nullable(),
  /** 精确总数；计算代价高时为 null（客户端以 buckets 汇总为准）。 */
  total: z.number().int().nullable(),
});
export type MediaPage = z.infer<typeof MediaPage>;

/** GET /api/v2/media/buckets：按 timeField 指定的时间（缺省为 takenAt）年月分桶（服务器时区），倒序。查询参数同 MediaListQuery（忽略 sort/cursor/limit）。 */
export const TimelineBucket = z.object({
  /** YYYY-MM */
  key: z.string(),
  count: z.number().int(),
  /** 该月起止 Unix 秒，左闭右开，可直接作为 from/to。 */
  start: z.number().int(),
  end: z.number().int(),
});
export type TimelineBucket = z.infer<typeof TimelineBucket>;
export const TimelineBuckets = z.object({ buckets: z.array(TimelineBucket), total: z.number().int() });
export type TimelineBuckets = z.infer<typeof TimelineBuckets>;

/** GET /api/v2/media/facets：当前可见范围内的筛选候选。查询参数同 MediaListQuery。 */
export const MediaFacets = z.object({
  cameras: z.array(z.object({ name: z.string(), count: z.number().int() })),
  years: z.array(z.object({ year: z.number().int(), count: z.number().int() })),
  types: z.object({ image: z.number().int(), video: z.number().int(), audio: z.number().int() }),
});
export type MediaFacets = z.infer<typeof MediaFacets>;

/** GET /api/v2/media/random?count=&（MediaFilter）：rowid 区间抽样，非全表排序。 */
export const RandomQuery = MediaFilter.extend({
  count: z.coerce.number().int().min(1).max(100).default(24),
  /** 仅该文件夹的直接子媒体（与 under 的含子孙语义区分），用于“随机播放当前文件夹”。 */
  folder: z.string().optional(),
  /** 与 favorite=true 同用：同时包含当前用户收藏文件夹之下的媒体（首页“收藏”轮播）。 */
  favoriteFolders: queryBool.optional(),
  /** 逗号分隔的媒体 ID，本次抽样排除（幻灯片随机播放时避免短期重复），最多 500 个。 */
  exclude: csv(z.string()).optional(),
});
export const MediaItems = z.object({ items: z.array(MediaItem) });
export type MediaItems = z.infer<typeof MediaItems>;

/** PUT /api/v2/media/favorite */
export const SetFavoriteBody = z.object({ ids: z.array(z.string()).min(1).max(5000), favorite: z.boolean() });
export const UpdatedCount = z.object({ updated: z.number().int() });

/**
 * POST /api/v2/media/dimensions：界面上正在显示但还没有宽高的媒体。
 * 返回其中已经读到宽高的条目；其余提到后台拍摄信息读取的队首。无权访问的 ID 静默忽略。
 */
export const DimensionsRequest = z.object({ ids: z.array(z.string().min(1).max(200)).min(1).max(200) });
export const MediaDimensions = z.object({
  items: z.array(z.object({ id: z.string(), width: z.number().int().positive(), height: z.number().int().positive() })),
});

/** GET /api/v2/memories */
export const Memories = z.object({
  onThisDay: z.array(z.object({ year: z.number().int(), count: z.number().int(), items: z.array(MediaItem) })),
  recentlyAdded: z.array(MediaItem),
  /** 随机一组，可用于首页氛围图。 */
  shuffle: z.array(MediaItem),
});
export type Memories = z.infer<typeof Memories>;

/** GET /api/v2/search/suggest?q= ：命令面板联想。 */
export const SearchSuggest = z.object({
  folders: z.array(z.object({ path: z.string(), name: z.string(), mediaCount: z.number().int() })),
  albums: z.array(z.object({ id: z.string(), name: z.string(), count: z.number().int() })),
  cameras: z.array(z.string()),
  media: z.array(MediaItem),
});
export type SearchSuggest = z.infer<typeof SearchSuggest>;

/** POST /api/v2/downloads：生成一次性打包下载地址（ZIP，存储模式不压缩），有效期 10 分钟。 */
export const DownloadRequest = z.union([
  z.object({ ids: z.array(z.string()).min(1).max(5000) }),
  z.object({ folder: z.string() }),
  z.object({ albumId: z.string() }),
]);
export const DownloadTicket = z.object({ url: z.string(), expiresAt: IsoDateTime, fileName: z.string() });
export type DownloadTicket = z.infer<typeof DownloadTicket>;

export const ThumbSize = z.enum(['s', 'm', 'l']);
export type ThumbSize = z.infer<typeof ThumbSize>;

/**
 * 媒体资源 URL（均为 GET，Cookie 鉴权；分享访客路径见 shares.ts）：
 * - 缩略图：/api/v2/media/:id/thumb?size=s|m|l&v=thumbVersion
 *   s≈256px 短边、m≈768px、l≈1600px，WebP；未生成时同步生成（受全局并发限制），失败 404。
 * - 原文件：/api/v2/media/:id/original（支持 Range；?download=1 时以附件下载）
 * - 悬停预览：/api/v2/media/:id/preview（MP4，低码率，静音，约 3–6 秒；无则 404）
 * - HLS：/api/v2/media/:id/hls/index.m3u8（仅 playability=transcode）
 */
export const mediaUrls = {
  thumb: (id: string, size: ThumbSize, v: number) => `/api/v2/media/${encodeURIComponent(id)}/thumb?size=${size}&v=${v}`,
  original: (id: string) => `/api/v2/media/${encodeURIComponent(id)}/original`,
  download: (id: string) => `/api/v2/media/${encodeURIComponent(id)}/original?download=1`,
  preview: (id: string) => `/api/v2/media/${encodeURIComponent(id)}/preview`,
  hls: (id: string) => `/api/v2/media/${encodeURIComponent(id)}/hls/index.m3u8`,
  /**
   * 浏览器可直接解码的全分辨率版本：原图为 JPEG/PNG/WebP/AVIF/GIF 时返回原文件；HEIC/RAW/TIFF 等在 worker 中
   * 转为同尺寸 WebP 并缓存。查看器放大超过 l 尺寸缩略图分辨率、右键复制图片时使用。
   */
  display: (id: string, v: number) => `/api/v2/media/${encodeURIComponent(id)}/display?v=${v}`,
  /**
   * 超大图深度缩放（长边超过 8192 像素时提供）：DZI 描述文件，瓦片 256px WebP，按需生成并缓存，
   * 瓦片地址为 `/api/v2/media/:id/tiles/:level/:col_:row.webp?v=`。
   */
  tiles: (id: string, v: number) => `/api/v2/media/${encodeURIComponent(id)}/tiles.dzi?v=${v}`,
};
