//
//  LoginItemManager.swift
//  LuviaGalleryWidget
//
//  开机自动启动管理（SMAppService.mainApp，macOS 13+）。
//  沙盒 App 可直接使用，无需额外 entitlement。
//

import Foundation
import ServiceManagement

// MARK: - LoginItemManager

/// 封装登录项注册/注销与状态查询。
/// 工程 deployment target 为 macOS 26.4，无需 #available 保护。
enum LoginItemManager {

    /// 系统侧真实状态（以此为准回显 UI）
    static var isEnabled: Bool {
        SMAppService.mainApp.status == .enabled
    }

    /// 注册/注销登录项
    /// - Returns: 失败时返回错误，成功返回 nil
    @discardableResult
    static func setEnabled(_ enabled: Bool) -> Error? {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            print("[LoginItemManager] 开机启动已\(enabled ? "开启" : "关闭")")
            return nil
        } catch {
            print("[LoginItemManager] 设置失败: \(error.localizedDescription)")
            return error
        }
    }
}
