//
//  ImageLoader.swift
//  LuviaGalleryWidget
//
//  图片下载层：超时控制、并发限流、in-flight 合并、失败重试。
//  与视图生命周期解耦：视图消失不取消共享下载，避免"下载到一半
//  被取消、反复重来最终永久转圈"的问题。
//

import AppKit

// MARK: - ImageLoader

final class ImageLoader: @unchecked Sendable {

    static let shared = ImageLoader()

    // MARK: - 配置

    /// 专用会话：请求级 30s 超时（无新字节即失败），资源级 120s 兜底，
    /// 每主机最多 4 连接（默认配置的 resource 超时长达 7 天，
    /// 连接 stall 时会永久挂起，是卡片无限转圈的直接原因；
    /// 实测 Tailscale 链路偶发整条连接无响应，15s 在抖动期过于敏感）
    private let session: URLSession
    /// 最大并发下载数（换批瞬间多卡并发时防止互相饿死）
    private let maxConcurrent = 4

    // MARK: - 状态

    /// 内存缓存（进程级，按 key）
    private let memoryCache = NSCache<NSString, NSImage>()
    private let lock = NSLock()
    /// 进行中的下载（按 key 合并：同一 URL 多卡共享一次下载）
    private var inFlight: [String: Task<NSImage?, Never>] = [:]
    /// 限流信号量状态
    private var activeCount = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []

    private init() {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        config.httpMaximumConnectionsPerHost = 4
        // 磁盘缓存由 ImageCache 自行管理，不走 URLCache
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: config)
        memoryCache.countLimit = 200
    }

    // MARK: - 加载

    /// 按 key 加载图片：内存缓存 → 磁盘缓存（ImageCache）→ 网络。
    /// 返回 nil 表示最终失败（已重试过一次），由调用方展示错误态。
    func image(forKey key: String, url: URL) async -> NSImage? {
        // 1. 内存缓存
        if let cached = memoryCache.object(forKey: key as NSString) {
            return cached
        }
        // 2. 磁盘缓存
        if let data = ImageCache.shared.image(for: key), let img = NSImage(data: data) {
            memoryCache.setObject(img, forKey: key as NSString)
            return img
        }
        // 3. in-flight 合并：同一 key 只下载一次
        lock.lock()
        if let existing = inFlight[key] {
            lock.unlock()
            return await existing.value
        }
        // 任务由 loader 持有，视图侧 task 取消不影响下载
        let task = Task.detached(priority: .userInitiated) { [weak self] in
            await self?.download(key: key, url: url)
        }
        inFlight[key] = task
        lock.unlock()

        let result = await task.value
        lock.lock()
        inFlight.removeValue(forKey: key)
        lock.unlock()
        return result
    }

    // MARK: - 下载（限流 + 指数退避重试两次）

    private func download(key: String, url: URL) async -> NSImage? {
        await acquirePermit()
        defer { releasePermit() }

        // 实测 Tailscale 链路偶发整条连接无响应（-1001），
        // 重试两次、1s/3s 指数退避可覆盖大多数瞬时抖动
        for attempt in 0...2 {
            if attempt > 0 {
                let backoff: UInt64 = attempt == 1 ? 1_000_000_000 : 3_000_000_000
                try? await Task.sleep(nanoseconds: backoff)
            }
            do {
                let (data, response) = try await session.data(from: url)
                guard let http = response as? HTTPURLResponse,
                      (200...299).contains(http.statusCode) else {
                    print("[ImageLoader] HTTP \((response as? HTTPURLResponse)?.statusCode ?? -1) \(key.prefix(24))（第 \(attempt + 1) 次）")
                    continue
                }
                guard let img = NSImage(data: data) else {
                    // 数据不是图片，重试无意义
                    print("[ImageLoader] 解码失败 \(key.prefix(24))")
                    return nil
                }
                memoryCache.setObject(img, forKey: key as NSString)
                ImageCache.shared.save(data, for: key)
                return img
            } catch {
                print("[ImageLoader] 下载错误 \(key.prefix(24)): \(error.localizedDescription)（第 \(attempt + 1) 次）")
                continue
            }
        }
        return nil
    }

    // MARK: - 并发信号量

    private func acquirePermit() async {
        await withCheckedContinuation { continuation in
            lock.lock()
            if activeCount < maxConcurrent {
                activeCount += 1
                lock.unlock()
                continuation.resume()
            } else {
                waiters.append(continuation)
                lock.unlock()
            }
        }
    }

    private func releasePermit() {
        lock.lock()
        if !waiters.isEmpty {
            let next = waiters.removeFirst()
            lock.unlock()
            next.resume()
        } else {
            activeCount -= 1
            lock.unlock()
        }
    }
}
