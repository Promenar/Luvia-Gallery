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
        // 创建悬浮窗：titled + fullSizeContentView，隐藏标题栏与红绿灯按钮，
        // 视觉上是圆角浮窗，但原生边缘缩放与整窗拖动全部保留
        let window = FloatingWindow(
            contentRect: NSRect(x: 0, y: 0, width: 980, height: 320),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        // 最小尺寸：允许缩到窄条形 / 小方块形态（卡片过窄时等比裁切即可）
        window.minSize = NSSize(width: 260, height: 180)
        window.delegate = self
        window.contentView = NSHostingView(rootView: ContentView())

        // 恢复上次退出时的窗口 frame；落在屏幕可见区域外（拔屏/多屏变化）
        // 时回退到居中默认位置，防止窗口"丢"在屏幕外
        if let saved = UserDefaults.standard.string(forKey: Self.windowFrameKey),
           Self.isFrameVisible(NSRectFromString(saved)) {
            window.setFrame(NSRectFromString(saved), display: false)
        } else {
            window.center()
        }

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

    // MARK: - 窗口 frame 记忆

    /// 持久化 key（手动方案：比 setFrameAutosaveName 更可控，
    /// 避免与网格吸附 / 程序化 setFrame 的时序冲突）
    private static let windowFrameKey = "windowFrame"

    /// 节流保存任务：拖动/缩放中频繁触发 delegate，frame 稳定 0.5s 后才落盘
    private var frameSaveWorkItem: DispatchWorkItem?

    /// 节流保存窗口 frame
    private func scheduleFrameSave(_ window: NSWindow) {
        frameSaveWorkItem?.cancel()
        let frame = window.frame
        let item = DispatchWorkItem {
            UserDefaults.standard.set(NSStringFromRect(frame), forKey: Self.windowFrameKey)
        }
        frameSaveWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: item)
    }

    /// 屏幕边界校验：窗口至少在某个屏幕的可见区域内有
    /// 80x40 以上的可见部分才认为可恢复
    private static func isFrameVisible(_ rect: NSRect) -> Bool {
        guard rect.width > 0, rect.height > 0 else { return false }
        for screen in NSScreen.screens {
            let intersection = rect.intersection(screen.visibleFrame)
            if !intersection.isNull, intersection.width >= 80, intersection.height >= 40 {
                return true
            }
        }
        return false
    }

    func windowDidResize(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        scheduleFrameSave(window)
    }

    // MARK: - 桌面网格吸附

    /// 防抖任务：拖动中 windowDidMove 频繁触发，frame 稳定 0.2s 后才吸附
    private var snapWorkItem: DispatchWorkItem?

    func windowDidMove(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        // 记忆 frame（吸附动画结束后的最终位置也会再次触发本回调，最终落盘值正确）
        scheduleFrameSave(window)
        // 开关关闭时完全不吸附（@AppStorage("snapToGrid")，缺省视为开）
        let defaults = UserDefaults.standard
        guard defaults.object(forKey: "snapToGrid") == nil || defaults.bool(forKey: "snapToGrid") else { return }
        // 位置锁定期间不吸附（窗口已禁止拖动，此处双保险）
        guard !defaults.bool(forKey: "positionLocked") else { return }
        // 窗口缩放期间（含左/上边缘缩放引起的原点移动）不吸附
        guard !window.inLiveResize else { return }

        snapWorkItem?.cancel()
        let item = DispatchWorkItem { [weak window] in
            guard let window, !window.inLiveResize else { return }
            guard let screen = window.screen ?? NSScreen.main,
                  let target = DesktopGrid.shared.snappedFrame(for: window.frame, in: screen)
            else { return }
            // 0.2s 动画滑到最近网格点
            window.setFrame(target, display: true, animate: true)
        }
        snapWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: item)
    }

    /// 点击 Dock 图标：重新显示悬浮窗
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            WindowController.shared.showWindow()
        }
        return false
    }
}
