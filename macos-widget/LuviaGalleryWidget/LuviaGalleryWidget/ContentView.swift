//
//  ContentView.swift
//  LuviaGalleryWidget
//
//  悬浮相册轮播主界面：标题栏、卡片轮播行、设置面板、底部进度条。
//

import SwiftUI
import AppKit

struct ContentView: View {

    // MARK: - 持久化设置（@AppStorage）

    @AppStorage("serverAddress") private var serverAddress: String = ""
    @AppStorage("apiToken") private var apiToken: String = ""
    @AppStorage("loadMode") private var loadMode: String = "random"
    @AppStorage("folderPath") private var folderPath: String = ""
    @AppStorage("intervalSeconds") private var intervalSeconds: Double = 6
    @AppStorage("floatingOnTop") private var floatingOnTop: Bool = true

    // MARK: - 状态

    @StateObject private var viewModel = CarouselViewModel()
    /// 设置面板展开/收起
    @State private var showSettings = false
    /// 当前悬停卡片在可见窗口中的偏移（nil 表示无悬停）
    @State private var hoveredOffset: Int? = nil
    /// 系统"减少动态效果"偏好
    @State private var reduceMotion = false

    /// 品牌蓝
    private let accentBlue = Color(red: 0x3f / 255, green: 0x7b / 255, blue: 0xff / 255)
    /// 卡片间距
    private let cardSpacing: CGFloat = 10

    /// 弹簧动画（减少动态效果时关闭）
    private var springAnimation: Animation? {
        reduceMotion ? nil : .spring(response: 0.55, dampingFraction: 0.85)
    }

    /// 是否已配置来源
    private var hasConfig: Bool {
        !serverAddress.isEmpty && !apiToken.isEmpty
    }

    // MARK: - 界面

    var body: some View {
        ZStack {
            // 深色圆角卡片底（圆角 16）
            RoundedRectangle(cornerRadius: 16)
                .fill(Color(red: 0.07, green: 0.08, blue: 0.11))

            if !hasConfig && viewModel.files.isEmpty && !showSettings {
                emptyState
            } else {
                mainContent
            }
        }
        // 给窗口阴影留出呼吸空间
        .padding(8)
        .frame(minWidth: 464, minHeight: 244)
        // 内容延伸到标题栏区域（标题栏已透明隐藏）
        .ignoresSafeArea()
        .onAppear {
            reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
            viewModel.intervalSeconds = intervalSeconds
            WindowController.shared.applyLevel(floatingOnTop: floatingOnTop)
            // 已配置则自动加载
            if hasConfig && viewModel.files.isEmpty {
                performLoad()
            }
        }
        .onChange(of: intervalSeconds) { _, newValue in
            viewModel.intervalSeconds = newValue
        }
        .onChange(of: floatingOnTop) { _, newValue in
            WindowController.shared.applyLevel(floatingOnTop: newValue)
        }
    }

    // MARK: - 主内容

    private var mainContent: some View {
        VStack(spacing: 0) {
            titleBar

            if showSettings {
                SettingsPanel(
                    serverAddress: $serverAddress,
                    apiToken: $apiToken,
                    loadMode: $loadMode,
                    folderPath: $folderPath,
                    intervalSeconds: $intervalSeconds,
                    floatingOnTop: $floatingOnTop,
                    viewModel: viewModel,
                    onLoad: performLoad,
                    onCollapse: collapseSettings
                )
                .transition(.move(edge: .top).combined(with: .opacity))
            }

            carouselRow
                .frame(maxHeight: .infinity)
                .padding(.horizontal, 14)

            bottomBar
        }
        .padding(.top, 4)
    }

    // MARK: - 顶部标题栏

    private var titleBar: some View {
        HStack(spacing: 8) {
            Text("相册轮播")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.92))

            // 序号：当前 / 总数
            Text("\(viewModel.files.isEmpty ? 0 : viewModel.currentIndex + 1) / \(viewModel.files.count)")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.white.opacity(0.4))

            Spacer()

            // 置顶切换：置顶时实心图钉高亮，非置顶线框灰色
            titleBarButton(
                icon: floatingOnTop ? "pin.fill" : "pin",
                help: floatingOnTop ? "取消置顶" : "置顶到所有窗口之上",
                color: floatingOnTop ? accentBlue : nil
            ) {
                floatingOnTop.toggle()
            }

            // 播放/暂停
            titleBarButton(
                icon: viewModel.isPlaying ? "pause.fill" : "play.fill",
                help: viewModel.isPlaying ? "暂停" : "播放"
            ) {
                viewModel.togglePlaying()
            }

            // 设置齿轮：真正的开关，展开时再点一次收起
            titleBarButton(
                icon: showSettings ? "gearshape.fill" : "gearshape",
                help: showSettings ? "收起设置" : "设置"
            ) {
                withAnimation(springAnimation) {
                    showSettings.toggle()
                }
            }

            // 关闭（隐藏窗口，不退出 App）
            titleBarButton(icon: "xmark", help: "关闭") {
                WindowController.shared.closeWindow()
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    /// 标题栏小图标按钮（color 为空时用默认灰色）
    private func titleBarButton(icon: String, help: String, color: Color? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(color ?? .white.opacity(0.65))
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(help)
    }

    // MARK: - 轮播卡片行

    /// 卡片宽度权重：悬停时悬停卡展开 2.5、其余 0.6；否则当前大卡 2.1、其余 1.0
    private func weight(for offset: Int) -> CGFloat {
        if let hovered = hoveredOffset {
            return offset == hovered ? 2.5 : 0.6
        }
        return offset == 0 ? 2.1 : 1.0
    }

    private var carouselRow: some View {
        GeometryReader { geo in
            let visible = viewModel.visibleFiles
            let weights = (0..<max(visible.count, 1)).map { weight(for: $0) }
            let totalWeight = weights.reduce(0, +)
            let available = geo.size.width - cardSpacing * CGFloat(max(visible.count - 1, 0))

            HStack(spacing: cardSpacing) {
                ForEach(Array(visible.enumerated()), id: \.element.id) { offset, file in
                    CarouselCard(
                        file: file,
                        number: offset + 1,
                        isCurrent: offset == 0,
                        client: viewModel.client,
                        reduceMotion: reduceMotion
                    )
                    .frame(width: max(available * weights[offset] / totalWeight, 0))
                    .onHover { hovering in
                        handleHover(hovering, offset: offset)
                    }
                    .onTapGesture {
                        // 点击任意卡片立即跳转并重置计时
                        viewModel.jump(toVisibleOffset: offset)
                    }
                }
            }
            .frame(height: geo.size.height)
            // 权重变化用弹簧动画平滑过渡
            .animation(springAnimation, value: weights)
        }
        .frame(minHeight: 120)
    }

    /// 悬停处理：展开手风琴 + 暂停轮播（浮光由卡片内部自管理）
    private func handleHover(_ hovering: Bool, offset: Int) {
        if hovering {
            hoveredOffset = offset
            viewModel.isHoveringCard = true
        } else if hoveredOffset == offset {
            hoveredOffset = nil
            viewModel.isHoveringCard = false
        }
    }

    /// 收起设置面板（面板内「收起」按钮 / 加载成功后调用）
    private func collapseSettings() {
        withAnimation(springAnimation) {
            showSettings = false
        }
    }

    // MARK: - 底部进度条与来源说明

    private var bottomBar: some View {
        VStack(spacing: 6) {
            // 3px 蓝色进度条
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle().fill(.white.opacity(0.08))
                    Rectangle()
                        .fill(accentBlue)
                        .frame(width: geo.size.width * min(max(viewModel.progress, 0), 1))
                }
            }
            .frame(height: 3)
            .clipShape(Capsule())
            .padding(.horizontal, 16)

            // 来源说明
            HStack(spacing: 5) {
                Circle()
                    .fill(viewModel.files.isEmpty ? .gray : .green)
                    .frame(width: 5, height: 5)
                Text("Luvia Gallery \(viewModel.files.isEmpty ? "未连接" : "在线 \(viewModel.files.count) 张")")
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.4))
                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    // MARK: - 空状态

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "photo.stack")
                .font(.system(size: 30))
                .foregroundStyle(.white.opacity(0.3))
            Text("还没有在线相册来源")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.6))
            Text("连接你的 Luvia Gallery 服务器，\n照片将以悬浮卡片的方式在桌面轮播。")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.35))
                .multilineTextAlignment(.center)
            Button {
                withAnimation(springAnimation) {
                    showSettings = true
                }
            } label: {
                Label("添加在线来源", systemImage: "plus.circle.fill")
            }
            .buttonStyle(.borderedProminent)
        }
    }

    // MARK: - 加载动作

    /// 立即加载：成功后收起设置面板并同步配置到 App Groups（供 Widget 共享）
    private func performLoad() {
        let mode = WidgetConfig.DisplayMode(rawValue: loadMode) ?? .random
        Task {
            let success = await viewModel.load(
                server: serverAddress,
                token: apiToken,
                mode: mode,
                folder: folderPath
            )
            if success {
                // 同步配置到 App Groups，与 WidgetKit 扩展共享
                TokenStore.shared.saveConfig(
                    WidgetConfig(
                        serverUrl: serverAddress,
                        token: apiToken,
                        mode: mode,
                        folderPath: folderPath,
                        showVideos: false,
                        refreshInterval: 30
                    )
                )
                // 加载成功后自动收起设置面板
                collapseSettings()
            }
        }
    }
}

#Preview {
    ContentView()
        .frame(width: 980, height: 320)
}
