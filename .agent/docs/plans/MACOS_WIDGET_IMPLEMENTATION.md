# macOS 桌面小组件 - 详细实施方案

> **版本**: v1.0 | **日期**: 2026-03-30
> **状态**: 待启动 | **预计工期**: 5.5 天

---

## 一、前置条件检查清单

在启动开发前，需确认以下条件已满足：

| 序号 | 检查项 | 状态 | 备注 |
|------|--------|------|------|
| 1 | Apple Developer 账号（付费） | ⬜ | 需用于 App Groups 配置 |
| 2 | Xcode 15.0+ 已安装 | ⬜ | 支持 WidgetKit + SwiftUI 5 |
| 3 | macOS 14.0+ 开发环境 | ⬜ | Widget 功能测试 |
| 4 | Luvia Server 可访问 | ⬜ | 本地或远程服务器运行中 |
| 5 | 已生成 Wallpaper Token | ⬜ | 通过 Web 设置面板生成 |

---

## 二、任务分解 (WBS)

### Phase 0: 项目初始化 [0.5 天]

#### TASK-0.1: 创建 Xcode 项目
```
优先级: P0 | 预计: 1h | 依赖: 无
```

**步骤**:
1. 打开 Xcode → File → New → Project
2. 选择 **macOS → App**
3. 配置:
   - Product Name: `LuviaGalleryWidget`
   - Team: 选择你的 Apple Developer Team
   - Organization Identifier: `com.luvia`
   - Language: Swift
   - Interface: SwiftUI
4. 保存到 `/Users/promenar/Codex/Luvia-Gallery/macos-widget/`

**验收标准**:
- [ ] 项目可编译运行
- [ ] 基础 SwiftUI 视图正常显示

---

#### TASK-0.2: 添加 Widget Extension Target
```
优先级: P0 | 预计: 0.5h | 依赖: TASK-0.1
```

**步骤**:
1. 在 Xcode 中选择项目 → File → New → Target
2. 选择 **macOS → Widget Extension**
3. 配置:
   - Product Name: `GalleryWidget`
   - Include Configuration Intent: ✅ 勾选
4. 激活 Scheme 提示选择 "Activate"

**验收标准**:
- [ ] Widget Extension Target 创建成功
- [ ] 可在 Widget 模拟器中预览默认 Widget

---

#### TASK-0.3: 配置 App Groups
```
优先级: P0 | 预计: 1h | 依赖: TASK-0.2
```

**步骤**:
1. 登录 [Apple Developer Portal](https://developer.apple.com/account)
2. Certificates, Identifiers & Profiles → Identifiers → +
3. 选择 **App Groups** → Continue
4. 注册 App Group ID: `group.com.luvia.gallery`
5. 回到 Xcode:
   - 选择主 App Target → Signing & Capabilities → + Capability → App Groups
   - 添加 `group.com.luvia.gallery`
   - 选择 Widget Extension Target → 同样添加 App Groups

**验收标准**:
- [ ] Apple Developer Portal 显示 App Group 已注册
- [ ] 主 App 和 Widget Extension 都启用了 App Groups
- [ ] 两个 Target 使用相同的 Team ID

---

#### TASK-0.4: 创建目录结构
```
优先级: P1 | 预计: 0.5h | 依赖: TASK-0.2
```

在 Widget Extension 中创建以下文件结构：

```
GalleryWidget/
├── GalleryWidget.swift           # 入口文件（Xcode 自动生成）
├── GalleryWidgetLiveActivity.swift # 可删除（不需要）
├── GalleryWidgetBundle.swift     # 可删除（合并到入口）
├── Models/
│   ├── MediaFile.swift           # 数据模型
│   └── WidgetConfig.swift        # 配置模型
├── Services/
│   ├── APIClient.swift           # 网络请求
│   ├── ImageCache.swift          # 图片缓存
│   └── TokenStore.swift          # Token 管理
├── Providers/
│   ├── GalleryProvider.swift     # TimelineProvider
│   └── GalleryEntry.swift        # Timeline Entry
├── Views/
│   ├── SmallWidgetView.swift
│   ├── MediumWidgetView.swift
│   ├── LargeWidgetView.swift
│   ├── ThumbnailCell.swift
│   └── PlaceholderView.swift
└── Assets.xcassets/
```

**验收标准**:
- [ ] 所有文件组创建完成
- [ ] 项目结构清晰

---

### Phase 1: 核心通信层 [1 天]

#### TASK-1.1: 实现数据模型
```
优先级: P0 | 预计: 0.5h | 依赖: TASK-0.4
```

**文件**: `Models/MediaFile.swift`

```swift
import Foundation

struct MediaFile: Decodable, Identifiable {
    let id: String
    let url: String
    let thumbnailUrl: String
    let name: String
    let folderPath: String
    let size: Int
    let type: String
    let lastModified: Int
    let mediaType: String
    let sourceId: String
    let isFavorite: Bool?
    let width: Int?
    let height: Int?
    let aspectRatio: Double?
    
    enum CodingKeys: String, CodingKey {
        case id, url, thumbnailUrl, name, folderPath, size, type
        case lastModified, mediaType, sourceId, isFavorite
        case width, height, aspectRatio
    }
}

struct ScanResult: Decodable {
    let files: [MediaFile]
    let total: Int
    let hasMore: Bool
}
```

**文件**: `Models/WidgetConfig.swift`

```swift
import Foundation

struct WidgetConfig: Codable {
    let serverUrl: String
    let token: String
    let mode: DisplayMode
    let folderPath: String
    let showVideos: Bool
    let refreshInterval: Int  // 分钟
    
    enum DisplayMode: String, Codable, CaseIterable {
        case random
        case favorites
        case folder
    }
    
    static var `default`: WidgetConfig {
        WidgetConfig(
            serverUrl: "",
            token: "",
            mode: .random,
            folderPath: "",
            showVideos: false,
            refreshInterval: 30
        )
    }
}
```

**验收标准**:
- [ ] 编译通过
- [ ] 可从 JSON 解码

---

#### TASK-1.2: 实现 TokenStore
```
优先级: P0 | 预计: 0.5h | 依赖: TASK-1.1
```

**文件**: `Services/TokenStore.swift`

```swift
import Foundation

final class TokenStore {
    static let shared = TokenStore()
    
    // MARK: - App Groups
    private let suiteName = "group.com.luvia.gallery"
    private let configKey = "widget_config"
    
    private var userDefaults: UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }
    
    // MARK: - Public API
    
    func saveConfig(_ config: WidgetConfig) {
        guard let data = try? JSONEncoder().encode(config) else { return }
        userDefaults?.set(data, forKey: configKey)
    }
    
    func loadConfig() -> WidgetConfig? {
        guard let data = userDefaults?.data(forKey: configKey),
              let config = try? JSONDecoder().decode(WidgetConfig.self, from: data)
        else { return nil }
        return config
    }
    
    func clearConfig() {
        userDefaults?.removeObject(forKey: configKey)
    }
    
    func hasValidConfig() -> Bool {
        guard let config = loadConfig() else { return false }
        return !config.serverUrl.isEmpty && !config.token.isEmpty
    }
}
```

**验收标准**:
- [ ] 可保存配置到 App Groups
- [ ] 可读取配置
- [ ] 单元测试通过

---

#### TASK-1.3: 实现 APIClient
```
优先级: P0 | 预计: 1.5h | 依赖: TASK-1.2
```

**文件**: `Services/APIClient.swift`

```swift
import Foundation

enum WidgetError: Error, LocalizedError {
    case invalidURL
    case networkError(Error)
    case invalidResponse
    case serverError(Int)
    case decodingError(Error)
    
    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid URL"
        case .networkError(let e): return "Network error: \(e.localizedDescription)"
        case .invalidResponse: return "Invalid response"
        case .serverError(let code): return "Server error: \(code)"
        case .decodingError(let e): return "Decoding error: \(e.localizedDescription)"
        }
    }
}

actor APIClient {
    let serverUrl: String
    let token: String
    
    init(serverUrl: String, token: String) {
        self.serverUrl = serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.token = token
    }
    
    // MARK: - API Methods
    
    /// 获取随机图片列表 - 对标 wallpaper.js fetchItems()
    func fetchRandomFiles(
        limit: Int = 10,
        mode: WidgetConfig.DisplayMode = .random,
        folder: String = ""
    ) async throws -> [MediaFile] {
        var components = URLComponents(string: "\(serverUrl)/api/scan/results")!
        
        var queryItems = [
            URLQueryItem(name: "random", value: "true"),
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "recursive", value: "true"),
            URLQueryItem(name: "token", value: token)
        ]
        
        switch mode {
        case .favorites:
            queryItems.append(URLQueryItem(name: "favorites", value: "true"))
        case .folder:
            if !folder.isEmpty {
                queryItems.append(URLQueryItem(name: "folder", value: folder))
            }
        case .random:
            break
        }
        
        components.queryItems = queryItems
        
        guard let url = components.url else {
            throw WidgetError.invalidURL
        }
        
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            
            guard let httpResponse = response as? HTTPURLResponse else {
                throw WidgetError.invalidResponse
            }
            
            guard (200...299).contains(httpResponse.statusCode) else {
                throw WidgetError.serverError(httpResponse.statusCode)
            }
            
            let result = try JSONDecoder().decode(ScanResult.self, from: data)
            return result.files
            
        } catch let error as WidgetError {
            throw error
        } catch {
            throw WidgetError.networkError(error)
        }
    }
    
    /// 构建缩略图 URL - 对标 wallpaper.js getMediaUrl()
    func thumbnailURL(for fileId: String) -> URL? {
        let encodedId = fileId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? fileId
        let urlString = "\(serverUrl)/api/thumb/\(encodedId)?token=\(token)"
        return URL(string: urlString)
    }
    
    /// 下载缩略图数据
    func downloadThumbnail(fileId: String) async throws -> Data {
        guard let url = thumbnailURL(for: fileId) else {
            throw WidgetError.invalidURL
        }
        
        let (data, response) = try await URLSession.shared.data(from: url)
        
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw WidgetError.invalidResponse
        }
        
        return data
    }
}
```

**验收标准**:
- [ ] 可成功调用 `/api/scan/results`
- [ ] 可正确解析 JSON 响应
- [ ] 错误处理完善

---

#### TASK-1.4: 实现 ImageCache
```
优先级: P0 | 预计: 1h | 依赖: TASK-0.3
```

**文件**: `Services/ImageCache.swift`

```swift
import Foundation

actor ImageCache {
    static let shared = ImageCache()
    
    private let fileManager = FileManager.default
    private let cacheDirectoryName = "WidgetCache/Thumbnails"
    
    private var cacheDirectory: URL? {
        guard let groupURL = fileManager.containerURL(
            forSecurityApplicationGroupIdentifier: "group.com.luvia.gallery"
        ) else { return nil }
        
        return groupURL.appendingPathComponent(cacheDirectoryName, isDirectory: true)
    }
    
    private init() {
        createCacheDirectoryIfNeeded()
    }
    
    // MARK: - Public API
    
    func image(for fileId: String) -> Data? {
        guard let fileURL = cacheFileURL(for: fileId),
              fileManager.fileExists(atPath: fileURL.path) else {
            return nil
        }
        return try? Data(contentsOf: fileURL)
    }
    
    func save(_ data: Data, for fileId: String) {
        guard let fileURL = cacheFileURL(for: fileId) else { return }
        try? data.write(to: fileURL)
    }
    
    func hasImage(for fileId: String) -> Bool {
        guard let fileURL = cacheFileURL(for: fileId) else { return false }
        return fileManager.fileExists(atPath: fileURL.path)
    }
    
    func clearCache() throws {
        guard let cacheDir = cacheDirectory else { return }
        if fileManager.fileExists(atPath: cacheDir.path) {
            try fileManager.removeItem(at: cacheDir)
        }
        createCacheDirectoryIfNeeded()
    }
    
    func cacheSize() -> Int {
        guard let cacheDir = cacheDirectory,
              let enumerator = fileManager.enumerator(at: cacheDir, includingPropertiesForKeys: [.fileSizeKey]) else {
            return 0
        }
        
        var totalSize = 0
        for case let fileURL as URL in enumerator {
            if let attrs = try? fileURL.resourceValues(forKeys: [.fileSizeKey]),
               let fileSize = attrs.fileSize {
                totalSize += fileSize
            }
        }
        return totalSize
    }
    
    // MARK: - Private
    
    private func cacheFileURL(for fileId: String) -> URL? {
        // 使用 MD5 哈希作为文件名（与后端一致）
        let filename = fileId.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "+", with: "-")
        return cacheDirectory?.appendingPathComponent("\(filename).webp")
    }
    
    private func createCacheDirectoryIfNeeded() {
        guard let cacheDir = cacheDirectory else { return }
        if !fileManager.fileExists(atPath: cacheDir.path) {
            try? fileManager.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        }
    }
}
```

**验收标准**:
- [ ] 可保存图片到 App Groups 目录
- [ ] 可读取缓存的图片
- [ ] 缓存大小计算正确

---

### Phase 2: Timeline 实现 [1 天]

#### TASK-2.1: 实现 GalleryEntry
```
优先级: P0 | 预计: 0.5h | 依赖: TASK-1.1
```

**文件**: `Providers/GalleryEntry.swift`

```swift
import WidgetKit

struct GalleryEntry: TimelineEntry {
    let date: Date
    let images: [MediaFile]
    let configurationState: ConfigurationState
    
    enum ConfigurationState {
        case configured       // 已配置，数据正常
        case notConfigured    // 未配置 Token/Server
        case networkError     // 网络错误
        case emptyLibrary     // 图库为空
    }
    
    // 便捷构造器
    static func configured(images: [MediaFile], at date: Date = Date()) -> GalleryEntry {
        GalleryEntry(date: date, images: images, configurationState: .configured)
    }
    
    static func notConfigured() -> GalleryEntry {
        GalleryEntry(date: Date(), images: [], configurationState: .notConfigured)
    }
    
    static func networkError() -> GalleryEntry {
        GalleryEntry(date: Date(), images: [], configurationState: .networkError)
    }
    
    static func emptyLibrary() -> GalleryEntry {
        GalleryEntry(date: Date(), images: [], configurationState: .emptyLibrary)
    }
}
```

**验收标准**:
- [ ] 编译通过
- [ ] 符合 TimelineEntry 协议

---

#### TASK-2.2: 实现 TimelineProvider
```
优先级: P0 | 预计: 2h | 依赖: TASK-2.1, TASK-1.3, TASK-1.4
```

**文件**: `Providers/GalleryProvider.swift`

```swift
import WidgetKit
import SwiftUI

struct GalleryProvider: IntentTimelineProvider {
    typealias Entry = GalleryEntry
    typealias Intent = GalleryWidgetConfigurationIntent
    
    // MARK: - IntentTimelineProvider
    
    func placeholder(in context: Context) -> GalleryEntry {
        .configured(images: [])
    }
    
    func getSnapshot(
        for configuration: GalleryWidgetConfigurationIntent,
        in context: Context,
        completion: @escaping (GalleryEntry) -> Void
    ) {
        // 快照模式：立即返回，用于 Widget 预览
        completion(.configured(images: []))
    }
    
    func getTimeline(
        for configuration: GalleryWidgetConfigurationIntent,
        in context: Context,
        completion: @escaping (Timeline<GalleryEntry>) -> Void
    ) {
        Task {
            await getTimelineAsync(configuration: configuration, completion: completion)
        }
    }
    
    // MARK: - Private
    
    private func getTimelineAsync(
        configuration: GalleryWidgetConfigurationIntent,
        completion: @escaping (Timeline<GalleryEntry>) -> Void
    ) async {
        // 1. 检查配置
        guard let config = TokenStore.shared.loadConfig(),
              !config.serverUrl.isEmpty,
              !config.token.isEmpty else {
            // 未配置：1 小时后重试
            let entry = GalleryEntry.notConfigured()
            let timeline = Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600)))
            completion(timeline)
            return
        }
        
        // 2. 获取数据
        let client = APIClient(serverUrl: config.serverUrl, token: config.token)
        let mode = mapDisplayMode(configuration.mode)
        
        do {
            let files = try await client.fetchRandomFiles(
                limit: 12,  // 多取一些，确保大尺寸 Widget 有足够图片
                mode: mode,
                folder: config.folderPath
            )
            
            // 3. 过滤视频（如果配置不允许）
            let filteredFiles = config.showVideos 
                ? files 
                : files.filter { $0.mediaType == "image" }
            
            guard !filteredFiles.isEmpty else {
                let entry = GalleryEntry.emptyLibrary()
                let timeline = Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(1800)))
                completion(timeline)
                return
            }
            
            // 4. 预缓存缩略图
            await precacheThumbnails(files: filteredFiles, client: client)
            
            // 5. 构建 Timeline
            let entry = GalleryEntry.configured(images: Array(filteredFiles.prefix(9)))
            let refreshInterval = TimeInterval(config.refreshInterval * 60)
            let nextUpdate = Date().addingTimeInterval(refreshInterval)
            let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
            
            completion(timeline)
            
        } catch {
            print("[GalleryWidget] Error fetching files: \(error)")
            
            // 网络错误：5 分钟后重试
            let entry = GalleryEntry.networkError()
            let timeline = Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(300)))
            completion(timeline)
        }
    }
    
    private func precacheThumbnails(files: [MediaFile], client: APIClient) async {
        let cache = ImageCache.shared
        
        for file in files.prefix(9) {
            // 如果已有缓存，跳过
            if await cache.hasImage(for: file.id) {
                continue
            }
            
            // 下载并缓存
            do {
                let data = try await client.downloadThumbnail(fileId: file.id)
                await cache.save(data, for: file.id)
            } catch {
                print("[GalleryWidget] Failed to cache thumbnail for \(file.id): \(error)")
            }
        }
    }
    
    private func mapDisplayMode(_ mode: DisplayModeEnum?) -> WidgetConfig.DisplayMode {
        switch mode {
        case .random, .none:
            return .random
        case .favorites:
            return .favorites
        case .folder:
            return .folder
        }
    }
}
```

**验收标准**:
- [ ] Timeline 正常生成
- [ ] 网络错误时正确回退
- [ ] 缩略图预缓存正常

---

### Phase 3: UI 视图 [1.5 天]

#### TASK-3.1: 实现 PlaceholderView
```
优先级: P1 | 预计: 0.5h | 依赖: TASK-2.1
```

**文件**: `Views/PlaceholderView.swift`

```swift
import SwiftUI

struct PlaceholderView: View {
    let state: GalleryEntry.ConfigurationState
    
    var body: some View {
        ZStack {
            Color(.systemGray6)
            
            VStack(spacing: 12) {
                icon
                title
                subtitle
            }
            .padding()
        }
    }
    
    @ViewBuilder
    private var icon: some View {
        switch state {
        case .notConfigured:
            Image(systemName: "gear.badge.questionmark")
                .font(.system(size: 32))
                .foregroundStyle(.secondary)
        case .networkError:
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 32))
                .foregroundStyle(.orange)
        case .emptyLibrary:
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 32))
                .foregroundStyle(.secondary)
        case .configured:
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 32))
                .foregroundStyle(.secondary)
        }
    }
    
    @ViewBuilder
    private var title: some View {
        Text("Luvia Gallery")
            .font(.headline)
            .foregroundStyle(.primary)
    }
    
    @ViewBuilder
    private var subtitle: some View {
        switch state {
        case .notConfigured:
            Text("Open app to configure")
                .font(.caption)
                .foregroundStyle(.tertiary)
        case .networkError:
            Text("Network error")
                .font(.caption)
                .foregroundStyle(.tertiary)
        case .emptyLibrary:
            Text("No photos found")
                .font(.caption)
                .foregroundStyle(.tertiary)
        case .configured:
            Text("Loading...")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }
}

#Preview {
    PlaceholderView(state: .notConfigured)
        .frame(width: 170, height: 170)
}
```

**验收标准**:
- [ ] 三种状态显示正确
- [ ] 视觉样式符合 macOS 设计规范

---

#### TASK-3.2: 实现 ThumbnailCell
```
优先级: P0 | 预计: 0.5h | 依赖: TASK-1.4
```

**文件**: `Views/ThumbnailCell.swift`

```swift
import SwiftUI

struct ThumbnailCell: View {
    let mediaFile: MediaFile
    
    var body: some View {
        ZStack {
            // 图片
            if let imageData = ImageCache.shared.image(for: mediaFile.id),
               let nsImage = NSImage(data: imageData) {
                Image(nsImage: nsImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                // 占位色
                Color(.systemGray5)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }
}

// 异步版本（用于 Timeline 预加载后）
struct AsyncThumbnailCell: View {
    let mediaFile: MediaFile
    let serverUrl: String
    let token: String
    
    @State private var imageData: Data?
    
    var body: some View {
        ZStack {
            if let data = imageData,
               let nsImage = NSImage(data: data) {
                Image(nsImage: nsImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Color(.systemGray5)
                    .task {
                        await loadImage()
                    }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 4))
    }
    
    private func loadImage() async {
        // 先检查缓存
        if let cached = await ImageCache.shared.image(for: mediaFile.id) {
            imageData = cached
            return
        }
        
        // 从网络加载
        let client = APIClient(serverUrl: serverUrl, token: token)
        do {
            let data = try await client.downloadThumbnail(fileId: mediaFile.id)
            await ImageCache.shared.save(data, for: mediaFile.id)
            imageData = data
        } catch {
            print("[ThumbnailCell] Load failed: \(error)")
        }
    }
}
```

**验收标准**:
- [ ] 图片正常显示
- [ ] 圆角正确

---

#### TASK-3.3: 实现 SmallWidgetView
```
优先级: P0 | 预计: 1h | 依赖: TASK-3.1, TASK-3.2
```

**文件**: `Views/SmallWidgetView.swift`

```swift
import SwiftUI

struct SmallWidgetView: View {
    let entry: GalleryEntry
    
    var body: some View {
        switch entry.configurationState {
        case .configured:
            if let firstImage = entry.images.first {
                singleImageView(firstImage)
            } else {
                PlaceholderView(state: .emptyLibrary)
            }
        case .notConfigured:
            PlaceholderView(state: .notConfigured)
        case .networkError:
            PlaceholderView(state: .networkError)
        case .emptyLibrary:
            PlaceholderView(state: .emptyLibrary)
        }
    }
    
    @ViewBuilder
    private func singleImageView(_ file: MediaFile) -> some View {
        GeometryReader { geometry in
            ZStack {
                // 背景图片
                if let imageData = ImageCache.shared.image(for: file.id),
                   let nsImage = NSImage(data: imageData) {
                    Image(nsImage: nsImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .clipped()
                } else {
                    Color(.systemGray5)
                }
                
                // 底部渐变 + 信息
                VStack {
                    Spacer()
                    
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.5)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 50)
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.name)
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundColor(.white)
                            .lineLimit(1)
                        
                        Text(file.folderPath.isEmpty ? "Library" : file.folderPath)
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.7))
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 10)
                    .padding(.bottom, 10)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

#Preview {
    SmallWidgetView(entry: .notConfigured())
        .frame(width: 170, height: 170)
}
```

**验收标准**:
- [ ] 单图正确显示
- [ ] 底部渐变效果自然
- [ ] 文件名/路径正确显示

---

#### TASK-3.4: 实现 MediumWidgetView
```
优先级: P0 | 预计: 0.5h | 依赖: TASK-3.2
```

**文件**: `Views/MediumWidgetView.swift`

```swift
import SwiftUI

struct MediumWidgetView: View {
    let entry: GalleryEntry
    
    private let columns = [
        GridItem(.flexible(), spacing: 4),
        GridItem(.flexible(), spacing: 4)
    ]
    
    var body: some View {
        switch entry.configurationState {
        case .configured:
            gridView
        default:
            PlaceholderView(state: entry.configurationState)
        }
    }
    
    @ViewBuilder
    private var gridView: some View {
        LazyVGrid(columns: columns, spacing: 4) {
            ForEach(entry.images.prefix(4)) { file in
                ThumbnailCell(mediaFile: file)
            }
        }
        .padding(4)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

#Preview {
    MediumWidgetView(entry: .notConfigured())
        .frame(width: 360, height: 170)
}
```

**验收标准**:
- [ ] 2x2 网格正确显示
- [ ] 间距均匀

---

#### TASK-3.5: 实现 LargeWidgetView
```
优先级: P0 | 预计: 0.5h | 依赖: TASK-3.2
```

**文件**: `Views/LargeWidgetView.swift`

```swift
import SwiftUI

struct LargeWidgetView: View {
    let entry: GalleryEntry
    
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 3)
    
    var body: some View {
        switch entry.configurationState {
        case .configured:
            gridView
        default:
            PlaceholderView(state: entry.configurationState)
        }
    }
    
    @ViewBuilder
    private var gridView: some View {
        LazyVGrid(columns: columns, spacing: 4) {
            ForEach(entry.images.prefix(9)) { file in
                ThumbnailCell(mediaFile: file)
            }
        }
        .padding(4)
        .background(Color(.systemGray6))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

#Preview {
    LargeWidgetView(entry: .notConfigured())
        .frame(width: 360, height: 360)
}
```

**验收标准**:
- [ ] 3x3 网格正确显示
- [ ] 间距均匀

---

### Phase 4: Widget 入口与配置 [0.5 天]

#### TASK-4.1: 实现 Widget 入口
```
优先级: P0 | 预计: 0.5h | 依赖: TASK-3.3, TASK-3.4, TASK-3.5
```

**文件**: `GalleryWidget.swift`（修改 Xcode 生成的文件）

```swift
import WidgetKit
import SwiftUI

@main
struct GalleryWidgetBundle: WidgetBundle {
    var body: some Widget {
        GalleryWidget()
    }
}

struct GalleryWidget: Widget {
    let kind: String = "GalleryWidget"
    
    var body: some WidgetConfiguration {
        IntentConfiguration(
            kind: kind,
            intent: GalleryWidgetConfigurationIntent.self,
            provider: GalleryProvider()
        ) { entry in
            GalleryWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Luvia Gallery")
        .description("Display photos from your Luvia Gallery library.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct GalleryWidgetEntryView: View {
    var entry: GalleryEntry
    @Environment(\.widgetFamily) var family
    
    var body: some View {
        switch family {
        case .systemSmall:
            SmallWidgetView(entry: entry)
        case .systemMedium:
            MediumWidgetView(entry: entry)
        case .systemLarge:
            LargeWidgetView(entry: entry)
        default:
            SmallWidgetView(entry: entry)
        }
    }
}

// Preview
#Preview(as: .systemSmall) {
    GalleryWidget()
} timeline: {
    GalleryEntry.notConfigured()
    GalleryEntry.configured(images: [])
}

#Preview(as: .systemMedium) {
    GalleryWidget()
} timeline: {
    GalleryEntry.notConfigured()
}

#Preview(as: .systemLarge) {
    GalleryWidget()
} timeline: {
    GalleryEntry.notConfigured()
}
```

**验收标准**:
- [ ] Widget 可在 Widget 库中找到
- [ ] 三种尺寸都可正常预览

---

#### TASK-4.2: 实现 AppIntents 配置
```
优先级: P1 | 预计: 1h | 依赖: TASK-4.1
```

**文件**: `GalleryWidgetConfigurationIntent.swift`（Xcode 自动生成，需修改）

```swift
import AppIntents
import WidgetKit

enum DisplayModeEnum: String, AppEnum, CaseIterable {
    case random = "random"
    case favorites = "favorites"
    case folder = "folder"
    
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Display Mode")
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .random: "Random Photos",
        .favorites: "Favorites",
        .folder: "Specific Folder"
    ]
}

enum RefreshIntervalEnum: String, AppEnum, CaseIterable {
    case fifteenMinutes = "15"
    case thirtyMinutes = "30"
    case oneHour = "60"
    
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Refresh Interval")
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .fifteenMinutes: "15 Minutes",
        .thirtyMinutes: "30 Minutes",
        .oneHour: "1 Hour"
    ]
}

struct GalleryWidgetConfigurationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "Gallery Settings"
    static var description: IntentDescription = "Configure which photos to display and how often to refresh."
    
    // MARK: - Parameters
    
    @Parameter(title: "Display Mode", default: .random)
    var mode: DisplayModeEnum?
    
    @Parameter(title: "Refresh Interval", default: .thirtyMinutes)
    var refreshInterval: RefreshIntervalEnum?
    
    @Parameter(title: "Include Videos", default: false)
    var includeVideos: Bool?
    
    // MARK: - Summary
    
    static var parameterSummary: some ParameterSummary {
        When(\.$mode, .equalTo, .folder) {
            Summary {
                \.$mode
                \.$refreshInterval
                \.$includeVideos
            }
        } otherwise: {
            Summary {
                \.$mode
                \.$refreshInterval
                \.$includeVideos
            }
        }
    }
}
```

**验收标准**:
- [ ] 配置界面正常显示
- [ ] 参数可保存和读取

---

### Phase 5: 联调与测试 [1 天]

#### TASK-5.1: 配置流程联调
```
优先级: P0 | 预计: 1h | 依赖: Phase 4 完成
```

**测试步骤**:
1. 启动 Luvia Server
2. 在 Web 设置面板生成 Wallpaper Token
3. 手动写入 App Groups（测试用）:
   ```swift
   let config = WidgetConfig(
       serverUrl: "http://localhost:3000",
       token: "YOUR_JWT_TOKEN",
       mode: .random,
       folderPath: "",
       showVideos: false,
       refreshInterval: 30
   )
   TokenStore.shared.saveConfig(config)
   ```
4. 添加 Widget 到桌面
5. 验证图片显示

**验收标准**:
- [ ] Token 配置后 Widget 正常显示图片
- [ ] 刷新功能正常

---

#### TASK-5.2: 内存压力测试
```
优先级: P1 | 预计: 1h | 依赖: TASK-5.1
```

**测试步骤**:
1. 添加 Large Widget（3x3 网格）
2. 使用 Instruments 监控内存
3. 验证内存占用 < 30MB
4. 验证图片缓存大小合理

**验收标准**:
- [ ] Widget 内存占用 < 30MB
- [ ] 无内存泄漏

---

#### TASK-5.3: 离线模式测试
```
优先级: P1 | 预计: 0.5h | 依赖: TASK-5.1
```

**测试步骤**:
1. 正常加载 Widget
2. 断开网络
3. 触发 Widget 刷新
4. 验证显示缓存图片或错误提示

**验收标准**:
- [ ] 离线时显示缓存图片
- [ ] 网络错误提示清晰

---

#### TASK-5.4: Timeline 刷新测试
```
优先级: P1 | 预计: 0.5h | 依赖: TASK-5.1
```

**测试步骤**:
1. 设置刷新间隔为 15 分钟
2. 记录当前显示的图片
3. 等待 15 分钟后检查是否刷新
4. 验证 Timeline 策略正确

**验收标准**:
- [ ] 按配置间隔刷新
- [ ] 刷新后图片更新

---

## 三、启动检查清单

开发启动前，请确认：

```markdown
- [ ] Apple Developer 账号已登录
- [ ] Xcode 15+ 已安装
- [ ] Luvia Server 本地运行正常
- [ ] 已生成有效的 JWT Token
- [ ] 已阅读完整实施方案
```

---

## 四、风险应对预案

| 风险 | 触发条件 | 应对措施 |
|------|----------|----------|
| App Groups 配置失败 | Xcode 报签名错误 | 检查 Apple Developer Portal 的 App Group 配置 |
| Widget 不刷新 | Timeline 未触发 | 检查 `getTimeline` 日志，确认 policy 正确 |
| 图片不显示 | 缩略图加载失败 | 检查网络请求，确认 Token 有效 |
| 内存超限 | Widget 被系统杀死 | 减少图片数量，使用更小的缩略图 |

---

## 五、交付物清单

| 交付物 | 路径 | 状态 |
|--------|------|------|
| Widget Extension | `macos-widget/GalleryWidget/` | ⬜ |
| 设计文档 | `.agent/docs/plans/MACOS_WIDGET_PLAN.md` | ✅ |
| 实施方案 | `.agent/docs/plans/MACOS_WIDGET_IMPLEMENTATION.md` | ✅ |

---

**准备就绪后，可开始执行 Phase 0 任务。**
