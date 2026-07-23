//
//  CarouselCard.swift
//  LuviaGalleryWidget
//
//  单张轮播卡片：图片、编号角标、悬停浮光扫过效果（卡片内部自管理）。
//

import SwiftUI
import AppKit

// MARK: - CarouselCard

struct CarouselCard: View {

    /// 轮播条目（在线远程 / 本地文件）
    let item: CarouselItem
    /// 序号（1 起）
    let number: Int
    /// 是否为当前大卡（第一张）
    let isCurrent: Bool
    /// 图片客户端（仅在线来源需要；本地为 nil）
    let client: APIClient?
    /// 系统"减少动态效果"是否开启
    let reduceMotion: Bool
    /// 视频是否应播放（手风琴收缩态 / 被面板覆盖时暂停）
    var isPlaying: Bool = true

    /// 浮光水平位置系数：-1.4 左侧屏幕外 → 1.4 右侧屏幕外
    @State private var shineX: CGFloat = -1.4
    /// 鼠标是否悬停（控制"打开网页"按钮显隐）
    @State private var isHoveringCard = false

    /// 品牌蓝（当前卡编号）
    private let accentBlue = Color(red: 0x3f / 255, green: 0x7b / 255, blue: 0xff / 255)

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                // 图片本体：大卡用原图规格，小卡用缩略图规格
                imageContent
                    .frame(width: geo.size.width, height: geo.size.height)
                    .clipped()

                // 左上角小编号：当前卡亮蓝，其余白色 55%
                Text(String(format: "%02d", number))
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(isCurrent ? accentBlue : .white.opacity(0.55))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(.black.opacity(0.35), in: Capsule())
                    .padding(8)

                // 悬停浮光：斜向白色渐变高光，由 shineX 驱动从左扫到右，
                // 超出卡片的部分由外层 clipShape 裁掉
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [.clear, .white.opacity(0.35), .clear],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .frame(width: geo.size.width * 0.6, height: geo.size.height * 2.2)
                    .rotationEffect(.degrees(18))
                    .offset(x: shineX * geo.size.width, y: -geo.size.height * 0.6)
                    .allowsHitTesting(false)
            }
            // 右上角"打开网页"按钮：仅在线来源、悬停时显示
            // （本地目录来源没有对应网页位置，隐藏）
            .overlay(alignment: .topTrailing) {
                if case .remote(let file) = item, isHoveringCard {
                    Button {
                        openInWeb(file)
                    } label: {
                        Image(systemName: "arrow.up.forward.square")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.white.opacity(0.85))
                            .padding(5)
                            .background(.black.opacity(0.45), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .help("在浏览器中打开所在文件夹")
                    .padding(8)
                    .transition(.opacity)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 13))
        .contentShape(RoundedRectangle(cornerRadius: 13))
        // 卡片内部自管理浮光：鼠标进入时扫一次；同时追踪悬停显隐按钮
        .onHover { hovering in
            isHoveringCard = hovering
            guard hovering, !reduceMotion else { return }
            shineX = -1.4
            withAnimation(.linear(duration: 0.9)) {
                shineX = 1.4
            }
            // 动画结束后无动画归位，方便下次悬停再扫
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.95) {
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    shineX = -1.4
                }
            }
        }
    }

    /// 按来源与媒体类型选择加载视图：
    /// 在线用服务端 mediaType 区分；本地按扩展名区分；视频走 AVPlayer 卡片
    @ViewBuilder
    private var imageContent: some View {
        switch item {
        case .remote(let file):
            if file.mediaType == "video" {
                RemoteVideoCardView(
                    fileId: file.id,
                    client: client,
                    isPlaying: isPlaying
                )
            } else {
                CachedImageView(
                    fileId: file.id,
                    kind: isCurrent ? .original : .thumbnail,
                    client: client,
                    reduceMotion: reduceMotion
                )
            }
        case .local(let url):
            if LocalImageSource.isVideoFile(url) {
                VideoCardView(url: url, isPlaying: isPlaying)
            } else {
                LocalImageView(
                    url: url,
                    isLarge: isCurrent,
                    reduceMotion: reduceMotion
                )
            }
        }
    }

    /// 在默认浏览器打开 Luvia 网页前端，深链定位到该媒体所在文件夹视图。
    /// URL 格式：{服务器地址}/?token={壁纸令牌}#folder={文件夹路径}
    /// （token 是 JWT，前端启动时读取写入 localStorage；#folder= 为前端已有深链）
    private func openInWeb(_ file: MediaFile) {
        Task {
            guard let client else { return }
            let base = await client.serverUrl
            let token = await client.token

            // 与 JS encodeURIComponent 对齐的编码字符集
            var allowed = CharacterSet.urlQueryAllowed
            allowed.remove(charactersIn: ";/?:@&=+$,#")
            let encodedToken = token.addingPercentEncoding(withAllowedCharacters: allowed) ?? token
            let encodedFolder = file.folderPath.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""

            let urlString = "\(base)/?token=\(encodedToken)#folder=\(encodedFolder)"
            guard let url = URL(string: urlString) else { return }
            await NSWorkspace.shared.open(url)
        }
    }
}
