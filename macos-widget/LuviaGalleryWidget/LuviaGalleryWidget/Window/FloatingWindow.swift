//
//  FloatingWindow.swift
//  LuviaGalleryWidget
//
//  无边框透明悬浮窗及其窗口控制器。
//

import AppKit

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

    /// 根据开关应用置顶层级
    func applyLevel(floatingOnTop: Bool) {
        window?.level = floatingOnTop ? .floating : .normal
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
