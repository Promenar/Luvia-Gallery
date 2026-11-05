/**
 * v1 兼容接口（仅为 macOS 小组件与 Wallpaper Engine 壁纸保留，WebUI 不使用）。
 * 响应结构必须与 v1（main 分支 server.js）逐字段一致，客户端无需改动即可继续工作。
 *
 * 鉴权：`Authorization: Bearer <t>` 或 `?token=<t>`，t 可以是：
 *   1. v2 个人访问令牌（scope=read 或 wallpaper）；
 *   2. 迁移导入的 v1 壁纸令牌（导入为 scope=wallpaper 的访问令牌，明文不变）；
 *   3. v1 JWT（用原 data/jwt_secret.key 验签，过渡期有效）。
 * 仅以下路径接受 query token，其余 v2 接口一律拒绝 URL 令牌。
 *
 * - GET /api/scan/results?random=&limit=&offset=&recursive=&favorites=&folder=&mediaType=
 *       → { files: LegacyFile[], total, hasMore, totalExact, sources[] }
 *       LegacyFile = { id, url, thumbnailUrl, name, folderPath, size, type, lastModified, mediaType, sourceId, isFavorite, width, height, aspectRatio }
 *       其中 id 为 v1 ID（绝对路径的 base64），url/thumbnailUrl 指向下列 v1 资源路径。
 * - GET /api/thumb/:legacyId   → 缩略图（WebP）
 * - GET /api/file/:legacyId    → 原文件（Range）
 * - GET /api/library/folders?path= → v1 目录列表结构
 * - POST /api/auth/login       → { token, user }（签发 v1 兼容 JWT，供尚未升级的客户端登录）
 */
export const legacyPaths = ['/api/scan/results', '/api/thumb/', '/api/file/', '/api/library/folders', '/api/auth/login'] as const;
