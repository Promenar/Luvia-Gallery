//
//  CachedImageView.swift
//  LuviaGalleryWidget
//
//  远程图片视图：缩略图优先即时显示，大卡后台加载原图升级替换；
//  双缓冲交叉淡化；失败显示错误占位，点击重试。
//

import SwiftUI

// MARK: - CachedImageView

/// 加载统一走 ImageLoader（超时 / 限流 / in-flight 合并 / 重试），
/// 加载状态与视图生命周期解耦，不再出现永久转圈。
struct CachedImageView: View {

    /// 图片规格：小卡用缩略图，当前大卡先缩略图后原图升级
    enum Kind {
        case thumbnail
        case original

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
    /// 是否加载失败（显示错误占位）
    @State private var loadFailed = false
    /// 重试计数（变化触发 .task 重跑）
    @State private var retryCount = 0

    var body: some View {
        ZStack {
            // 加载中占位：深色底 + 小转圈
            if frontImage == nil && backImage == nil && !loadFailed {
                ZStack {
                    Color(white: 0.14)
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white.opacity(0.4))
                }
            }
            // 错误占位：点击重试
            if loadFailed {
                ZStack {
                    Color(white: 0.14)
                    Button {
                        // 重试：重置状态并触发重新加载
                        loadFailed = false
                        retryCount += 1
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: "exclamationmark.triangle")
                                .font(.system(size: 14))
                            Text("点击重试")
                                .font(.system(size: 9))
                        }
                        .foregroundStyle(.white.opacity(0.45))
                    }
                    .buttonStyle(.plain)
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
        // retryCount 变化时重新加载
        .task(id: "\(fileId)#\(retryCount)") {
            await load()
        }
    }

    /// 加载图片：小卡只下缩略图；大卡先缩略图即时显示，再后台升级原图
    /// （服务端 /api/file 无缩放参数，原图单张可达 14MB+，
    ///   缩略图先行保证卡片秒开，原图到达后交叉淡化替换）
    private func load() async {
        guard let client else {
            loadFailed = true
            return
        }

        // 缩略图（大卡也先显示它，避免等待原图期间转圈）
        if let thumbURL = await client.thumbnailURL(for: fileId),
           let thumb = await ImageLoader.shared.image(
               forKey: "\(Kind.thumbnail.cachePrefix)_\(fileId)", url: thumbURL) {
            crossfade(to: thumb)
        } else if kind == .thumbnail {
            // 小卡缩略图失败即失败
            loadFailed = true
            return
        }

        // 大卡：后台升级原图，失败则保留缩略图不报错
        if kind == .original {
            if let origURL = await client.originalImageURL(for: fileId),
               let original = await ImageLoader.shared.image(
                   forKey: "\(Kind.original.cachePrefix)_\(fileId)", url: origURL) {
                crossfade(to: original)
            } else if frontImage == nil {
                // 缩略图也没有才报错
                loadFailed = true
            }
        }
    }

    /// 双缓冲切换：旧图转入底层，新图淡入覆盖
    private func crossfade(to newImage: NSImage) {
        if frontImage === newImage { return }
        backImage = frontImage
        frontImage = newImage
        if reduceMotion {
            frontOpacity = 1
        } else {
            frontOpacity = 0
            withAnimation(.easeInOut(duration: 0.5)) {
                frontOpacity = 1
            }
        }
    }
}
