//
//  VideoCardView.swift
//  LuviaGalleryWidget
//
//  视频卡片：AVPlayer 静音循环播放（photos 风格），等比填充裁切。
//  手风琴收缩态 / 不可见时暂停，控制内存与解码开销。
//

import SwiftUI
import AVFoundation

// MARK: - VideoCardView

/// 通用视频播放卡片（本地 file URL 或带 token 的远程 URL 均可）
struct VideoCardView: NSViewRepresentable {

    let url: URL
    /// 是否应播放（收缩态 / 被设置面板覆盖时为 false）
    let isPlaying: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> PlayerContainerView {
        let view = PlayerContainerView()
        context.coordinator.configure(url: url, view: view)
        context.coordinator.applyPlayState(isPlaying)
        return view
    }

    func updateNSView(_ view: PlayerContainerView, context: Context) {
        context.coordinator.configure(url: url, view: view)
        context.coordinator.applyPlayState(isPlaying)
    }

    static func dismantleNSView(_ nsView: PlayerContainerView, coordinator: Coordinator) {
        coordinator.teardown()
    }

    // MARK: Coordinator

    @MainActor
    final class Coordinator {
        private var player: AVPlayer?
        private var currentURL: URL?
        private var loopObserver: NSObjectProtocol?
        /// 外部要求的播放状态（循环到片尾时据此决定是否继续播）
        private var wantPlaying = true

        /// 按 URL 配置播放器（URL 未变化时不动，避免频繁重建缓冲）
        func configure(url: URL, view: PlayerContainerView) {
            guard currentURL != url else { return }
            teardown()

            let item = AVPlayerItem(url: url)
            // 限制前向缓冲，多卡同屏时控制内存
            item.preferredForwardBufferDuration = 5
            let player = AVPlayer(playerItem: item)
            player.isMuted = true
            player.actionAtItemEnd = .none
            player.automaticallyWaitsToMinimizeStalling = true
            view.playerLayer.player = player

            // 循环播放：到片尾回到开头
            loopObserver = NotificationCenter.default.addObserver(
                forName: .AVPlayerItemDidPlayToEndTime,
                object: item,
                queue: .main
            ) { [weak self] _ in
                guard let self else { return }
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.player?.seek(to: .zero)
                    if self.wantPlaying {
                        self.player?.play()
                    }
                }
            }

            self.player = player
            self.currentURL = url
        }

        /// 应用外部播放状态
        func applyPlayState(_ isPlaying: Bool) {
            wantPlaying = isPlaying
            if isPlaying {
                player?.play()
            } else {
                player?.pause()
            }
        }

        /// 释放播放器与观察者
        func teardown() {
            if let loopObserver {
                NotificationCenter.default.removeObserver(loopObserver)
                self.loopObserver = nil
            }
            player?.pause()
            player = nil
            currentURL = nil
        }
    }
}

// MARK: - PlayerContainerView

/// 承载 AVPlayerLayer 的容器视图，等比填充裁切
final class PlayerContainerView: NSView {

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        let playerLayer = AVPlayerLayer()
        playerLayer.videoGravity = .resizeAspectFill
        playerLayer.backgroundColor = NSColor(white: 0.08, alpha: 1).cgColor
        layer = playerLayer
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) 未实现")
    }

    var playerLayer: AVPlayerLayer {
        // swiftlint:disable:next force_cast
        layer as! AVPlayerLayer
    }

    override func layout() {
        super.layout()
        playerLayer.frame = bounds
    }
}

// MARK: - RemoteVideoCardView

/// 远程视频卡片：APIClient 是 actor，需异步解析带 token 的播放地址
struct RemoteVideoCardView: View {

    let fileId: String
    let client: APIClient?
    let isPlaying: Bool

    @State private var url: URL?

    var body: some View {
        Group {
            if let url {
                VideoCardView(url: url, isPlaying: isPlaying)
            } else {
                // 地址解析中占位
                ZStack {
                    Color(white: 0.14)
                    ProgressView()
                        .controlSize(.small)
                        .tint(.white.opacity(0.4))
                }
            }
        }
        .task(id: fileId) {
            // /api/file/{id} 原样返回文件流，视频直接用该地址播放
            url = await client?.originalImageURL(for: fileId)
        }
    }
}
