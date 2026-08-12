# 数据结构字典 (Data Schema)

## 移动端本地存储 (Jetpack DataStore)

文件位置: `/data/data/com.luvia.gallery.nativeui/files/datastore/settings.preferences_pb`

| 键名 (Key) | 类型 (Type) | 说明 (Description) |
| :--- | :--- | :--- |
| `server_url` | String | 用户输入的服务器基准地址 (e.g. `192.168.1.100:3000`) |
| `auth_token` | String | 登录成功后返回的 JWT Token |

## 网络传输实体 (API Entities)

### MediaItem (媒体项)
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `id` | String | 唯一标识符 (MD5/UUID) |
| `name` | String | 文件名 |
| `url` | String | 全量媒体资源访问地址 |
| `thumbnailUrl` | String | 预览图地址 |
| `mediaType` | String | 类型: `image`, `video`, `audio` |
| `isFavorite` | Boolean | 是否已收藏 |
| `width` | Int \| null | 已生成缩略图的宽度；缺失时前端使用稳定比例回退 |
| `height` | Int \| null | 已生成缩略图的高度；缺失时前端使用稳定比例回退 |
| `aspectRatio` | Float \| null | 已生成缩略图宽高比，用于加载前锁定卡片几何 |

### ScanResultsPage (媒体分页)

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `files` | MediaItem[] | 当前页媒体；WebUI 默认每页 120 条 |
| `total` | Int | `totalExact=true` 时为精确总数，否则为已知下界和一个续页哨兵 |
| `totalExact` | Boolean | 总数是否精确；过滤、搜索或用户授权作用域通常在末页前为 `false` |
| `hasMore` | Boolean | 服务端通过多取一条记录判断是否存在续页 |
| `sources[].countExact` | Boolean | 与当前响应 `totalExact` 相同的数据源计数精确度 |

### SystemStatus.mediaStats (系统媒体统计)

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `totalFiles` / `images` / `videos` / `audio` | Int | `exact=true` 时为精确统计；`exact=false` 时是兼容响应结构的零占位，不代表授权范围内没有媒体 |
| `exact` | Boolean | 管理员读取 `library_stats` 时为 `true`；受限账号为避免首包同步全量统计而返回 `false` |

### Folder (文件夹)
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `name` | String | 文件夹名称 |
| `path` | String | 逻辑路径 |
| `mediaCount` | Int | 包含的媒体数量 |

### ExifData (EXIF 信息)
| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `model` | String | 设备型号 |
| `iso` | Int | 感光度 |
| `exposureTime` | String | 曝光时间 (e.g. `1/100`) |
| `fNumber` | String | 光圈值 (e.g. `f/2.8`) |

## Web 服务端派生缓存

### library_stats

`library_stats` 固定保存一行全局媒体计数，由 `files` 表的插入、删除和媒体类型更新触发器增量维护。扫描状态接口和管理员无筛选全库分页只读取该行，避免轮询或首包期间执行全库计数。带搜索、媒体类型、收藏、目录或用户授权路径范围的分页不执行同步精确计数，通过 `totalExact` 表达已知下界。受限账号的系统状态同样不在请求热路径执行四次权限范围 `COUNT`，而是返回 `mediaStats.exact=false`，前端显示未知值。

### folders 与 thumbnails

`folders.cover_file_id` 和 `folders.cover_last_modified` 保存已经具备有效缩略图的目录封面候选；`thumbnails` 保存媒体 ID 与缩略图路径。目录列表通过两张派生表连接读取，不在请求期间递归查询后代媒体。

历史数据库由后台任务按 `files.rowid` 分批核验缩略图，进度存放在 `app_meta.folder_cover_backfill_v1`。这些表均属于可重建派生数据，不是媒体文件本体。

### 媒体分页索引

Web 服务启动时幂等保证以下热路径索引存在：

- `idx_files_date_desc_id(last_modified DESC, id ASC)`：默认最新优先分页。
- `idx_files_media_date_desc_id(media_type, last_modified DESC, id ASC)`：媒体类型筛选分页。
- `idx_files_folder_date_desc_id(folder_path, last_modified DESC, id ASC)`：单层文件夹分页。
- `idx_files_size_desc_id(size DESC, id ASC)`：文件大小倒序分页。
- `idx_files_media_size_desc_id(media_type, size DESC, id ASC)`：媒体类型筛选后的文件大小分页。
- `idx_files_folder_size_desc_id(folder_path, size DESC, id ASC)`：单层文件夹内的文件大小分页。
- `idx_favorites_user_type_item(user_id, item_type, item_id)`：从当前用户收藏集合按媒体 ID 回表。

收藏热查询只使用媒体 ID 连接；历史 path 收藏仅在启动迁移时且对应文件存在时归一化为 ID，查询路径不使用 `OR path`。迁移在单一事务内先删除已有 canonical ID 收藏对应的冲突 path 行，再更新其余可映射记录，并允许重复执行。
