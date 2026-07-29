//
//  FloatingWindow.swift
//  LuviaGalleryWidget
//
//  无边框透明悬浮窗及其窗口控制器。
//

import AppKit
import CoreGraphics
import OSLog

// MARK: - FloatingWindow

/// 无边框、透明背景、可拖动的悬浮窗。
/// 默认 borderless 窗口无法成为 key window（输入框无法聚焦），
/// 因此需要子类化并放行 canBecomeKey / canBecomeMain。
final class FloatingWindow: NSWindow {

    override init(
        contentRect: NSRect,
        styleMask style: NSWindow.StyleMask,
        backing backingStoreType: NSWindow.BackingStoreType,
        defer flag: Bool
    ) {
        super.init(contentRect: contentRect, styleMask: style, backing: backingStoreType, defer: flag)
        // 透明背景，圆角由 SwiftUI 内容自行裁剪
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        // 隐藏标题栏：透明 + 隐藏标题文字 + 隐藏红绿灯按钮
        titlebarAppearsTransparent = true
        titleVisibility = .hidden
        for buttonType: NSWindow.ButtonType in [.closeButton, .miniaturizeButton, .zoomButton] {
            standardWindowButton(buttonType)?.superview?.isHidden = true
        }
        // 内容区按住拖动窗口改由 WindowDragView 空白拖动层实现
        // （isMovableByWindowBackground 会劫持文本框内的拖选，关闭）
        isMovableByWindowBackground = false
        // 默认置顶（悬浮在所有窗口之上）
        level = .floating
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

// MARK: - WindowController

/// 供 SwiftUI 视图操作底层窗口（置顶层级、关闭、重开）
@MainActor
final class WindowController {

    static let shared = WindowController()

    /// 诊断日志（穿透状态机验证用，unified log 可查）
    private static let ctLogger = Logger(subsystem: "com.luvia.LuviaGalleryWidget", category: "WindowController")

    private weak var window: NSWindow?
    /// 由 AppDelegate 注册，在任何隐藏入口执行 orderOut 前同步位置快照。
    private var beforeOrderOut: ((NSWindow) -> Void)?

    private init() {}

    /// 绑定 AppDelegate 创建的悬浮窗
    func attach(_ window: NSWindow, beforeOrderOut: @escaping (NSWindow) -> Void) {
        self.window = window
        self.beforeOrderOut = beforeOrderOut
    }

    /// 根据开关应用窗口层级与集合行为
    /// - 置顶：.floating，浮在所有普通窗口之上
    /// - 非置顶：桌面图标层级 +1（普通 App 窗口之下），成为真正的"桌面组件"，
    ///   台前调度不会收编非正常层级的窗口，不会被吸到屏幕边缘
    func applyLevel(floatingOnTop: Bool) {
        guard let window else { return }

        // 两种层级统一集合行为：
        // .canJoinAllSpaces + .stationary —— 所有桌面 Space 可见且位置固定
        //   （符合"桌面组件"语义，刻意不选 .moveToActiveSpace）
        // .ignoresCycle —— 不进入 Cmd+Tab / 窗口循环
        // .fullScreenAuxiliary —— 可叠加在全屏 App 的 Space 上
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]

        if floatingOnTop {
            window.level = .floating
        } else {
            window.level = NSWindow.Level(
                rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1
            )
        }
    }

    /// 锁定/解锁窗口位置与尺寸：
    /// 锁定 = 禁止拖动 + 禁止边缘缩放（坐标和尺寸都固定）。
    /// 除移除 .resizable 外必须同步关闭 isMovable：
    /// titled + fullSizeContentView 窗口的标题栏区域存在 AppKit 原生拖动路径，
    /// 不经过 WindowDragView 的事件守卫；实测锁→开→锁循环后该路径仍可拖窗，
    /// 仅 isMovable=false 能彻底关闭。
    func setLocked(_ locked: Bool) {
        guard let window else { return }
        window.isMovable = !locked
        if locked {
            window.styleMask.remove(.resizable)
        } else {
            window.styleMask.insert(.resizable)
        }
    }

    /// 隐藏窗口（不退出 App）
    func closeWindow() {
        guard let window else { return }
        beforeOrderOut?(window)
        window.orderOut(nil)
    }

    /// 重新显示窗口（Dock 图标点击时调用）
    func showWindow() {
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// 窗口当前是否可见（菜单栏菜单动态标题用）
    var isWindowVisible: Bool {
        window?.isVisible ?? false
    }

    /// 切换窗口可见性（菜单栏"显示/隐藏悬浮窗"）：
    /// 隐藏走 orderOut；显示复用 showWindow，按既有层级/位置恢复
    func toggleVisibility() {
        if isWindowVisible {
            closeWindow()
        } else {
            showWindow()
        }
    }

    // MARK: - 点击穿透（复合状态机）

    /// 穿透开关值（@AppStorage 持久化，设置面板/菜单栏共同控制）
    private var clickThroughSwitch = false
    /// 设置面板是否展开（ContentView 的 showSettings 是唯一权威来源，
    /// 经 onChange 单向同步到这里，避免绑定环路）
    private var settingsPanelOpen = false

    /// 穿透实际生效 ⟺（开关开 ∧ 设置面板收起）。
    /// 设置面板展开期间穿透自动挂起：面板里打开开关后窗口保持可交互，
    /// 收起那一刻生效；穿透中从菜单栏「打开设置」临时解除，收起自动恢复。
    private func applyClickThroughState() {
        let effective = clickThroughSwitch && !settingsPanelOpen
        window?.ignoresMouseEvents = effective
        Self.ctLogger.log("穿透生效=\(effective)（开关=\(self.clickThroughSwitch)，设置面板展开=\(self.settingsPanelOpen)）")
    }

    /// 更新穿透开关值（启动恢复 / onChange 调用）
    func setClickThroughSwitch(_ on: Bool) {
        clickThroughSwitch = on
        applyClickThroughState()
    }

    /// 同步设置面板展开状态（ContentView.onChange(showSettings) 调用）
    func setSettingsPanelOpen(_ open: Bool) {
        settingsPanelOpen = open
        applyClickThroughState()
    }
}
