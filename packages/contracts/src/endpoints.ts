import { z } from 'zod';
import { Ok } from './common.ts';
import * as M from './media.ts';
import * as L from './library.ts';
import * as A from './auth.ts';
import * as S from './shares.ts';
import * as Ad from './admin.ts';

/**
 * v2 JSON 接口路由表（唯一事实源）。服务端按此注册校验，前端按此生成类型化调用。
 * auth：public 匿名可用；user 需登录（会话 Cookie 或 Bearer 访问令牌）；admin 需管理员会话。
 * 媒体二进制资源（缩略图、原文件、预览、HLS）与 SSE 不在此表，见 media.ts / shares.ts / events.ts。
 * 路径参数用 :name 表示。
 */
type Def = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  auth: 'public' | 'user' | 'admin';
  query?: z.ZodType;
  body?: z.ZodType;
  /** 204 无响应体时为 null。 */
  response: z.ZodType | null;
};
const d = <T extends Def>(def: T) => def;

export const endpoints = {
  // 认证与个人
  authState: d({ method: 'GET', path: '/api/v2/auth/state', auth: 'public', response: A.AuthState }),
  setup: d({ method: 'POST', path: '/api/v2/auth/setup', auth: 'public', body: A.SetupBody, response: A.UserResponse }),
  login: d({ method: 'POST', path: '/api/v2/auth/login', auth: 'public', body: A.LoginBody, response: A.UserResponse }),
  logout: d({ method: 'POST', path: '/api/v2/auth/logout', auth: 'user', response: null }),
  updatePreferences: d({ method: 'PATCH', path: '/api/v2/me/preferences', auth: 'user', body: A.PreferencesPatch, response: A.Preferences }),
  changePassword: d({ method: 'POST', path: '/api/v2/me/password', auth: 'user', body: A.ChangePasswordBody, response: null }),
  listTokens: d({ method: 'GET', path: '/api/v2/me/tokens', auth: 'user', response: A.ApiTokenList }),
  createToken: d({ method: 'POST', path: '/api/v2/me/tokens', auth: 'user', body: A.CreateTokenBody, response: A.CreatedToken }),
  updateToken: d({ method: 'PATCH', path: '/api/v2/me/tokens/:id', auth: 'user', body: A.UpdateTokenBody, response: A.ApiToken }),
  deleteToken: d({ method: 'DELETE', path: '/api/v2/me/tokens/:id', auth: 'user', response: null }),

  // 媒体
  listMedia: d({ method: 'GET', path: '/api/v2/media', auth: 'user', query: M.MediaListQuery, response: M.MediaPage }),
  buckets: d({ method: 'GET', path: '/api/v2/media/buckets', auth: 'user', query: M.MediaListQuery, response: M.TimelineBuckets }),
  facets: d({ method: 'GET', path: '/api/v2/media/facets', auth: 'user', query: M.MediaListQuery, response: M.MediaFacets }),
  randomMedia: d({ method: 'GET', path: '/api/v2/media/random', auth: 'user', query: M.RandomQuery, response: M.MediaItems }),
  mediaDetail: d({ method: 'GET', path: '/api/v2/media/:id', auth: 'user', response: M.MediaDetail }),
  setFavorite: d({ method: 'PUT', path: '/api/v2/media/favorite', auth: 'user', body: M.SetFavoriteBody, response: M.UpdatedCount }),
  memories: d({ method: 'GET', path: '/api/v2/memories', auth: 'user', response: M.Memories }),
  suggest: d({ method: 'GET', path: '/api/v2/search/suggest', auth: 'user', query: z.object({ q: z.string().trim().min(1).max(200) }), response: M.SearchSuggest }),
  createDownload: d({ method: 'POST', path: '/api/v2/downloads', auth: 'user', body: M.DownloadRequest, response: M.DownloadTicket }),

  // 文件夹与相册
  folders: d({ method: 'GET', path: '/api/v2/folders', auth: 'user', query: z.object({ path: z.string().optional() }), response: L.FolderListing }),
  folderTree: d({ method: 'GET', path: '/api/v2/folders/tree', auth: 'user', query: z.object({ path: z.string().optional() }), response: L.FolderTree }),
  setFolderFavorite: d({ method: 'PUT', path: '/api/v2/folders/favorite', auth: 'user', body: L.SetFolderFavoriteBody, response: Ok }),
  favoriteFolders: d({ method: 'GET', path: '/api/v2/folders/favorites', auth: 'user', response: L.FavoriteFolders }),
  listAlbums: d({ method: 'GET', path: '/api/v2/albums', auth: 'user', response: L.AlbumList }),
  createAlbum: d({ method: 'POST', path: '/api/v2/albums', auth: 'user', body: L.CreateAlbumBody, response: L.Album }),
  getAlbum: d({ method: 'GET', path: '/api/v2/albums/:id', auth: 'user', response: L.Album }),
  updateAlbum: d({ method: 'PATCH', path: '/api/v2/albums/:id', auth: 'user', body: L.UpdateAlbumBody, response: L.Album }),
  deleteAlbum: d({ method: 'DELETE', path: '/api/v2/albums/:id', auth: 'user', response: null }),
  addAlbumItems: d({ method: 'POST', path: '/api/v2/albums/:id/items', auth: 'user', body: L.AlbumItemsBody, response: M.UpdatedCount }),
  removeAlbumItems: d({ method: 'DELETE', path: '/api/v2/albums/:id/items', auth: 'user', body: L.AlbumItemsBody, response: M.UpdatedCount }),

  // 分享
  listShares: d({ method: 'GET', path: '/api/v2/shares', auth: 'user', query: z.object({ all: z.string().optional() }), response: S.ShareList }),
  createShare: d({ method: 'POST', path: '/api/v2/shares', auth: 'user', body: S.CreateShareBody, response: S.Share }),
  deleteShare: d({ method: 'DELETE', path: '/api/v2/shares/:id', auth: 'user', response: null }),
  publicShare: d({ method: 'GET', path: '/api/v2/public/shares/:token', auth: 'public', response: S.PublicShare }),
  unlockShare: d({ method: 'POST', path: '/api/v2/public/shares/:token/unlock', auth: 'public', body: S.UnlockShareBody, response: null }),
  publicShareMedia: d({ method: 'GET', path: '/api/v2/public/shares/:token/media', auth: 'public', query: S.PublicMediaQuery, response: M.MediaPage }),

  // 管理
  adminOverview: d({ method: 'GET', path: '/api/v2/admin/overview', auth: 'admin', response: Ad.AdminOverview }),
  listLibraries: d({ method: 'GET', path: '/api/v2/admin/libraries', auth: 'admin', response: Ad.LibraryList }),
  createLibrary: d({ method: 'POST', path: '/api/v2/admin/libraries', auth: 'admin', body: Ad.CreateLibraryBody, response: Ad.Library }),
  updateLibrary: d({ method: 'PATCH', path: '/api/v2/admin/libraries/:id', auth: 'admin', body: Ad.UpdateLibraryBody, response: Ad.Library }),
  deleteLibrary: d({ method: 'DELETE', path: '/api/v2/admin/libraries/:id', auth: 'admin', response: null }),
  libraryChanges: d({ method: 'GET', path: '/api/v2/admin/libraries/:id/changes', auth: 'admin', query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }), response: Ad.LibraryChangeList }),
  mounts: d({ method: 'GET', path: '/api/v2/admin/mounts', auth: 'admin', response: Ad.MountList }),
  fsList: d({ method: 'GET', path: '/api/v2/admin/fs', auth: 'admin', query: z.object({ path: z.string().optional() }), response: Ad.FsListing }),
  getSettings: d({ method: 'GET', path: '/api/v2/admin/settings', auth: 'admin', response: Ad.AdminSettings }),
  updateSettings: d({ method: 'PATCH', path: '/api/v2/admin/settings', auth: 'admin', body: Ad.AdminSettingsPatch, response: Ad.AdminSettings }),
  listJobs: d({ method: 'GET', path: '/api/v2/admin/jobs', auth: 'admin', query: z.object({ status: Ad.JobStatus.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), response: Ad.JobList }),
  createJob: d({ method: 'POST', path: '/api/v2/admin/jobs', auth: 'admin', body: Ad.CreateJobBody, response: Ad.Job }),
  jobAction: d({ method: 'POST', path: '/api/v2/admin/jobs/:id/:action', auth: 'admin', response: Ad.Job }),
  listUsers: d({ method: 'GET', path: '/api/v2/admin/users', auth: 'admin', response: Ad.UserList }),
  createUser: d({ method: 'POST', path: '/api/v2/admin/users', auth: 'admin', body: Ad.CreateUserBody, response: A.User }),
  updateUser: d({ method: 'PATCH', path: '/api/v2/admin/users/:id', auth: 'admin', body: Ad.UpdateUserBody, response: A.User }),
  deleteUser: d({ method: 'DELETE', path: '/api/v2/admin/users/:id', auth: 'admin', response: null }),
  logs: d({ method: 'GET', path: '/api/v2/admin/logs', auth: 'admin', query: z.object({ level: z.string().optional(), limit: z.coerce.number().int().min(1).max(1000).default(200) }), response: Ad.LogList }),
  system: d({ method: 'GET', path: '/api/v2/admin/system', auth: 'admin', response: Ad.SystemInfo }),
} as const;

export type Endpoints = typeof endpoints;
export type EndpointName = keyof Endpoints;
