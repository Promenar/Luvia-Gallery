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
    /// 开机自动启动的用户意图（UI 回显以系统 SMAppService 状态为准）
    @AppStorage("launchAtLogin") private var launchAtLogin: Bool = false
    /// 拖动松手后吸附桌面网格（默认开）
    @AppStorage("snapToGrid") private var snapToGrid: Bool = true
    /// 吸附网格 cell 边长（用户校准值，px）
    @AppStorage("gridCellSize") private var gridCellSize: Double = 84
    /// 图片来源："online"（Luvia Gallery）/ "local"（本地目录）
    @AppStorage("sourceMode") private var sourceMode: String = "online"
    /// 本地目录 security-scoped bookmark（沙盒持久化访问权限）
    @AppStorage("localFolderBookmark") private var localFolderBookmark: Data = Data()
    /// 本地目录显示路径（仅 UI 展示）
    @AppStorage("localFolderPath") private var localFolderPath: String = ""
    /// 本地目录是否递归子目录（默认递归）
    @AppStorage("localRecursive") private var localRecursive: Bool = true
    /// 同时呈现的卡片数量（1–6）
    @AppStorage("displayCount") private var displayCount: Double = 6
    /// 卡片排列方向："horizontal"（横向手风琴）/ "vertical"（纵向）
    @AppStorage("layoutDirection") private var layoutDirection: String = "horizontal"
    /// 媒体过滤："all"（全部）/ "image"（仅图片）/ "video"（仅视频）
    @AppStorage("mediaFilter") private var mediaFilter: String = "all"
    /// 一键锁定坐标：锁定后禁止拖动与边缘缩放
    @AppStorage("positionLocked") private var positionLocked: Bool = false

    // MARK: - 状态

    @StateObject private var viewModel = CarouselViewModel()
    /// 设置面板展开/收起
    @State private var showSettings = false
    /// 当前悬停卡片在可见窗口中的偏移（nil 表示无悬停）
    @State private var hoveredOffset: Int? = nil
    /// 系统"减少动态效果"偏好
    @State private var reduceMotion = false
    /// 本地目录当前已恢复访问的 URL（App 生命周期内保持）
    @State private var localFolderURL: URL? = nil

    /// 品牌蓝
    private let accentBlue = Color(red: 0x3f / 255, green: 0x7b / 255, blue: 0xff / 255)
    /// 卡片间距
    private let cardSpacing: CGFloat = 10

    /// hover 手风琴弹簧（较快手感，减少动态效果时关闭）
    private var hoverSpring: Animation? {
        reduceMotion ? nil : .spring(response: 0.55, dampingFraction: 0.85)
    }

    /// 轮播换批弹簧（放慢，避免"闪现"感）
    private var shuffleSpring: Animation? {
        reduceMotion ? nil : .spring(response: 0.85, dampingFraction: 0.9)
    }

    /// 是否已配置来源
    private var hasConfig: Bool {
        if sourceMode == "local" {
            return !localFolderBookmark.isEmpty
        }
        return !serverAddress.isEmpty && !apiToken.isEmpty
    }

    // MARK: - 界面

    var body: some View {
        ZStack {
            // 最底层：空白区域拖动层（按钮/滑块/输入框/卡片在其上方，事件优先到达控件；
            // 锁定位置后不再触发拖窗）
            WindowDragView(isLocked: positionLocked)

            // 极轻深色 tint：叠在玻璃材质之上保证文字对比度，
            // 同时仍能透出桌面壁纸（窗口本身 isOpaque=false + clear 背景）。
            // 不拦截命中，确保鼠标事件穿透到下方拖动层
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(.black.opacity(0.18))
                .allowsHitTesting(false)

            if !hasConfig && viewModel.items.isEmpty && !showSettings {
                emptyState
            } else {
                mainContent
            }
        }
        // 液态玻璃外壳（macOS 26 Liquid Glass API）：
        // .regular 玻璃渲染在视图后方，裁剪为 16px 圆角
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        // 给窗口阴影留出呼吸空间
        .padding(8)
        // 内容最小尺寸（比窗口 minSize 小一圈阴影 padding，跟随窗口下限调整）
        .frame(minWidth: 244, minHeight: 164)
        // 内容延伸到标题栏区域（标题栏已透明隐藏）
        .ignoresSafeArea()
        .onAppear {
            reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
            viewModel.intervalSeconds = intervalSeconds
            viewModel.visibleCount = Int(displayCount)
            viewModel.mediaFilter = mediaFilter
            WindowController.shared.applyLevel(floatingOnTop: floatingOnTop)
            // 恢复上次的锁定状态（禁止拖动/缩放）
            WindowController.shared.setLocked(positionLocked)
            // 开机启动开关以系统侧真实状态为准回显
            launchAtLogin = LoginItemManager.isEnabled
            // 已配置则自动加载
            if hasConfig && viewModel.items.isEmpty {
                performLoad()
            }
        }
        .onChange(of: intervalSeconds) { _, newValue in
            viewModel.intervalSeconds = newValue
        }
        .onChange(of: displayCount) { _, newValue in
            // 同时呈现数量变化，权重布局即时动画过渡
            viewModel.visibleCount = Int(newValue)
        }
        .onChange(of: mediaFilter) { _, newValue in
            // 媒体过滤即时生效（从已加载的完整列表重新过滤，无需重新请求）
            viewModel.mediaFilter = newValue
        }
        .onChange(of: floatingOnTop) { _, newValue in
            WindowController.shared.applyLevel(floatingOnTop: newValue)
        }
        .onChange(of: positionLocked) { _, newValue in
            // 锁定/解锁：即时切换窗口可缩放性
            WindowController.shared.setLocked(newValue)
        }
    }

    // MARK: - 主内容

    /// 设置面板覆盖/收起的过渡动画（减少动态效果时关闭）
    private var settingsAnimation: Animation? {
        reduceMotion ? nil : .easeInOut(duration: 0.25)
    }

    private var mainContent: some View {
        VStack(spacing: 0) {
            titleBar

            // stage 区域：设置面板展开时完整覆盖卡片区，
            // 标题栏与底部行保持不动
            ZStack {
                if showSettings {
                    // 面板撑满卡片区全部高度，内容超出内部滚动
                    ScrollView {
                        SettingsPanel(
                            serverAddress: $serverAddress,
                            apiToken: $apiToken,
                            loadMode: $loadMode,
                            folderPath: $folderPath,
                            intervalSeconds: $intervalSeconds,
                            floatingOnTop: $floatingOnTop,
                            launchAtLogin: $launchAtLogin,
                            snapToGrid: $snapToGrid,
                            gridCellSize: $gridCellSize,
                            sourceMode: $sourceMode,
                            localFolderPath: $localFolderPath,
                            localRecursive: $localRecursive,
                            displayCount: $displayCount,
                            layoutDirection: $layoutDirection,
                            mediaFilter: $mediaFilter,
                            viewModel: viewModel,
                            onLoad: performLoad,
                            onChooseLocalFolder: chooseLocalFolder,
                            onCollapse: collapseSettings
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                } else {
                    carouselRow
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
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
            Text("\(viewModel.items.isEmpty ? 0 : viewModel.currentIndex + 1) / \(viewModel.items.count)")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.white.opacity(0.4))

            Spacer()

            // 锁定位置：锁定后实心锁高亮，禁止拖动与边缘缩放
            titleBarButton(
                icon: positionLocked ? "lock.fill" : "lock.open",
                help: positionLocked ? "解锁位置" : "锁定位置",
                color: positionLocked ? accentBlue : nil
            ) {
                positionLocked.toggle()
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
                withAnimation(settingsAnimation) {
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

    /// 是否为纵向排列
    private var isVerticalLayout: Bool {
        layoutDirection == "vertical"
    }

    private var carouselRow: some View {
        GeometryReader { geo in
            let visible = viewModel.visibleItems
            let weights = (0..<max(visible.count, 1)).map { weight(for: $0) }
            let totalWeight = weights.reduce(0, +)
            // 按当前排列轴取可用主轴长度
            let available = (isVerticalLayout ? geo.size.height : geo.size.width)
                - cardSpacing * CGFloat(max(visible.count - 1, 0))

            Group {
                if isVerticalLayout {
                    // 纵向：VStack，权重驱动高度
                    VStack(spacing: cardSpacing) {
                        cardViews(visible: visible, weights: weights, available: available, totalWeight: totalWeight)
                    }
                } else {
                    // 横向：HStack，权重驱动宽度
                    HStack(spacing: cardSpacing) {
                        cardViews(visible: visible, weights: weights, available: available, totalWeight: totalWeight)
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
            // 轮播换批：慢速弹簧过渡权重与新卡入场
            .animation(shuffleSpring, value: viewModel.currentIndex)
            // 同时呈现数量变化：权重布局即时动画过渡
            .animation(shuffleSpring, value: displayCount)
            // 排列方向切换：平滑过渡到新布局
            .animation(shuffleSpring, value: layoutDirection)
            // hover 手风琴：保持较快手感
            .animation(hoverSpring, value: hoveredOffset)
        }
        // 卡片区最小高度压低，保证窗口缩到最小尺寸时不溢出
        .frame(minHeight: 60)
    }

    /// 生成一组卡片视图（横向驱动宽度、纵向驱动高度，其余交互完全一致）
    @ViewBuilder
    private func cardViews(visible: [CarouselItem], weights: [CGFloat], available: CGFloat, totalWeight: CGFloat) -> some View {
        ForEach(Array(visible.enumerated()), id: \.element.id) { offset, item in
            CarouselCard(
                item: item,
                number: offset + 1,
                isCurrent: offset == 0,
                client: viewModel.client,
                reduceMotion: reduceMotion,
                // 手风琴收缩态暂停视频；设置面板覆盖时全部暂停
                isPlaying: !showSettings && (hoveredOffset == nil || hoveredOffset == offset)
            )
            .modifier(CardSizeModifier(
                isVertical: isVerticalLayout,
                length: max(available * weights[offset] / totalWeight, 0)
            ))
            // 新进入可见窗口的卡片：淡入 + 沿主轴轻微滑入，避免"闪现"
            // （横向从右滑入，纵向从下滑入）
            .transition(
                reduceMotion
                    ? .identity
                    : .opacity.combined(with: .offset(
                        x: isVerticalLayout ? 0 : 20,
                        y: isVerticalLayout ? 20 : 0
                    ))
            )
            .onHover { hovering in
                handleHover(hovering, offset: offset)
            }
            .onTapGesture {
                // 点击任意卡片立即跳转并重置计时
                viewModel.jump(toVisibleOffset: offset)
            }
        }
    }

    /// 按排列方向约束卡片主轴尺寸的修饰器
    private struct CardSizeModifier: ViewModifier {
        let isVertical: Bool
        let length: CGFloat

        func body(content: Content) -> some View {
            if isVertical {
                content.frame(maxWidth: .infinity).frame(height: length)
            } else {
                content.frame(width: length).frame(maxHeight: .infinity)
            }
        }
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
        withAnimation(settingsAnimation) {
            showSettings = false
        }
    }

    // MARK: - 底部行：左侧来源说明 + 右侧进度条

    private var bottomBar: some View {
        HStack(spacing: 12) {
            // 来源说明（在线 / 本地）
            HStack(spacing: 5) {
                Circle()
                    .fill(viewModel.items.isEmpty ? .gray : .green)
                    .frame(width: 5, height: 5)
                Text(viewModel.sourceLabel)
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.4))
            }

            Spacer()

            // 3px 蓝色进度条（固定宽度，与来源文本同行）
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(.white.opacity(0.08))
                    Capsule()
                        .fill(accentBlue)
                        .frame(width: geo.size.width * min(max(viewModel.progress, 0), 1))
                }
            }
            .frame(width: 140, height: 3)
        }
        .padding(.horizontal, 16)
        // 与图片区之间保留约 10px 间距
        .padding(.top, 10)
        .padding(.bottom, 10)
    }

    // MARK: - 空状态

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "photo.stack")
                .font(.system(size: 30))
                .foregroundStyle(.white.opacity(0.3))
            Text("还没有相册来源")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.6))
            Text("连接 Luvia Gallery 服务器，或选择本地图片目录，\n照片将以悬浮卡片的方式在桌面轮播。")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.35))
                .multilineTextAlignment(.center)
            Button {
                withAnimation(settingsAnimation) {
                    showSettings = true
                }
            } label: {
                Label("添加图片来源", systemImage: "plus.circle.fill")
            }
            .buttonStyle(.borderedProminent)
        }
    }

    // MARK: - 加载动作

    /// 立即加载：按来源模式分发到在线 / 本地加载
    private func performLoad() {
        if sourceMode == "local" {
            performLocalLoad()
        } else {
            performOnlineLoad()
        }
    }

    /// 在线加载：成功后收起设置面板并同步配置到 App Groups（供 Widget 共享）
    private func performOnlineLoad() {
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

    /// 本地加载：解析 bookmark 恢复目录访问权限后扫描图片
    private func performLocalLoad() {
        // 优先复用已恢复访问的目录，否则从 bookmark 恢复
        let folder = localFolderURL ?? LocalImageSource.resolveBookmark(localFolderBookmark)
        guard let folder else {
            viewModel.reportLocalBookmarkStale()
            return
        }
        localFolderURL = folder
        Task {
            let success = await viewModel.loadLocal(folder: folder, recursive: localRecursive)
            if success {
                // 加载成功后自动收起设置面板
                collapseSettings()
            }
        }
    }

    /// 选择本地图片目录（NSOpenPanel，仅目录），选中后存 bookmark 并立即加载
    private func chooseLocalFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "选择"
        panel.message = "选择存放图片的目录"

        guard panel.runModal() == .OK, let url = panel.url else { return }

        // 创建 security-scoped bookmark 持久化沙盒访问权限
        guard let bookmark = LocalImageSource.createBookmark(for: url) else {
            viewModel.statusIsError = true
            viewModel.statusText = "无法保存目录访问权限，请重试"
            return
        }
        localFolderBookmark = bookmark
        localFolderPath = url.path

        // 恢复访问并立即加载
        if let resolved = LocalImageSource.resolveBookmark(bookmark) {
            localFolderURL = resolved
        } else {
            localFolderURL = url
        }
        performLocalLoad()
    }
}

#Preview {
    ContentView()
        .frame(width: 980, height: 320)
}
