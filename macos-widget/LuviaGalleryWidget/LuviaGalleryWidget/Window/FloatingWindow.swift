//
//  FloatingWindow.swift
//  LuviaGalleryWidget
//
//  无边框透明悬浮窗及其窗口控制器。
//

import AppKit
import CoreGraphics

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

    private weak var window: NSWindow?

    private init() {}

    /// 绑定 AppDelegate 创建的悬浮窗
    func attach(_ window: NSWindow) {
        self.window = window
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
    /// 锁定 = 禁止拖动 + 禁止边缘缩放（坐标和尺寸都固定）
    func setLocked(_ locked: Bool) {
        guard let window else { return }
        if locked {
            window.styleMask.remove(.resizable)
        } else {
            window.styleMask.insert(.resizable)
        }
    }

    /// 隐藏窗口（不退出 App）
    func closeWindow() {
        window?.orderOut(nil)
    }

    /// 重新显示窗口（Dock 图标点击时调用）
    func showWindow() {
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }
}
