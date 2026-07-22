//
//  CarouselCard.swift
//  LuviaGalleryWidget
//
//  单张轮播卡片：图片、编号角标、悬停浮光扫过效果（卡片内部自管理）。
//

import SwiftUI

// MARK: - CarouselCard

struct CarouselCard: View {

    let file: MediaFile
    /// 序号（1 起）
    let number: Int
    /// 是否为当前大卡（第一张）
    let isCurrent: Bool
    /// 图片客户端（小卡缩略图 / 大卡原图）
    let client: APIClient?
    /// 系统"减少动态效果"是否开启
    let reduceMotion: Bool

    /// 浮光水平位置系数：-1.4 左侧屏幕外 → 1.4 右侧屏幕外
    @State private var shineX: CGFloat = -1.4

    /// 品牌蓝（当前卡编号）
    private let accentBlue = Color(red: 0x3f / 255, green: 0x7b / 255, blue: 0xff / 255)

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                // 图片本体：大卡用原图，小卡用缩略图
                CachedImageView(
                    fileId: file.id,
                    kind: isCurrent ? .original : .thumbnail,
                    client: client
                )
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
        }
        .clipShape(RoundedRectangle(cornerRadius: 13))
        .contentShape(RoundedRectangle(cornerRadius: 13))
        // 卡片内部自管理浮光：鼠标进入时扫一次
        .onHover { hovering in
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
}
