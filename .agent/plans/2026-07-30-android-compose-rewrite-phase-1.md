# Android Compose 原生重构第一阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不删除 Expo 客户端的前提下，用可构建、可测试的 Kotlin + Jetpack Compose + Material 3 工程替换失效的 `native-ui/` 骨架，并交付安全会话与登录主链路。

**Architecture:** 新应用保持单 Activity 和单向数据流，第一阶段采用聚焦的 `:app`、`:core:model`、`:core:network`、`:core:designsystem`、`:feature:auth` 模块；后续功能稳定后再增加数据库、媒体和业务 Feature 模块。远端 DTO、领域模型和 UI 状态分离，Bearer Token 只通过请求头传输。

**Tech Stack:** Android Gradle Plugin 9.0.1、Gradle 9.1.0、Kotlin 2.4.10、JDK 17 toolchain、Compose BOM 2026.06.00、Material 3、Navigation 3、Retrofit、OkHttp、kotlinx.serialization、DataStore、JUnit、MockWebServer。

## Global Constraints

- Android `applicationId` 必须保持 `com.promenar.luvia`，以支持现有应用原位升级。
- `minSdk` 为 26，`compileSdk` 和 `targetSdk` 为 36。
- `mobile/` 在功能对齐和灰度发布完成前不得删除或改写。
- 旧 `native-ui/` 仅作为功能线索，允许整体替换，不继承其包名与不完整架构。
- 所有新增文档和代码注释使用简体中文；用户可见字符串集中在 Android resources。
- 使用 Material 3 标准主题和组件；图库专属交互之外不创建替代标准组件的自定义控件。
- Token 禁止出现在 URL、日志、异常文本和缓存键中；认证只使用 `Authorization: Bearer` 请求头。
- 业务逻辑严格执行测试先行；配置和生成型 Wrapper 文件不适用单元测试。
- 第一阶段不实现图库、播放器、管理后台和 iOS 重构。

---

### Task 1: 重建可验证的 Android 工程骨架

**Files:**
- Replace: `native-ui/settings.gradle.kts`
- Replace: `native-ui/build.gradle.kts`
- Replace: `native-ui/gradle/libs.versions.toml`
- Create: `native-ui/gradle.properties`
- Create: `native-ui/gradlew`
- Create: `native-ui/gradlew.bat`
- Create: `native-ui/gradle/wrapper/gradle-wrapper.jar`
- Create: `native-ui/gradle/wrapper/gradle-wrapper.properties`
- Replace: `native-ui/app/build.gradle.kts`
- Replace: `native-ui/app/src/main/AndroidManifest.xml`
- Create: `native-ui/app/src/main/res/drawable/ic_launcher_foreground.xml`
- Create: `native-ui/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Create: `native-ui/app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`
- Replace: `native-ui/app/src/main/res/values/strings.xml`
- Replace: `native-ui/app/src/main/res/values/themes.xml`
- Create: `native-ui/core/model/build.gradle.kts`
- Create: `native-ui/core/network/build.gradle.kts`
- Create: `native-ui/core/designsystem/build.gradle.kts`
- Create: `native-ui/feature/auth/build.gradle.kts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Android SDK 36 与 JDK 17 toolchain。
- Produces: `:app`、`:core:model`、`:core:network`、`:core:designsystem`、`:feature:auth` 五个可解析模块；`./gradlew projects` 和 `./gradlew :app:assembleDebug` 可执行。

- [ ] **Step 1: 写入构建约束检查脚本**

在 `native-ui/scripts/verify-project.sh` 中检查 `applicationId = "com.promenar.luvia"`、五个模块声明、`compileSdk = 36`、`targetSdk = 36`、`minSdk = 26`，任一缺失即退出 1。

- [ ] **Step 2: 运行检查并确认旧骨架失败**

Run: `cd native-ui && bash scripts/verify-project.sh`

Expected: FAIL，至少报告旧包名或模块缺失。

- [ ] **Step 3: 重建 Gradle 工程与 Wrapper**

使用版本目录集中声明全局约束中的版本。AGP 9 使用内置 Kotlin 支持，不应用 `org.jetbrains.kotlin.android` 插件；Android 模块统一启用 Compose、Java 17 和 Kotlin JVM target 17。删除版本控制中的 `.gradle/`、`build/`、`local.properties`，并在仓库 `.gitignore` 中忽略这些本机产物。

- [ ] **Step 4: 创建最小模块和应用资源**

所有 Library 模块使用 `com.android.library`；命名空间分别为 `com.promenar.luvia.core.model`、`com.promenar.luvia.core.network`、`com.promenar.luvia.core.designsystem` 和 `com.promenar.luvia.feature.auth`。Manifest 仅申请 `INTERNET` 与 `ACCESS_NETWORK_STATE`，第一阶段不得申请媒体读取权限或开启全局明文流量。

- [ ] **Step 5: 运行工程检查与构建**

Run: `cd native-ui && bash scripts/verify-project.sh && ./gradlew projects && ./gradlew :app:assembleDebug`

Expected: 所有命令退出 0，APK 生成于 `app/build/outputs/apk/debug/app-debug.apk`。

- [ ] **Step 6: 提交**

```bash
git add .gitignore native-ui
git commit -m "build(android): 重建 Compose 多模块工程"
```

### Task 2: 实现安全网络与会话基础

**Files:**
- Create: `native-ui/core/model/src/main/kotlin/com/promenar/luvia/core/model/Session.kt`
- Create: `native-ui/core/network/src/main/kotlin/com/promenar/luvia/core/network/ApiResult.kt`
- Create: `native-ui/core/network/src/main/kotlin/com/promenar/luvia/core/network/AuthHeaderInterceptor.kt`
- Create: `native-ui/core/network/src/main/kotlin/com/promenar/luvia/core/network/ServerUrl.kt`
- Create: `native-ui/core/network/src/main/kotlin/com/promenar/luvia/core/network/auth/AuthApi.kt`
- Create: `native-ui/core/network/src/main/kotlin/com/promenar/luvia/core/network/auth/AuthDtos.kt`
- Create: `native-ui/core/network/src/main/kotlin/com/promenar/luvia/core/network/auth/AuthRepository.kt`
- Create: `native-ui/core/network/src/test/kotlin/com/promenar/luvia/core/network/AuthHeaderInterceptorTest.kt`
- Create: `native-ui/core/network/src/test/kotlin/com/promenar/luvia/core/network/ServerUrlTest.kt`
- Create: `native-ui/core/network/src/test/kotlin/com/promenar/luvia/core/network/auth/AuthRepositoryTest.kt`

**Interfaces:**
- Consumes: `Session(token: String, username: String, isAdmin: Boolean)`。
- Produces: `ServerUrl.parse(raw: String): Result<HttpUrl>`；`AuthHeaderInterceptor`；`AuthRepository.login(serverUrl: HttpUrl, username: String, password: String): ApiResult<Session>`。

- [ ] **Step 1: 编写 ServerUrl 失败测试**

覆盖自动补全 `https://`、保留显式端口、拒绝 query/fragment/userInfo、统一尾部 `/`、拒绝非 HTTP(S) 协议。

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd native-ui && ./gradlew :core:network:testDebugUnitTest --tests '*ServerUrlTest'`

Expected: FAIL，因为 `ServerUrl` 尚不存在。

- [ ] **Step 3: 实现 ServerUrl 并确认测试通过**

解析失败返回 `Result.failure(IllegalArgumentException)`，错误文本不得包含凭证。

- [ ] **Step 4: 编写 Bearer Header 失败测试**

验证有 token 时请求只增加 `Authorization: Bearer <token>`，空 token 时不增加认证头，原 URL 不发生变化。

- [ ] **Step 5: 实现 AuthHeaderInterceptor 并确认测试通过**

Token 通过构造参数 `tokenProvider: () -> String?` 获取，不记录请求头和 URL。

- [ ] **Step 6: 编写登录仓库失败测试**

使用 MockWebServer 验证 POST `/api/auth/login`、JSON 请求体、成功映射 Session、401 映射认证失败、5xx 映射服务端失败、响应与异常不泄漏密码。

- [ ] **Step 7: 实现 DTO、AuthApi、ApiResult 与 AuthRepository**

`ApiResult` 使用 `Success<T>`、`Unauthorized`、`HttpError(code: Int)`、`NetworkError`、`InvalidResponse`；不得把响应体原文直接作为用户错误。

- [ ] **Step 8: 运行网络模块测试**

Run: `cd native-ui && ./gradlew :core:network:testDebugUnitTest`

Expected: 全部通过。

- [ ] **Step 9: 提交**

```bash
git add native-ui/core
git commit -m "feat(android): 实现安全认证网络层"
```

### Task 3: 实现 MD3 设计系统与登录主链路

**Files:**
- Create: `native-ui/core/designsystem/src/main/kotlin/com/promenar/luvia/core/designsystem/theme/LuviaTheme.kt`
- Create: `native-ui/core/designsystem/src/main/kotlin/com/promenar/luvia/core/designsystem/theme/Type.kt`
- Create: `native-ui/feature/auth/src/main/kotlin/com/promenar/luvia/feature/auth/LoginContract.kt`
- Create: `native-ui/feature/auth/src/main/kotlin/com/promenar/luvia/feature/auth/LoginViewModel.kt`
- Create: `native-ui/feature/auth/src/main/kotlin/com/promenar/luvia/feature/auth/LoginScreen.kt`
- Create: `native-ui/feature/auth/src/test/kotlin/com/promenar/luvia/feature/auth/LoginViewModelTest.kt`
- Replace: `native-ui/app/src/main/java/com/luvia/gallery/nativeui/**`
- Create: `native-ui/app/src/main/kotlin/com/promenar/luvia/LuviaApplication.kt`
- Create: `native-ui/app/src/main/kotlin/com/promenar/luvia/MainActivity.kt`
- Create: `native-ui/app/src/main/kotlin/com/promenar/luvia/LuviaApp.kt`
- Create: `native-ui/app/src/androidTest/kotlin/com/promenar/luvia/LoginScreenTest.kt`

**Interfaces:**
- Consumes: `AuthRepository.login(...)` 与 `LuviaTheme`。
- Produces: `LoginUiState`、`LoginAction`、`LoginViewModel`；Material 3 登录页；登录成功后进入明确标注为第一阶段占位的主壳页面。

- [ ] **Step 1: 编写 LoginViewModel 失败测试**

覆盖初始状态、字段更新、无效地址阻止提交、提交期间禁用、成功发出已认证状态、401 与网络错误映射成稳定资源键。

- [ ] **Step 2: 运行测试并确认失败**

Run: `cd native-ui && ./gradlew :feature:auth:testDebugUnitTest`

Expected: FAIL，因为契约和 ViewModel 尚不存在。

- [ ] **Step 3: 实现 LoginContract 与 LoginViewModel**

ViewModel 仅暴露不可变 `StateFlow<LoginUiState>`，通过 `onAction(LoginAction)` 接收动作；协程由 `viewModelScope` 管理，不在 Composable 中发起网络请求。

- [ ] **Step 4: 实现 Material 3 主题和登录页**

使用 `MaterialTheme`、`Scaffold`、`OutlinedTextField`、`Button`、`CircularProgressIndicator`、`SnackbarHost`；密码字段提供可访问的显示/隐藏按钮；点击目标满足 48dp；支持系统深浅色与 Android 12+ 动态颜色。

- [ ] **Step 5: 替换应用入口**

删除旧 `com.luvia.gallery.nativeui` 源码，创建 `com.promenar.luvia` 入口。启用 edge-to-edge，主 Activity 不持有业务状态；第一阶段主壳只显示“原生重构进行中”和退出登录操作，不伪装图库功能已完成。

- [ ] **Step 6: 编写并运行 Compose UI 测试**

测试地址、用户名、密码字段语义，空输入时登录按钮不可用，密码切换按钮具备 contentDescription。

Run: `cd native-ui && ./gradlew :app:connectedDebugAndroidTest`

Expected: 在可用模拟器上通过；若无模拟器，记录为环境阻塞并至少运行 `:app:assembleDebug`。

- [ ] **Step 7: 运行阶段验证**

Run: `cd native-ui && ./gradlew testDebugUnitTest lintDebug :app:assembleDebug`

Expected: 单元测试、Lint 与 Debug 构建全部退出 0。

- [ ] **Step 8: 提交**

```bash
git add native-ui
git commit -m "feat(android): 建立 MD3 登录主链路"
```

### Task 4: 同步架构事实与长期交接

**Files:**
- Modify: `README.md`
- Modify: `release_notes.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `.agent/registry.md`
- Append through HLG Skill: `.agent/handover.md`
- Rebuild through HLG Skill: `.agent/handover-index.md`

**Interfaces:**
- Consumes: Task 1–3 的真实构建和测试结果。
- Produces: 不再把未完成功能写成已迁移的文档事实；后续阶段可查询的 `mobile-native-rewrite` continuity。

- [ ] **Step 1: 修正文档状态**

明确区分 Expo 生产基线、Android 原生第一阶段已实现内容、未实现功能和后续阶段；记录包名保持策略、安全约束与验证命令。

- [ ] **Step 2: 更新 registry**

注册本计划，并保持现有文档路径不变。

- [ ] **Step 3: 使用 HLG Skill 追加记录**

先 dry-run 后 `--apply`，记录 `scope: mobile-native-rewrite`、`status: in_progress`、`continuity: resume`、验证证据、下一阶段和风险，然后重建索引。

- [ ] **Step 4: 运行文档与工作树复核**

Run: `git diff --check && git status --short`

Expected: 无空白错误，只有预期文档变更。

- [ ] **Step 5: 提交**

```bash
git add README.md release_notes.md docs/ARCHITECTURE.md .agent
git commit -m "docs(android): 记录原生重构第一阶段"
```

