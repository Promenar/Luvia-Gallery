//
//  LuviaGalleryWidgetApp.swift
//  LuviaGalleryWidget
//
//  悬浮相册轮播 App 入口。
//  窗口由 AppDelegate 手动创建（自定义 NSWindow 子类），
//  SwiftUI 生命周期仅负责维持 App 运行。
//

import SwiftUI
import AppKit

@main
struct LuviaGalleryWidgetApp: App {
    // 桥接 AppDelegate，由它创建并管理悬浮窗
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        // 窗口完全由 AppDelegate 托管，这里仅保留一个占位 Scene
        Settings { EmptyView() }
    }
}

// MARK: - AppDelegate

/// 负责创建悬浮窗、接管关闭/重开行为
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 创建无边框透明悬浮窗
        let window = FloatingWindow(
            contentRect: NSRect(x: 0, y: 0, width: 980, height: 320),
            styleMask: [.borderless, .resizable],
            backing: .buffered,
            defer: false
        )
        window.minSize = NSSize(width: 480, height: 260)
        // 内容区按住即可拖动窗口
        window.isMovableByWindowBackground = true
        window.delegate = self
        window.contentView = NSHostingView(rootView: ContentView())
        window.center()

        // 注册到窗口控制器，供 SwiftUI 侧操作（置顶/关闭/重开）
        WindowController.shared.attach(window)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// 点击关闭按钮：隐藏窗口而不是退出 App
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    /// 点击 Dock 图标：重新显示悬浮窗
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            WindowController.shared.showWindow()
        }
        return false
    }
}
