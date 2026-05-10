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
