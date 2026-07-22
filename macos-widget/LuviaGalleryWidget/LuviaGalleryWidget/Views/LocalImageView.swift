//
//  LocalImageView.swift
//  LuviaGalleryWidget
//
//  本地图片视图：ImageIO 降采样解码 + 内存缓存 + 双缓冲交叉淡化。
//

import SwiftUI
import ImageIO

// MARK: - LocalImageView

/// 本地原图可能几十 MB，直接解码会卡顿，
/// 因此统一走 ImageIO 降采样缩略图：小卡 maxPixel 400，大卡 1600。
struct LocalImageView: View {

    let url: URL
    /// true 用大图规格（当前大卡），false 用小图规格
    let isLarge: Bool
    /// 系统"减少动态效果"是否开启（开启时关闭交叉淡化）
    var reduceMotion: Bool = false

    /// 前景图（最新）
    @State private var frontImage: NSImage?
    /// 背景图（上一张，淡化时垫底保持画面不闪）
    @State private var backImage: NSImage?
    /// 前景不透明度（驱动淡入）
    @State private var frontOpacity: Double = 0

    /// 内存缓存（进程级，避免重复解码）
    private static let memoryCache = NSCache<NSString, NSImage>()

    /// 降采样目标像素
    private var maxPixelSize: Int { isLarge ? 1600 : 400 }

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
        .task(id: url) {
            await load()
        }
    }

    /// 降采样加载：先查内存缓存，再后台 ImageIO 解码
    private func load() async {
        let cacheKey = "\(maxPixelSize)_\(url.path)" as NSString

        if let cached = Self.memoryCache.object(forKey: cacheKey) {
            crossfade(to: cached)
            return
        }

        let maxPixel = maxPixelSize
        let image: NSImage? = await Task.detached(priority: .userInitiated) {
            guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maxPixel
            ]
            guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
                return nil
            }
            return NSImage(cgImage: cgImage, size: .zero)
        }.value

        if let image {
            Self.memoryCache.setObject(image, forKey: cacheKey)
            crossfade(to: image)
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
