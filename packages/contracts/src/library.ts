import { z } from 'zod';
import { Breadcrumb, MediaFilter, MediaItem } from './media.ts';
import { IsoDateTime } from './common.ts';

/** 文件夹条目。path 为虚拟路径 `<libraryId>/<相对目录>`。 */
export const Folder = z.object({
  path: z.string(),
  name: z.string(),
  /** 含子孙的媒体数（物化计数，不在请求期递归统计）。 */
  mediaCount: z.number().int(),
  /** 直接子文件夹数。 */
  childCount: z.number().int(),
  /** 封面：该目录或子孙中最新的有缩略图的媒体。 */
  cover: MediaItem.nullable(),
  favorite: z.boolean(),
  /** 目录内最新媒体的 takenAt，空目录为 null。 */
  latestAt: IsoDateTime.nullable(),
  /** 文件夹自身的文件系统修改时间；未知或不完整授权时为 null。 */
  modifiedAt: IsoDateTime.nullable().optional(),
  /** 宿主机上的真实路径（媒体库 hostRoot + 相对目录）；未识别宿主机路径或管理员关闭显示时为 null。 */
  hostPath: z.string().nullable(),
});
export type Folder = z.infer<typeof Folder>;

/**
 * GET /api/v2/folders?path=
 * path 省略或为空：返回用户可见的各媒体库根（每个媒体库一个 Folder，path=libraryId）。
 * 层级与磁盘上的真实目录一致：列出全部子目录，包括没有直接媒体、只含子目录的中间层；
 * 只排除媒体库 exclude 规则命中的目录（默认含 @eaDir、#recycle、.thumbnails 等 NAS 系统目录与隐藏目录）。
 * 子文件夹按 name 自然排序（数字感知）。目录下的媒体通过 GET /api/v2/media?scope=folder&folder=path 获取。
 */
export const FolderListing = z.object({
  path: z.string(),
  breadcrumbs: z.array(Breadcrumb),
  folders: z.array(Folder),
  /** 该目录的直接子媒体数。 */
  directMediaCount: z.number().int(),
  /** 当前目录的宿主机真实路径；规则同 Folder.hostPath。 */
  hostPath: z.string().nullable(),
  /** 所属媒体库挂载点在宿主机上的路径，前端据此把面包屑分成“挂载点之外（不可进入）”与“可浏览”两段。 */
  hostRoot: z.string().nullable(),
  favorite: z.boolean(),
});

/** GET /api/v2/folders/tree?path=：目录树侧栏的懒加载节点（只含子目录，不含封面），path 省略时返回各媒体库根。 */
export const FolderTreeNode = z.object({
  path: z.string(),
  name: z.string(),
  childCount: z.number().int(),
  mediaCount: z.number().int(),
  favorite: z.boolean(),
});
export const FolderTree = z.object({ path: z.string(), nodes: z.array(FolderTreeNode) });
export type FolderListing = z.infer<typeof FolderListing>;

/** PUT /api/v2/folders/favorite */
export const SetFolderFavoriteBody = z.object({ path: z.string(), favorite: z.boolean() });
/** GET /api/v2/folders/favorites */
export const FavoriteFolders = z.object({ folders: z.array(Folder) });

/** 相册：manual 为手动挑选（媒体 ID 存于数据库，不移动文件）；smart 为保存的筛选条件。 */
export const Album = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(['manual', 'smart']),
  filter: MediaFilter.nullable(),
  count: z.number().int(),
  cover: MediaItem.nullable(),
  /** 最早/最晚 takenAt，用于显示“2024 年 10 月 – 11 月”。 */
  startAt: IsoDateTime.nullable(),
  endAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Album = z.infer<typeof Album>;

/** GET /api/v2/albums（当前用户的相册，按 updatedAt 倒序） */
export const AlbumList = z.object({ albums: z.array(Album) });
/** POST /api/v2/albums */
export const CreateAlbumBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  kind: z.enum(['manual', 'smart']).default('manual'),
  filter: MediaFilter.nullable().optional(),
  /** 创建手动相册时一并加入的媒体。 */
  ids: z.array(z.string()).max(5000).optional(),
});
/** PATCH /api/v2/albums/:id */
export const UpdateAlbumBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  filter: MediaFilter.nullable().optional(),
  coverId: z.string().nullable().optional(),
});
/** POST /api/v2/albums/:id/items 加入；DELETE /api/v2/albums/:id/items 移除（仅 manual）。 */
export const AlbumItemsBody = z.object({ ids: z.array(z.string()).min(1).max(5000) });
