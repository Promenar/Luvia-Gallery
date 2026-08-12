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

`library_stats` 固定保存一行全局媒体计数，由 `files` 表的插入、删除和媒体类型更新触发器增量维护。扫描状态接口只读取该行，避免轮询期间执行全库计数。带用户授权路径范围的统计仍使用原有作用域查询，不读取全局值。

### folders 与 thumbnails

`folders.cover_file_id` 和 `folders.cover_last_modified` 保存已经具备有效缩略图的目录封面候选；`thumbnails` 保存媒体 ID 与缩略图路径。目录列表通过两张派生表连接读取，不在请求期间递归查询后代媒体。

历史数据库由后台任务按 `files.rowid` 分批核验缩略图，进度存放在 `app_meta.folder_cover_backfill_v1`。这些表均属于可重建派生数据，不是媒体文件本体。
