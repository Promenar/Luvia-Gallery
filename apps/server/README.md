# Luvia Server 候选

当前包包含数据库、安全、查询和扫描迁移模块的部分实现。HTTP 与 worker 入口、完整接口和媒体管线尚未就绪，不能用于生产数据或接管 v1。

已实现账户偏好深度合并、壁纸令牌配置与随机浏览的直接目录和排除筛选。会话写请求使用 `X-Luvia-Request: 1`，Bearer 令牌请求不依赖该标头。

使用 Node 24 运行当前测试和类型检查：

```sh
npx -y -p node@24 -- pnpm --filter @luvia/server test
npx -y -p node@24 -- pnpm --filter @luvia/server typecheck
```

现有测试使用临时合成数据，不代表大媒体库性能、真实旧库迁移或生产环境验收。扫描锁尚缺进程异常退出后的恢复机制；旧版异常时间戳需要人工核验。
