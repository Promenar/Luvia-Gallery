# WebUI 缩略图加载恢复

## 目标与证据

用户报告瀑布流滚动中部分缩略图持续空白，停留不会恢复，滚出再返回偶尔恢复。源码显示卡片在被动 effect 中重置加载状态、没有读取已完成图片状态、请求失败没有重试，且带鉴权参数的缩略图地址无法通过原地址比较进入回退。

## 实施与所有权

主控独占 `components/PhotoCard.tsx`、`test/photo-card-loading.test.tsx` 及治理文档。先编写回归测试证明缓存命中、短暂失败和鉴权地址回退问题，再修复卡片加载生命周期。状态按媒体与来源隔离，重试有退避和次数上限，卸载清理定时器；图片保留原图回退，视频封面不得回退到视频文件作为图片。沿用浏览器懒加载和首屏优先级，不变更分页、布局、接口、鉴权或数据库。

## 验收

- `NODE_OPTIONS=--no-experimental-webstorage npm run test:frontend -- test/photo-card-loading.test.tsx test/photo-card-layout.test.ts`：先红后绿。
- `NODE_OPTIONS=--no-experimental-webstorage npm run test:frontend`、`npm run build`、`git diff --check`。
- 本机回环地址上的真实 Chromium：实际 MasonryViewport，合成媒体、受控延迟和短暂请求失败，滚动后检查可见图片解码、显示状态及重试请求数量；测试材料置于仓库外。
- 实现完成后独立只读审阅加载竞态、重试放大及回归风险；主控核对发现。

## 边界与回滚

PDEC 当前校验为 approved、execution_ready=true，web-test/web-build 在本机，容器在 FNOS 原生 Linux x86_64 构建。用户已明确授权提交、推送并部署到 FNOS；该授权限于缩略图修复，不扩大为自动部署策略。生产现象的实际触发原因仍需区分于合成复现结果；不把测试环境通过等同于生产验收。不执行真实媒体再生成、迁移或删除。

## FNOS 发布步骤

1. 核对本任务差异和此前验证适用性，提交推送 `main`，回读 GitHub SHA。
2. 从确切 SHA 准备独立源码归档，在 FNOS 构建带 revision 标签的不可变镜像；源码与执行材料走已有 Mac 到 FNOS 的 SSH 通道，不转发认证代理。
3. 保存当前生产镜像 ID、回滚标签、现有 Compose 与数据配置备份；SQLite 使用在线一致性备份并验证 `quick_check`。凭据仅由主机本地工具安全使用，日志不输出其值。
4. 候选使用独立数据库副本、独立缓存和只读媒体，在回环端口验证页面、静态资源、3001/3002、鉴权及修复产物。候选不挂载 SSH 密钥或写入生产数据。
5. 给同一已验证镜像标记 `latest`，通过现有 Compose 对 `luvia-gallery` 执行 `up -d --force-recreate --no-deps --pull never`，不改变 Compose 挂载和网络契约。失败时用保存的镜像恢复原标签并重建服务。
6. 核对生产镜像 ID/revision、静态资源摘要、restart/OOM、首页/API、数据库和真实缩略图请求，移除本任务临时候选容器，保留备份和回滚镜像。
7. 更新发布说明和 HLG，以文档提交推送收口；构建版本和最终文档提交分别披露。

## 验证结果

- 新增 12 项加载生命周期与回退测试，初始 9 项测试在旧代码上有 7 项按预期失败；修复后定向 19/19、全量前端 295/295 通过。运行 Node 26 时通过 `NODE_OPTIONS=--no-experimental-webstorage` 使用 jsdom 的存储实现；播放器既有 act/EXIF mock 告警保留。
- Vite 生产构建通过，保留既有 CJS、Browserslist 与大 chunk 告警；变更组件及新增测试的独立 TypeScript 检查通过。完整仓库 `tsc --noEmit` 被 `utils/animation.ts` 中既有 JSX 语法错误阻断，该文件 SHA-256 与 HEAD 相同。
- Browser plugin/skill 未提供，使用已有 Playwright CLI 与 Chrome，无依赖安装。浏览器地址为 `http://127.0.0.1:4318/__qa`（HEAD 源码）和 `http://127.0.0.1:4319/__qa`（工作树）；1440×960 与 390×844，4 倍 CPU 降速。
- 600 条合成媒体、120 条分页、120–360ms 响应延迟、每三张缩略图首次请求返回 503。旧代码六处滚动采样缺图分别为 6/8/9/8/6/14，缓存复访直接观察到 9 张图片 `complete=true`、`naturalWidth=300`、`opacity=0`、`state=loading`。证明加载状态与真实图片状态能够失步，不证明这是生产环境的唯一原因。
- 修复代码在六处滚动采样中共 121 个可见卡片均完成解码和显示；最多每张两次请求，原图回退请求为 0。窄屏重排后的首、中、尾三处采样和缓存刷新通过；点击媒体回调、页面内容与无 Vite 错误遮罩检查通过。最终有效运行控制台仅有预设的 503，环境重启期间的两次连接拒绝不计作业务故障。
- 未修改后端，因此未重复后端测试；未测试真实生产媒体、生产代理/磁盘压力及 Safari。
