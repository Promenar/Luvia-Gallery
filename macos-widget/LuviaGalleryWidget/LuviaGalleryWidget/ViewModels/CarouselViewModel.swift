//
//  CarouselViewModel.swift
//  LuviaGalleryWidget
//
//  轮播状态机：图片列表加载（在线 / 本地目录）、自动切换计时、播放/暂停、进度。
//

import Foundation
import Combine

// MARK: - CarouselItem

/// 轮播条目：在线远程图片或本地图片文件
enum CarouselItem: Identifiable, Hashable {
    case remote(MediaFile)
    case local(URL)

    var id: String {
        switch self {
        case .remote(let file): return "remote_\(file.id)"
        case .local(let url): return "local_\(url.path)"
        }
    }
}

// MARK: - CarouselViewModel

@MainActor
final class CarouselViewModel: ObservableObject {

    // MARK: - 发布状态

    /// 已加载的轮播条目（在线已过滤视频 / 本地仅图片扩展名）
    @Published var items: [CarouselItem] = []
    /// 当前展示窗口的起始索引
    @Published var currentIndex: Int = 0
    /// 是否自动播放
    @Published var isPlaying: Bool = true
    /// 鼠标是否悬停在卡片上（悬停时暂停轮播）
    @Published var isHoveringCard: Bool = false
    /// 是否正在加载
    @Published var isLoading: Bool = false
    /// 设置面板状态文字
    @Published var statusText: String = ""
    /// 状态文字是否为错误（红色显示）
    @Published var statusIsError: Bool = false
    /// 本轮切换进度 0...1（底部进度条）
    @Published var progress: Double = 0
    /// 当前来源是否为本地目录（底部来源文案用）
    @Published var sourceIsLocal: Bool = false

    // MARK: - 配置

    /// 同时呈现的最大卡片数量（上限）
    static let maxVisibleCount = 6
    /// 在线一次拉取的列表上限
    static let fetchLimit = 100
    /// 同时呈现的卡片数量（1...maxVisibleCount），由视图层从 @AppStorage 同步
    var visibleCount: Int = 6
    /// 切换间隔（秒），由视图层从 @AppStorage 同步
    var intervalSeconds: Double = 6

    // MARK: - 私有

    /// 当前配置对应的 API 客户端（图片 URL 构造需要 token；本地模式为 nil）
    private(set) var client: APIClient?
    /// 计时任务
    private var ticker: Task<Void, Never>?

    // MARK: - 派生数据

    /// 当前可见的卡片窗口（从 currentIndex 起循环取 visibleCount 张）
    var visibleItems: [CarouselItem] {
        guard !items.isEmpty else { return [] }
        let count = min(max(visibleCount, 1), items.count)
        return (0..<count).map { items[(currentIndex + $0) % items.count] }
    }

    /// 底部来源文案
    var sourceLabel: String {
        if items.isEmpty { return sourceIsLocal ? "本地媒体 未连接" : "Luvia Gallery 未连接" }
        return sourceIsLocal ? "本地媒体 \(items.count) 项" : "Luvia Gallery 在线 \(items.count) 项"
    }

    // MARK: - 在线加载

    /// 拉取在线图片列表；成功返回 true，失败时填充状态文字
    @discardableResult
    func load(server: String, token: String, mode: WidgetConfig.DisplayMode, folder: String) async -> Bool {
        guard !server.isEmpty, !token.isEmpty else {
            statusIsError = true
            statusText = "请先填写 Server Address 和 API Token"
            return false
        }

        isLoading = true
        statusIsError = false
        statusText = "正在加载…"
        defer { isLoading = false }

        let api = APIClient(serverUrl: server, token: token)
        do {
            let result = try await api.fetchRandomFiles(
                limit: Self.fetchLimit,
                mode: mode,
                folder: folder
            )
            // 保留图片与视频（服务端 mediaType 字段直接区分，无需额外探测）
            let media = result.filter { $0.mediaType == "image" || $0.mediaType == "video" }
            guard !media.isEmpty else {
                statusIsError = true
                statusText = "没有可用媒体（该模式下返回为空）"
                return false
            }

            self.client = api
            self.sourceIsLocal = false
            self.items = media.map { .remote($0) }
            self.currentIndex = 0
            self.progress = 0
            statusIsError = false
            statusText = "已加载 \(media.count) 项媒体"
            startTicker()
            return true
        } catch let error as WidgetError {
            statusIsError = true
            // 401 / 403 单独提示 Token 无效，其余展示具体错误描述
            if case .serverError(let code) = error, code == 401 || code == 403 {
                statusText = "Token 无效（HTTP \(code)），请检查后重试"
            } else {
                statusText = error.errorDescription ?? "加载失败"
            }
            return false
        } catch {
            statusIsError = true
            statusText = "网络错误：\(error.localizedDescription)"
            return false
        }
    }

    // MARK: - 本地目录加载

    /// 加载本地目录图片（随机洗牌，与在线 random 语义一致）
    @discardableResult
    func loadLocal(folder: URL, recursive: Bool) async -> Bool {
        isLoading = true
        statusIsError = false
        statusText = "正在扫描目录…"
        defer { isLoading = false }

        let images = LocalImageSource.listImages(in: folder, recursive: recursive)
        guard !images.isEmpty else {
            statusIsError = true
            statusText = "目录内没有找到图片或视频（jpg / png / webp / heic / gif / mp4 / mov）"
            return false
        }

        self.client = nil
        self.sourceIsLocal = true
        self.items = images.map { .local($0) }
        self.currentIndex = 0
        self.progress = 0
        statusIsError = false
        statusText = "已加载 \(images.count) 项本地媒体"
        startTicker()
        return true
    }

    /// 本地目录 bookmark 失效时的统一报错
    func reportLocalBookmarkStale() {
        statusIsError = true
        statusText = "本地目录访问权限失效，请重新选择目录"
    }

    // MARK: - 计时与切换

    /// 启动轮播计时（每 50ms 走一格，受播放/悬停状态控制）
    private func startTicker() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 50_000_000)
                guard let self, !Task.isCancelled else { return }
                // 暂停、悬停或图片不足时不累计进度
                guard self.isPlaying, !self.isHoveringCard, self.items.count > 1 else { continue }
                self.progress += 0.05 / max(self.intervalSeconds, 1)
                if self.progress >= 1 {
                    self.progress = 0
                    self.advance()
                }
            }
        }
    }

    /// 前进到下一张
    private func advance() {
        guard !items.isEmpty else { return }
        currentIndex = (currentIndex + 1) % items.count
    }

    /// 点击卡片：跳转到可见窗口中的第 offset 张并重置计时
    func jump(toVisibleOffset offset: Int) {
        guard !items.isEmpty, offset >= 0 else { return }
        currentIndex = (currentIndex + offset) % items.count
        progress = 0
    }

    /// 切换播放/暂停
    func togglePlaying() {
        isPlaying.toggle()
    }

    deinit {
        ticker?.cancel()
    }
}
