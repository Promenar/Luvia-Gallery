# 架构全景 (Architecture Overview)

## 移动端 (native-ui)

本项目移动端已由 React Native 迁移至 Android 原生 Kotlin 实现，采用 Jetpack Compose 构建 UI。

### 核心技术栈
- **UI 框架**: Jetpack Compose (100% 声明式 UI)
- **架构模式**: MVVM (Model-View-ViewModel) + UDF (Unidirectional Data Flow)
- **依赖注入**: Hilt (Dagger Hilt)
- **异步编程**: Kotlin Coroutines + Flow
- **网络层**: Retrofit 2 + OkHttp 3 + Kotlinx Serialization
- **导航**: Jetpack Navigation (Type-Safe routes)
- **图片加载**: Coil (Compose-first)
- **持久化**: DataStore (Preferences)
- **媒体播放**: Media3 (ExoPlayer)

### 模块结构
- `com.luvia.gallery.nativeui`
    - `ui`: UI 相关组件和界面
        - `theme`: 设计系统 (Color, Type, Theme)
        - `navigation`: 路由定义
        - `components`: 通用 UI 组件 (LuviaButton, LuviaTextField 等)
        - `screens`: 业务页面 (Login, Home, Gallery, Viewer 等)
    - `data`: 数据层
        - `model`: 数据模型 (Serializable)
        - `api`: Retrofit 接口定义与拦截器
        - `repository`: 业务仓库层
    - `di`: Hilt 模块定义
    - `util`: 工具类 (DataStoreManager 等)

### 关键设计点
- **动态服务器切换**: 通过 `DynamicUrlInterceptor` 实现，支持用户在登录时输入自定义后端地址。
- **类型安全导航**: 使用 Kotlin Serialization 定义路由类，避免字符串硬编码。
- **Stitch 设计对齐**: 严格遵循 Stitch 产出的设计令牌进行 UI 开发。

## 后端与 Web 端
(保持原有架构，见旧版文档)
