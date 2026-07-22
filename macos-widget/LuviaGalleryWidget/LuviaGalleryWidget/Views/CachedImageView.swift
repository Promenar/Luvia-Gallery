//
//  CachedImageView.swift
//  LuviaGalleryWidget
//
//  带本地磁盘缓存的异步图片视图（复用现有 ImageCache）。
//  双缓冲交叉淡化：旧图保持垫底，新图加载完成后淡入覆盖（0.5s）。
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
    /// 系统"减少动态效果"是否开启（开启时关闭交叉淡化）
    var reduceMotion: Bool = false

    /// 前景图（最新）
    @State private var frontImage: NSImage?
    /// 背景图（上一张，淡化时垫底保持画面不闪）
    @State private var backImage: NSImage?
    /// 前景不透明度（驱动淡入）
    @State private var frontOpacity: Double = 0

    var body: some View {
        ZStack {
            // 加载中占位：深色底 + 小转圈
            if frontImage == nil && backImage == nil {
                ZStack {
                    Color(white: 0.14)
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white.opacity(0.4))
                }
            }
            // 旧图垫底
            if let backImage {
                Image(nsImage: backImage)
                    .resizable()
                    .scaledToFill()
            }
            // 新图淡入覆盖
            if let frontImage {
                Image(nsImage: frontImage)
                    .resizable()
                    .scaledToFill()
                    .opacity(frontOpacity)
            }
        }
        .task(id: fileId) {
            await load()
        }
    }

    /// 加载图片：缓存优先，网络兜底；完成后交叉淡化切换到新图
    private func load() async {
        let cacheKey = "\(kind.cachePrefix)_\(fileId)"

        // 1. 命中本地缓存直接展示
        if let data = ImageCache.shared.image(for: cacheKey),
           let cached = NSImage(data: data) {
            crossfade(to: cached)
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
                crossfade(to: downloaded)
            }
        } catch {
            print("[CachedImageView] 下载失败 \(fileId.prefix(20)): \(error.localizedDescription)")
        }
    }

    /// 双缓冲切换：旧图转入底层，新图淡入覆盖
    private func crossfade(to newImage: NSImage) {
        // 同一张图不重复触发
        if frontImage === newImage { return }
        backImage = frontImage
        frontImage = newImage
        if reduceMotion {
            // 减少动态效果：直接呈现，不做淡化
            frontOpacity = 1
        } else {
            frontOpacity = 0
            withAnimation(.easeInOut(duration: 0.5)) {
                frontOpacity = 1
            }
        }
    }
}
