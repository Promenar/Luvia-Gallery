//
//  CarouselViewModel.swift
//  LuviaGalleryWidget
//
//  轮播状态机：图片列表加载、自动切换计时、播放/暂停、进度。
//

import Foundation
import Combine

@MainActor
final class CarouselViewModel: ObservableObject {

    // MARK: - 发布状态

    /// 已加载的图片列表（已过滤视频）
    @Published var files: [MediaFile] = []
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

    // MARK: - 配置

    /// 可见卡片数量
    static let visibleCount = 6
    /// 一次拉取的列表上限
    static let fetchLimit = 100
    /// 切换间隔（秒），由视图层从 @AppStorage 同步
    var intervalSeconds: Double = 6

    // MARK: - 私有

    /// 当前配置对应的 API 客户端（图片 URL 构造需要 token）
    private(set) var client: APIClient?
    /// 计时任务
    private var ticker: Task<Void, Never>?

    // MARK: - 派生数据

    /// 当前可见的卡片窗口（从 currentIndex 起循环取 visibleCount 张）
    var visibleFiles: [MediaFile] {
        guard !files.isEmpty else { return [] }
        let count = min(Self.visibleCount, files.count)
        return (0..<count).map { files[(currentIndex + $0) % files.count] }
    }

    // MARK: - 加载

    /// 拉取图片列表；成功返回 true，失败时填充状态文字
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
            // 过滤视频，只保留图片
            let images = result.filter { $0.mediaType == "image" }
            guard !images.isEmpty else {
                statusIsError = true
                statusText = "没有可用图片（该模式下返回为空）"
                return false
            }

            self.client = api
            self.files = images
            self.currentIndex = 0
            self.progress = 0
            statusIsError = false
            statusText = "已加载 \(images.count) 张图片"
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

    // MARK: - 计时与切换

    /// 启动轮播计时（每 50ms 走一格，受播放/悬停状态控制）
    private func startTicker() {
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 50_000_000)
                guard let self, !Task.isCancelled else { return }
                // 暂停、悬停或图片不足时不累计进度
                guard self.isPlaying, !self.isHoveringCard, self.files.count > 1 else { continue }
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
        guard !files.isEmpty else { return }
        currentIndex = (currentIndex + 1) % files.count
    }

    /// 点击卡片：跳转到可见窗口中的第 offset 张并重置计时
    func jump(toVisibleOffset offset: Int) {
        guard !files.isEmpty, offset >= 0 else { return }
        currentIndex = (currentIndex + offset) % files.count
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
