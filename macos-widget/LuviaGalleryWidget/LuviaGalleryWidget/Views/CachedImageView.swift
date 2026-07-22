//
//  CachedImageView.swift
//  LuviaGalleryWidget
//
//  带本地磁盘缓存的异步图片视图（复用现有 ImageCache）。
//

import SwiftUI

// MARK: - CachedImageView

/// 先查 ImageCache，未命中再走网络下载并写入缓存。
/// token 携带在 URL query 中（由 APIClient 构造）。
struct CachedImageView: View {

    /// 图片规格：小卡用缩略图，当前大卡用原图
    enum Kind {
        case thumbnail
        case original

        /// 缓存 key 前缀，避免缩略图与原图互相覆盖
        var cachePrefix: String {
            switch self {
            case .thumbnail: return "thumb"
            case .original: return "orig"
            }
        }
    }

    let fileId: String
    let kind: Kind
    let client: APIClient?

    @State private var image: NSImage?

    var body: some View {
        Group {
            if let image {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                // 加载中占位：深色底 + 小转圈
                ZStack {
                    Color(white: 0.14)
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white.opacity(0.4))
                }
            }
        }
        .task(id: fileId) {
            await load()
        }
    }

    /// 加载图片：缓存优先，网络兜底
    private func load() async {
        let cacheKey = "\(kind.cachePrefix)_\(fileId)"

        // 1. 命中本地缓存直接展示
        if let data = ImageCache.shared.image(for: cacheKey),
           let cached = NSImage(data: data) {
            image = cached
            return
        }

        // 2. 构造带 token 的图片 URL
        guard let client else { return }
        let url: URL? = await {
            switch kind {
            case .thumbnail: return await client.thumbnailURL(for: fileId)
            case .original: return await client.originalImageURL(for: fileId)
            }
        }()
        guard let url else { return }

        // 3. 网络下载并写入缓存
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return
            }
            if let downloaded = NSImage(data: data) {
                ImageCache.shared.save(data, for: cacheKey)
                image = downloaded
            }
        } catch {
            print("[CachedImageView] 下载失败 \(fileId.prefix(20)): \(error.localizedDescription)")
        }
    }
}
