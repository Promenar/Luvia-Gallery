# Luvia Server 候选

当前包提供 API 与 worker 双进程入口，并包含数据库、安全、查询、扫描和迁移模块的部分实现。完整接口和媒体管线尚未就绪，不能用于生产数据或接管 v1。

已实现账户偏好深度合并、壁纸令牌配置与随机浏览的直接目录和排除筛选。会话写请求使用 `X-Luvia-Request: 1`，Bearer 令牌请求不依赖该标头。

管理员可创建、查询和控制作业；`/api/v2/events` 提供作业与媒体库变化事件。worker 已接入扫描、旧库导入和健康检查，其他作业尚未实现并会报告失败。

扫描会物化真实目录层级与计数，并按媒体库排除规则跳过系统目录。文件夹接口按用户权限过滤，并根据设置决定是否展示宿主机路径；Linux 挂载解析支持 `LUVIA_HOST_PATHS` 映射。

使用 Node 24 运行当前测试和类型检查：

```sh
npx -y -p node@24 -- pnpm --filter @luvia/server test
npx -y -p node@24 -- pnpm --filter @luvia/server typecheck
```

使用 Node 24 启动本地双进程：

```sh
DATA_DIR=./data CACHE_DIR=./cache MEDIA_ROOT=/path/to/fixture npx -y -p node@24 -- pnpm --filter @luvia/server dev
```

`/healthz` 检查 API 事件循环，`/readyz` 还要求 worker 心跳正常。worker 启动时探测 FFmpeg 和 NVENC 单帧编码能力；探测结果可从管理员系统接口读取。在 macOS 开发环境中，`MEDIA_ROOT` 指定本地合成媒体目录；Linux 环境以 mountinfo 中检测到的候选挂载限制扫描范围。

现有测试使用临时合成数据，不代表大媒体库性能、真实旧库迁移或生产环境验收。作业领取与扫描锁支持租约，扫描支持目录级断点。旧版导入只迁移用户数据并保留待匹配收藏；完整生产迁移、媒体管线与端到端性能尚未验收。
