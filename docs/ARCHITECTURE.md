# 架构全景 (Architecture Overview)

## 移动端

生产移动端目前仍以 `mobile/` 的 Expo / React Native 实现为基线。`native-ui/` 是正在进行的 Android
原生迁移；截至 Phase 1，它是可构建的登录垂直切片，不可视为完整替代品或发布客户端。

### Android 原生端（native-ui，Phase 1）

- **应用标识与 SDK**：`applicationId` / namespace 为 `com.promenar.luvia`；`compileSdk` 与 `targetSdk`
  均为 36，`minSdk` 为 26，Java/Kotlin 目标为 17。
- **构建基线**：AGP 9.0.1、Gradle 9.1.0、Kotlin 2.4.10、Jetpack Compose BOM 2026.06.00。
- **模块边界**：`:app` 负责启动与认证态分流；`:core:model` 定义不可变会话模型；`:core:network`
  处理 URL、认证头和登录 API；`:core:designsystem` 提供 Material 3 主题；`:feature:auth` 提供登录状态、
  ViewModel 和登录界面。
- **已实现主链路**：受控服务器地址校验、Retrofit 协程 `suspend` 登录请求与结果映射，以及 Material 3
  登录页。登录成功后只在 ViewModel 内保留认证布尔态并进入明确标识为“原生重构进行中”的主壳；
  `Session` / token 尚未保存。唯一 Bearer 认证头组件已实现并测试，但尚未接入后续认证客户端。
- **安全边界**：地址解析器接受受控的 HTTP/HTTPS 地址，但 Manifest 不启用全局明文流量，当前发行构建应使用 HTTPS；网络层不将响应体或异常敏感内容暴露给 UI，协程取消继续传播。

### 验证状态与未完成边界

已验证工程约束、网络与认证单元测试、Debug APK 构建和 Lint；主要命令为：

```bash
cd native-ui
./gradlew testDebugUnitTest lintDebug :app:assembleDebug --no-daemon
```

当前无已连接的 Android 设备或模拟器。Compose AndroidTest 已完成编译，但尚未在真机或模拟器实际运行。
原生图库、文件夹、收藏、媒体播放、设置、管理、Session/token 保存与加密持久会话、完整导航及端到端
UI 验证均留待后续阶段。

## 后端与 Web 端
(保持原有架构，见旧版文档)
