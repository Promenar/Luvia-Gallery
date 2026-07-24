//
//  StatusBarController.swift
//  LuviaGalleryWidget
//
//  菜单栏常驻图标（NSStatusItem）。
//  背景：Dock 图标默认隐藏（63ca2df）后，窗口被关闭时用户缺少
//  找回入口；菜单栏图标作为兜底入口常驻，不随 Dock 开关变化。
//  accessory 模式下 NSStatusItem 正常工作。
//

import AppKit

// MARK: - 通知

extension Notification.Name {
    /// 请求展开设置面板（ContentView 监听）
    static let luviaShowSettings = Notification.Name("luviaShowSettings")
}

// MARK: - StatusBarController

@MainActor
final class StatusBarController: NSObject {

    static let shared = StatusBarController()

    private var statusItem: NSStatusItem?

    private override init() {
        super.init()
    }

    /// 创建菜单栏图标与菜单（幂等，启动时调用一次）
    func setup() {
        guard statusItem == nil else { return }
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            button.image = NSImage(
                systemSymbolName: "photo.on.rectangle",
                accessibilityDescription: "相册轮播"
            )
        }

        let menu = NSMenu()
        menu.delegate = self

        let toggleItem = NSMenuItem(
            title: "显示/隐藏悬浮窗",
            action: #selector(toggleWindow),
            keyEquivalent: ""
        )
        toggleItem.target = self
        menu.addItem(toggleItem)

        let settingsItem = NSMenuItem(
            title: "打开设置",
            action: #selector(openSettings),
            keyEquivalent: ""
        )
        settingsItem.target = self
        menu.addItem(settingsItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(
            title: "退出",
            action: #selector(quitApp),
            keyEquivalent: "q"
        )
        quitItem.target = self
        menu.addItem(quitItem)

        item.menu = menu
        statusItem = item
    }

    // MARK: - 菜单动作

    @objc private func toggleWindow() {
        MainActor.assumeIsolated {
            WindowController.shared.toggleVisibility()
        }
    }

    @objc private func openSettings() {
        MainActor.assumeIsolated {
            WindowController.shared.showWindow()
            NotificationCenter.default.post(name: .luviaShowSettings, object: nil)
        }
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }
}

// MARK: - NSMenuDelegate（动态标题：随窗口可见性切换）

extension StatusBarController: NSMenuDelegate {
    nonisolated func menuNeedsUpdate(_ menu: NSMenu) {
        MainActor.assumeIsolated {
            let visible = WindowController.shared.isWindowVisible
            menu.item(at: 0)?.title = visible ? "隐藏悬浮窗" : "显示悬浮窗"
        }
    }
}
