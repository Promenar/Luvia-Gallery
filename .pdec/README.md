# Luvia-Gallery PDEC

状态：`approved`（2026-09-07 已获得项目适配批准）。机器字段在 `contract.yaml`，本说明记录选择依据、当前入口、迁移差异和执行门禁。

## 项目与范围

- 项目：Luvia Gallery，GitHub 远端为 `https://github.com/Promenar/Luvia-Gallery.git`。
- 当前快照：`main` 与 `origin/main` 一致，HEAD 为 `1053cb833e116f62f130626718efec263bf8caf5`；FNOS 源码同步已建立并完成首次成功运行，未触发构建或生产部署。
- 本契约第一阶段覆盖 Web React/Vite、Node.js/SQLite 服务、Docker 容器和 macOS 悬浮窗 App。
- `mobile/` 与 `native-ui/` 的 Android 执行主机已批准为 `main`；PDEC v1 的 `target_os` 枚举不包含 Android，因此当前只在 `main` target 的 `roles` 和本说明中登记执行主机，不用 Windows 目标冒充 Android 产物。Android 的 SDK/JDK、产物和设备验收字段仍待后续 Android 适配器支持。

## 候选执行位置

| 别名 | 用途 | 当前证据 | 状态 |
| --- | --- | --- | --- |
| `local-mac` | Web 日常检查、macOS Widget 测试与打包 | 本轮实测 Darwin arm64、Node `v26.5.1`、npm `11.17.0`、Docker `29.7.1`、Compose `5.3.1`、Xcode `26.6`、Swift `6.3.3` | 已核验主机；Node 版本与 Docker 固化的 Node 20 尚未统一 |
| `fnos` | Linux x86_64 源码同步、容器构建及生产候选验证 | 2026-09-07 实机复核为 Linux x86_64，Git 2.39.2、Python 3.11.2；源码同步 timer、service、DevFleet 根与生产目录隔离均已核验 | 源码同步已核验；容器构建和生产候选执行前仍需复核 |
| `main` | Windows 专属构建与 Android 执行主机 | `remote-development` 主机证据（2026-09-06）记录为 Windows 11 x86_64，开发卷与缓存布局已有登记 | 已批准作为 Android 执行主机；本轮未重新连接核验，执行前必须复核 |

设备路径、凭据、令牌、SSH 配置和生产数据库真实位置不写入契约；它们只由已授权执行器的本机配置提供。

## 已发现入口与候选操作

- Web 测试：`npm test`，包含后端 Node 测试和前端 Vitest。
- Web 构建：`npm run build`，产物目录为项目相对的 `dist/`。
- 容器构建：`docker build --tag promenarleng/luvia-gallery:candidate .`，候选执行位置为 `fnos`，目标为 Linux x86_64。正式任务必须把候选标签替换为绑定确切 Git SHA 的不可变标识，并保留镜像摘要。
- macOS Widget 核心测试：在 `macos-widget/` 执行 `swift test`。
- macOS Widget Release：执行 `bash macos-widget/scripts/package_release.sh`，项目相对产物为 `macos-widget/dist/LuviaGalleryWidget.app.zip`；签名身份、开发者账号和安装验收仍需单独确认。

这些操作已写入 `contract.yaml` 并纳入批准范围。尤其是本机 Node 26 与 Docker/历史验证采用的 Node 20 存在工具链一致性门禁；不能仅凭“命令存在”宣称测试可复现。

## 当前方式与迁移差异

现有项目以 Mac 编辑、GitHub `main` 为版本中心，Web 本地入口为 npm/Vite，生产镜像由 Dockerfile 构建，历史生产候选在 FNOS Linux x86_64 上进行旁路验证后切换。FNOS 现已在独立 DevFleet 源码根登记 `Luvia-Gallery` 裸仓库，并由受限 systemd oneshot/timer 增量同步；同步、构建、浏览器/设备验收和生产切换仍是独立步骤。近期交接记录还保留了 SQLite 一致性备份、只读媒体挂载、生产零重启检查和回滚镜像标签等证据。

PDEC 已从无机器可读契约切换为已批准契约；后续开发、构建、联调和部署应绑定项目、确切 SHA、契约摘要、工具链、执行位置、操作名和任务身份。源码同步已作为独立主机服务落地，不由 PDEC 自动触发构建或部署；构建触发、浏览器/设备验收和生产切换仍是独立步骤。

## 源码同步状态

- FNOS 源码根为主机本地配置 `/vol2/1000/FRAGMENTS/DevFleet`；`Luvia-Gallery` 登记为 `luvia-gallery`，目标为该目录下的 `repository.git` 裸仓库。
- 同步源为公开 GitHub `https://github.com/Promenar/Luvia-Gallery.git`，GitHub `main` 仍是唯一版本中心；同步器只增量 fetch 分支和标签，不检出活动工作区、不强制覆盖分歧、不执行项目脚本。
- `devfleet-source-sync.service` 以普通用户 `Promenar` 运行，`devfleet-source-sync.timer` 使用约 2 分钟间隔；服务仅允许写入 DevFleet，配置保留在 FNOS 主机本地并已保留登记前备份。
- 2026-09-07 首次 apply 与 systemd 即时触发均成功；FNOS 裸仓库 `refs/heads/main` 已核验精确指向 `1053cb833e116f62f130626718efec263bf8caf5`。源码根与生产 `/vol2/1000/APPDATA` 分离，源码同步不会触碰生产容器。
- 源码登记与 PDEC 批准相互独立；后续若修改同步根、仓库 URL、调度器或权限，必须重新执行主机核验并更新本说明及 HLG。

执行前仍需复核或补齐的字段：

1. 每次执行前复核 `fnos`、`main` 的当前可达性、架构、工具链版本与执行器生命周期；FNOS 源码同步链路已核验，主机选择本身已批准。
2. Web 测试应固定在 Node 20 容器、FNOS，还是补齐本机 Node 20 后使用 `local-mac`。
3. Docker 构建采用 FNOS 原生构建，还是 Mac buildx 交叉构建；若交叉构建，必须同时填写机制和目标环境验证。
4. 生产传输路线、生产目标别名、健康检查、回滚标识和当前任务的部署批准。当前 `deployment.enabled=false`，本次源码同步授权不等于生产部署授权。
5. Android/mobile 的目标平台、签名/产物位置、设备联调与 CI 执行器；Android 执行主机已确定为 `main`，但 PDEC v1 尚不能登记 Android 产物目标。

## 审批与执行门禁

用户批准消息为：“Android端的目标PDEC平台可以设置至MAIN主机，其它批准”。该批准将 Android 执行主机设置为 `main`，并批准其余已登记候选操作；本次没有批准生产部署，因此 `deployment.enabled` 保持 `false`。本契约使用该真实消息作为 `approval.reference`，并绑定 `inspect` 生成的 `contract_digest`。

2026-10-02 用户确认“同意重绑”：`package.json` 新增 `typecheck` 脚本、`README.md` 与 `docker-compose.yml` 更新 `UPDATE_TOKEN` 注释后，仅重算证据哈希并绑定新摘要 `977e5f32018c3b372f9b8d754d0d41e9cf61bfd4a9e6ee3c0582ad164f3dae7f`，执行字段与执行位置不变。

2026-10-02 用户再次确认“同意重绑，AGENTS.md 也更新”：Tailwind v4 + shadcn/Base UI 升级改动 `package.json`、`package-lock.json`、`README.md` 与 `AGENTS.md` 后重算证据哈希，绑定摘要 `fe19ae8f7a4cca6edde76a9d778b8f4404bf2477945621fd48e78febe494c73a`，执行字段与执行位置不变。

批准后每次执行前必须运行 `pdec.py validate --root .`，确认退出码为 0 且 `execution_ready=true`；契约批准不等于生产部署批准。契约证据文件发生变化时必须重新评估漂移并重新绑定批准摘要。

## 回滚与验收边界

当前仅登记候选构建，没有生产切换。未来如启用部署，必须先用一致性数据库副本和只读媒体完成旁路验证，传输后按同一产物摘要切换，记录健康检查、数据库迁移限制、生产重启/OOM状态和可用回滚标签。自动化通过只证明机器门禁，不替代真实浏览器、设备、用户和发布验收。
