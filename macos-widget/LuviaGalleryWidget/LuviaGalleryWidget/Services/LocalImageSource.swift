//
//  LocalImageSource.swift
//  LuviaGalleryWidget
//
//  本地图片目录来源：security-scoped bookmark 持久化与目录图片枚举。
//

import Foundation

// MARK: - LocalImageSource

enum LocalImageSource {

    /// 支持的图片扩展名
    static let imageExtensions: Set<String> = ["jpg", "jpeg", "png", "webp", "heic", "gif"]

    // MARK: - Bookmark

    /// 为目录创建 security-scoped bookmark（沙盒持久化访问权限）
    static func createBookmark(for url: URL) -> Data? {
        do {
            return try url.bookmarkData(
                options: .withSecurityScope,
                includingResourceValuesForKeys: nil,
                relativeTo: nil
            )
        } catch {
            print("[LocalImageSource] 创建 bookmark 失败: \(error.localizedDescription)")
            return nil
        }
    }

    /// 解析 bookmark 恢复目录访问权限；失效（stale）或解析失败返回 nil。
    /// 成功时已在返回值 URL 上调用 startAccessingSecurityScopedResource（App 生命周期内保持）。
    static func resolveBookmark(_ data: Data) -> URL? {
        guard !data.isEmpty else { return nil }
        do {
            var isStale = false
            let url = try URL(
                resolvingBookmarkData: data,
                options: .withSecurityScope,
                relativeTo: nil,
                bookmarkDataIsStale: &isStale
            )
            guard !isStale else {
                print("[LocalImageSource] bookmark 已失效（目录可能被移动/重命名）")
                return nil
            }
            // 恢复沙盒访问权限，保持到 App 退出（不调用 stopAccessing）
            guard url.startAccessingSecurityScopedResource() else {
                print("[LocalImageSource] 恢复目录访问权限失败")
                return nil
            }
            return url
        } catch {
            print("[LocalImageSource] 解析 bookmark 失败: \(error.localizedDescription)")
            return nil
        }
    }

    // MARK: - 目录枚举

    /// 枚举目录内图片，随机洗牌返回（与在线 random 语义一致）
    /// - Parameter recursive: 是否递归子目录
    static func listImages(in folder: URL, recursive: Bool) -> [URL] {
        let fileManager = FileManager.default
        var urls: [URL] = []

        if recursive {
            // 递归遍历子目录
            guard let enumerator = fileManager.enumerator(
                at: folder,
                includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles, .skipsPackageDescendants]
            ) else { return [] }
            for case let url as URL in enumerator {
                if isImageFile(url) { urls.append(url) }
            }
        } else {
            // 仅顶层
            let children = (try? fileManager.contentsOfDirectory(
                at: folder,
                includingPropertiesForKeys: [.isRegularFileKey],
                options: [.skipsHiddenFiles]
            )) ?? []
            urls = children.filter { isImageFile($0) }
        }

        // 随机洗牌，与在线 random 模式语义一致
        return urls.shuffled()
    }

    /// 按扩展名判断是否支持的图片
    private static func isImageFile(_ url: URL) -> Bool {
        imageExtensions.contains(url.pathExtension.lowercased())
    }
}
