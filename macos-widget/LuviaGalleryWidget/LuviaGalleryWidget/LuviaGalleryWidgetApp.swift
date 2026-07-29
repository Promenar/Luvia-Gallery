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
import CoreGraphics

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

        // 启动总以系统主屏为目标；无位置档案时居中并建立初始 V2 存档。
        restoreInitialWindowFrame(on: window)

        // 显示器插拔/切换时：按新所在屏的存档恢复（无存档则保持现状不乱跳）
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(screenParametersChanged),
            name: NSApplication.didChangeScreenParametersNotification,
            object: nil
        )

        // 注册到窗口控制器，供 SwiftUI 侧操作（置顶/关闭/重开）
        WindowController.shared.attach(window) { [weak self] window in
            self?.prepareForWindowOrderOut(window)
        }

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

        // 启动即按持久化值应用点击穿透开关（缺省 false）；
        // 启动时设置面板必然收起，开关为开则穿透直接生效
        let clickThrough = UserDefaults.standard.bool(forKey: "clickThrough")
        WindowController.shared.setClickThroughSwitch(clickThrough)

        window.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    /// 点击关闭按钮：隐藏窗口而不是退出 App
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        WindowController.shared.closeWindow()
        return false
    }

    // MARK: - 窗口 frame 记忆

    /// 窗口弱引用（屏幕参数变化时恢复用）
    private weak var window: NSWindow?

    /// V2 存档通过注入的 defaults 访问，测试可使用独立 suite 隔离每屏数据。
    private let placementStore = DisplayPlacementStore(defaults: .standard)

    /// 物理指纹冲突时生成仅进程内有效的 session 键。
    private var placementKeyResolver = DisplayPlacementKeyResolver()

    /// 上次已处理的系统主屏 Resolver 键；同 fingerprint 的不同 session 键也必须区分。
    private var systemPrimaryDisplayState = SystemPrimaryDisplayState()

    /// 最近一次已确认稳定的保存值及其屏幕快照，用于新主屏没有档案时投射恢复。
    private struct StablePlacementSnapshot {
        let placement: DisplayPlacement
        let visibleFrame: NSRect
    }
    private var lastStableSnapshot: StablePlacementSnapshot?

    /// 系统主屏恢复期间，窗口移动/缩放回调不得保存或触发网格吸附。
    private var isRestoringDisplayPlacement = false

    /// 节流保存任务：拖动/缩放中频繁触发 delegate，frame 稳定 0.5s 后才落盘
    private var frameSaveWorkItem: DispatchWorkItem?

    /// 屏幕参数变化防抖任务（插拔瞬间系统可能连发多次通知）
    private var screenChangeWorkItem: DispatchWorkItem?

    /// 系统主屏按 AppKit 的屏幕数组首项定义；不能以窗口所在屏 API 替代。
    private static func systemPrimaryScreen() -> NSScreen? {
        NSScreen.screens.first
    }

    /// NSScreenNumber 只作为当前连接的会话标识；不参与持久化物理指纹。
    private static func transientDisplayID(for screen: NSScreen) -> CGDirectDisplayID? {
        guard let number = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {
            return nil
        }
        return CGDirectDisplayID(number.uint32Value)
    }

    /// 从 CG 物理属性与 AppKit 名称构造稳定指纹，刻意不读取 CG UUID。
    private static func physicalIdentity(for screen: NSScreen) -> (identity: DisplayPhysicalIdentity, connectionID: String)? {
        guard let displayID = transientDisplayID(for: screen) else { return nil }
        return (
            DisplayPhysicalIdentity(
                isBuiltIn: CGDisplayIsBuiltin(displayID) != 0,
                vendorID: CGDisplayVendorNumber(displayID),
                modelID: CGDisplayModelNumber(displayID),
                serialNumber: CGDisplaySerialNumber(displayID),
                localizedName: screen.localizedName,
                physicalSizeMillimeters: CGDisplayScreenSize(displayID)
            ),
            String(displayID)
        )
    }

    private func displayKey(for screen: NSScreen) -> DisplayPlacementKey? {
        guard let candidate = Self.physicalIdentity(for: screen) else { return nil }
        let connectedFingerprints = NSScreen.screens.compactMap { Self.physicalIdentity(for: $0)?.identity.fingerprint }
        return placementKeyResolver.resolve(
            identity: candidate.identity,
            connectionID: candidate.connectionID,
            connectedFingerprints: connectedFingerprints
        )
    }

    private func cancelDeferredWindowWork() {
        frameSaveWorkItem?.cancel()
        frameSaveWorkItem = nil
        snapWorkItem?.cancel()
        snapWorkItem = nil
    }

    private struct ScheduledPlacementSave {
        let frame: NSRect
        let visibleFrame: NSRect
        let key: DisplayPlacementKey
    }

    private func capturePlacementSave(
        _ window: NSWindow,
        on screen: NSScreen? = nil,
        allowPrimaryFallback: Bool = true
    ) -> ScheduledPlacementSave? {
        let fallbackScreen = allowPrimaryFallback ? Self.systemPrimaryScreen() : nil
        guard let targetScreen = screen ?? window.screen ?? fallbackScreen,
              DisplayPlacement.isValidVisibleFrame(targetScreen.visibleFrame),
              let displayKey = displayKey(for: targetScreen)
        else { return nil }
        let frame = window.frame
        return ScheduledPlacementSave(
            frame: frame,
            visibleFrame: targetScreen.visibleFrame,
            key: displayKey
        )
    }

    private func commitPlacementSave(_ snapshot: ScheduledPlacementSave) {
        let placement = DisplayPlacement(globalFrame: snapshot.frame, visibleFrame: snapshot.visibleFrame)
        placementStore.save(placement, for: snapshot.key)
        lastStableSnapshot = StablePlacementSnapshot(placement: placement, visibleFrame: snapshot.visibleFrame)
    }

    private func saveFrame(_ window: NSWindow, on screen: NSScreen? = nil, allowPrimaryFallback: Bool = true) {
        guard !isRestoringDisplayPlacement,
              let snapshot = capturePlacementSave(window, on: screen, allowPrimaryFallback: allowPrimaryFallback)
        else { return }
        commitPlacementSave(snapshot)
    }

    /// 所有隐藏入口都在 orderOut 前经过这里：取消延迟任务后，仅在稳定状态保存当前屏快照。
    private func prepareForWindowOrderOut(_ window: NSWindow) {
        cancelDeferredWindowWork()
        guard !isRestoringDisplayPlacement else { return }
        saveFrame(window, allowPrimaryFallback: false)
    }

    /// 节流保存窗口 frame 到调度瞬间捕获的 V2 物理键或 session 键下。
    private func scheduleFrameSave(_ window: NSWindow) {
        guard !isRestoringDisplayPlacement,
              let snapshot = capturePlacementSave(window)
        else { return }
        frameSaveWorkItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            guard let self, !self.isRestoringDisplayPlacement else { return }
            self.commitPlacementSave(snapshot)
        }
        frameSaveWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: item)
    }

    private func centeredFrame(for window: NSWindow, in visibleFrame: NSRect) -> NSRect? {
        guard DisplayPlacement.isValidVisibleFrame(visibleFrame) else { return nil }
        let width = min(max(window.frame.width, 1), visibleFrame.width)
        let height = min(max(window.frame.height, 1), visibleFrame.height)
        return NSRect(
            x: visibleFrame.midX - width / 2,
            y: visibleFrame.midY - height / 2,
            width: width,
            height: height
        )
    }

    /// 启动和主屏切换共用恢复入口。V1 数字键不可靠，完全 fail-closed，不参与迁移。
    private func restoreWindowFrame(
        on window: NSWindow,
        targetScreen: NSScreen,
        displayKey: DisplayPlacementKey,
        centerIfMissing: Bool
    ) {
        guard DisplayPlacement.isValidVisibleFrame(targetScreen.visibleFrame) else {
            isRestoringDisplayPlacement = false
            return
        }
        isRestoringDisplayPlacement = true

        let projectedStablePlacement = lastStableSnapshot.flatMap {
            DisplayPlacement.isValidVisibleFrame($0.visibleFrame) ? $0.placement : nil
        }
        let placement = placementStore.placement(for: displayKey) ?? projectedStablePlacement

        let restoredFrame: NSRect?
        if let placement, let restored = placement.restoredFrame(in: targetScreen.visibleFrame) {
            restoredFrame = restored
        } else if centerIfMissing {
            restoredFrame = centeredFrame(for: window, in: targetScreen.visibleFrame)
        } else {
            restoredFrame = nil
        }

        guard let restoredFrame else {
            isRestoringDisplayPlacement = false
            return
        }
        window.setFrame(restoredFrame, display: false)
        let stablePlacement = DisplayPlacement(globalFrame: restoredFrame, visibleFrame: targetScreen.visibleFrame)
        placementStore.save(stablePlacement, for: displayKey)
        lastStableSnapshot = StablePlacementSnapshot(placement: stablePlacement, visibleFrame: targetScreen.visibleFrame)
        isRestoringDisplayPlacement = false
    }

    private func restoreInitialWindowFrame(on window: NSWindow) {
        guard let primaryScreen = Self.systemPrimaryScreen(),
              let key = displayKey(for: primaryScreen)
        else {
            window.center()
            return
        }
        _ = systemPrimaryDisplayState.shouldRestore(for: key)
        restoreWindowFrame(
            on: window,
            targetScreen: primaryScreen,
            displayKey: key,
            centerIfMissing: true
        )
    }

    /// 参数通知只有在系统主屏物理键改变时才恢复，避免副屏窗口被无关通知拉回主屏。
    @objc private func screenParametersChanged() {
        cancelDeferredWindowWork()
        screenChangeWorkItem?.cancel()
        isRestoringDisplayPlacement = true
        let item = DispatchWorkItem { [weak self, weak window] in
            guard let self else { return }
            guard let window else {
                self.isRestoringDisplayPlacement = false
                return
            }
            guard let primaryScreen = Self.systemPrimaryScreen(),
                  let key = self.displayKey(for: primaryScreen)
            else {
                self.isRestoringDisplayPlacement = false
                return
            }
            guard self.systemPrimaryDisplayState.shouldRestore(for: key) else {
                self.isRestoringDisplayPlacement = false
                return
            }
            self.restoreWindowFrame(
                on: window,
                targetScreen: primaryScreen,
                displayKey: key,
                centerIfMissing: false
            )
        }
        screenChangeWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5, execute: item)
    }

    func windowDidResize(_ notification: Notification) {
        guard !isRestoringDisplayPlacement,
              let window = notification.object as? NSWindow
        else { return }
        scheduleFrameSave(window)
    }

    /// 用户手动跨屏时只保存窗口当前屏，不对系统主屏执行自动跳回。
    func windowDidChangeScreen(_ notification: Notification) {
        guard !isRestoringDisplayPlacement,
              let window = notification.object as? NSWindow
        else { return }
        saveFrame(window)
    }

    // MARK: - 桌面网格吸附

    /// 防抖任务：拖动中 windowDidMove 频繁触发，frame 稳定 0.2s 后才吸附
    private var snapWorkItem: DispatchWorkItem?

    func windowDidMove(_ notification: Notification) {
        guard !isRestoringDisplayPlacement,
              let window = notification.object as? NSWindow
        else { return }
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
        let item = DispatchWorkItem { [weak self, weak window] in
            guard let self, !self.isRestoringDisplayPlacement,
                  let window, !window.inLiveResize else { return }
            guard let screen = window.screen ?? Self.systemPrimaryScreen(),
                  let target = DesktopGrid.shared.snappedFrame(for: window.frame, in: screen)
            else { return }
            // 0.2s 动画滑到最近网格点
            window.setFrame(target, display: true, animate: true)
        }
        snapWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: item)
    }

    func applicationWillTerminate(_ notification: Notification) {
        cancelDeferredWindowWork()
        screenChangeWorkItem?.cancel()
        screenChangeWorkItem = nil
        if !isRestoringDisplayPlacement, let window {
            saveFrame(window, allowPrimaryFallback: window.isVisible)
        }
    }

    /// 点击 Dock 图标：重新显示悬浮窗
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            WindowController.shared.showWindow()
        }
        return false
    }
}
