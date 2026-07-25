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

    /// 按持久化值应用 Dock 图标可见性：
    /// - 隐藏（默认）：.accessory，不占 Dock 位、无应用主菜单；
    ///   本 App 是浮动窗口工具，窗口自身可成为 key，交互不受影响
    /// - 显示：.regular，Dock 图标恢复，并主动 activate 让窗口获得焦点
    /// 启动时（applicationDidFinishLaunching）与运行时（ContentView.onChange）
    /// 共用此入口，重复调用幂等。
    static func applyDockVisibility(hidden: Bool) {
        NSApp.setActivationPolicy(hidden ? .accessory : .regular)
        if !hidden {
            NSApp.activate()
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // 菜单栏常驻图标：Dock 图标默认隐藏后的主要找回入口
        StatusBarController.shared.setup()

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
        self.window = window

        // 恢复窗口 frame：按当前所在屏的 displayID 查存档；
        // 该屏无存档时迁移旧的单档 windowFrame（存到其所在屏 key 下），
        // 再不行回退居中；始终保留 80×40 可见性校验
        restoreWindowFrame(on: window)

        // 显示器插拔/切换时：按新所在屏的存档恢复（无存档则保持现状不乱跳）
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenParametersChanged),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )

        // 注册到窗口控制器，供 SwiftUI 侧操作（置顶/关闭/重开）
        WindowController.shared.attach(window)

        // 启动即按持久化的置顶设置校正窗口层级：
        // FloatingWindow 默认 .floating，此前仅靠 ContentView.onAppear 校正，
        // 时机不可控（onAppear 依赖视图可见性，可能晚于窗口显示甚至不触发），
        // 导致设置面板里已关闭置顶、但每次启动窗口仍浮顶，需手动开关一次才恢复。
        // 这里在窗口显示前直接读 UserDefaults 应用，与 onAppear/onChange 的
        // 后续重复调用幂等兼容；非置顶时沉到桌面图标层级 +1（台前调度不收编）。
        let floatingOnTop = UserDefaults.standard.object(forKey: "floatingOnTop") as? Bool ?? true
        WindowController.shared.applyLevel(floatingOnTop: floatingOnTop)

        // 启动即按持久化的锁定设置禁用拖动/缩放：
        // 与置顶同理，ContentView.onAppear 的 setLocked 时机不可控（实测启动后
        // onAppear 可能迟迟不触发，窗口在已解锁状态下暴露数秒甚至更久），
        // 在窗口显示前直接读 UserDefaults 应用；与 onAppear/onChange 的
        // 后续重复调用幂等兼容。
        let positionLocked = UserDefaults.standard.bool(forKey: "positionLocked")
        WindowController.shared.setLocked(positionLocked)

        // 启动即按持久化值应用 Dock 图标可见性（缺省 true = 隐藏，
        // 新用户首次启动也不占 Dock 位），在窗口显示前设置好 activationPolicy
        let hideDockIcon = UserDefaults.standard.object(forKey: "hideDockIcon") as? Bool ?? true
        Self.applyDockVisibility(hidden: hideDockIcon)

        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// 点击关闭按钮：隐藏窗口而不是退出 App
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    // MARK: - 窗口 frame 记忆

    /// 每屏存档字典 key：displayFrames: [displayID: NSStringFromRect]
    /// displayID 取 NSScreen.deviceDescription["NSScreenNumber"]
    /// （CGDirectDisplayID，跨重启稳定）
    private static let displayFramesKey = "displayFrames"
    /// 旧的单档 key（d3fbb63），启动时迁移后删除
    private static let legacyWindowFrameKey = "windowFrame"

    /// 窗口弱引用（屏幕参数变化时恢复用）
    private weak var window: NSWindow?

    /// 节流保存任务：拖动/缩放中频繁触发 delegate，frame 稳定 0.5s 后才落盘
    private var frameSaveWorkItem: DispatchWorkItem?

    /// 屏幕参数变化防抖任务（插拔瞬间系统可能连发多次通知）
    private var screenChangeWorkItem: DispatchWorkItem?

    /// 屏幕的跨重启稳定 ID（CGDirectDisplayID 字符串化）
    private static func displayID(for screen: NSScreen) -> String? {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.stringValue
    }

    /// 读取全部显示器存档
    private static func savedFrames() -> [String: String] {
        UserDefaults.standard.dictionary(forKey: Self.displayFramesKey) as? [String: String] ?? [:]
    }

    /// 节流保存窗口 frame 到"窗口当前所在屏"的 key 下
    private func scheduleFrameSave(_ window: NSWindow) {
        frameSaveWorkItem?.cancel()
        let item = DispatchWorkItem { [weak window] in
            guard let window,
                  let screen = window.screen ?? NSScreen.main,
                  let id = Self.displayID(for: screen) else { return }
            var frames = Self.savedFrames()
            frames[id] = NSStringFromRect(window.frame)
            UserDefaults.standard.set(frames, forKey: Self.displayFramesKey)
        }
        frameSaveWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: item)
    }

    /// 恢复窗口 frame（启动 / 屏幕参数变化共用）：
    /// - 优先按窗口所在屏的 displayID 查存档；
    /// - 该屏无存档且存在旧单档时迁移：旧档写到"其 frame 所在屏"的 key 下，
    ///   若旧档就在当前屏则同时恢复；
    /// - 屏幕参数变化场景下该屏无存档时保持现状（centerAtLaunch 为 false 不乱跳）；
    /// - 启动场景下最后回退居中
    private func restoreWindowFrame(on window: NSWindow, centerAtLaunch: Bool = true) {
        guard let screen = window.screen ?? NSScreen.main,
              let id = Self.displayID(for: screen) else {
            if centerAtLaunch { window.center() }
            return
        }

        let frames = Self.savedFrames()
        if let saved = frames[id] {
            let rect = NSRectFromString(saved)
            if Self.isFrameVisible(rect) {
                window.setFrame(rect, display: false)
                return
            }
        }

        // 旧单档迁移（只执行一次：迁移后删除旧 key）
        if let legacy = UserDefaults.standard.string(forKey: Self.legacyWindowFrameKey) {
            let rect = NSRectFromString(legacy)
            UserDefaults.standard.removeObject(forKey: Self.legacyWindowFrameKey)
            if Self.isFrameVisible(rect) {
                // 存到旧 frame 实际所在屏的 key 下
                var frames = Self.savedFrames()
                let legacyScreen = Self.screenContaining(rect) ?? screen
                let legacyID = Self.displayID(for: legacyScreen)
                if let legacyID {
                    frames[legacyID] = legacy
                    UserDefaults.standard.set(frames, forKey: Self.displayFramesKey)
                }
                if legacyID == id {
                    window.setFrame(rect, display: false)
                    return
                }
            }
        }

        if centerAtLaunch {
            window.center()
        }
    }

    /// 与 rect 交集面积最大的屏幕（判断存档 frame 属于哪台显示器）
    private static func screenContaining(_ rect: NSRect) -> NSScreen? {
        var best: NSScreen?
        var bestArea: CGFloat = 0
        for screen in NSScreen.screens {
            let intersection = rect.intersection(screen.visibleFrame)
            let area = intersection.isNull ? 0 : intersection.width * intersection.height
            if area > bestArea {
                bestArea = area
                best = screen
            }
        }
        return best
    }

    /// 显示器插拔/切换：防抖后按新所在屏的存档恢复；无存档保持现状
    @objc private func screenParametersChanged() {
        screenChangeWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self, weak window] in
            guard let self, let window else { return }
            self.restoreWindowFrame(on: window, centerAtLaunch: false)
        }
        screenChangeWorkItem = item
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
