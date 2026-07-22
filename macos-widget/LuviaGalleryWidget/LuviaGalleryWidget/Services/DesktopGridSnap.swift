//
//  DesktopGridSnap.swift
//  LuviaGalleryWidget
//
//  桌面图标网格参数读取与窗口位置吸附计算。
//

import AppKit

// MARK: - DesktopGrid

/// 读取 Finder 的真实桌面网格（com.apple.finder → DesktopViewSettings → IconViewSettings）
/// 并计算窗口松手后应吸附到的最近网格位置。
///
/// 近似与限制：
/// - 网格 cell 尺寸按 iconSize + gridSpacing 估算，Finder 实际网格算法未公开，存在误差；
/// - 无法读取 WidgetKit 小组件的真实网格，只能对齐 Finder 图标网格；
/// - 边距按 gridSpacing 近似（Finder 实际内边距未公开）。
final class DesktopGrid {

    static let shared = DesktopGrid()

    /// 网格 cell 边长（iconSize + gridSpacing 的近似值）
    let cell: CGFloat
    /// 网格起点距屏幕 visibleFrame 边缘的近似边距
    let margin: CGFloat
    /// 网格参数来源（诊断用）
    let source: String

    private init() {
        var iconSize: CGFloat = 64
        var gridSpacing: CGFloat = 22
        var source = "默认值（iconSize 64 + gridSpacing 22）"

        // 途径一：直接读 com.apple.finder 偏好（沙盒下通常读不到）
        if let iconSettings = Self.iconSettingsFromUserDefaults() {
            if let v = Self.doubleValue(iconSettings["iconSize"]) { iconSize = v }
            if let v = Self.doubleValue(iconSettings["gridSpacing"]) { gridSpacing = v }
            source = "UserDefaults(com.apple.finder)"
        // 途径二：fallback 跑 /usr/bin/defaults 命令（沙盒会拦截 Process，失败则落到默认值）
        } else if let iconSettings = Self.iconSettingsFromDefaultsCommand() {
            if let v = Self.doubleValue(iconSettings["iconSize"]) { iconSize = v }
            if let v = Self.doubleValue(iconSettings["gridSpacing"]) { gridSpacing = v }
            source = "Process(/usr/bin/defaults)"
        }

        self.cell = iconSize + gridSpacing
        self.margin = gridSpacing
        self.source = source
        print("[DesktopGrid] 网格参数来源: \(source)，cell ≈ \(iconSize + gridSpacing)")
    }

    // MARK: - 吸附计算

    /// 计算窗口吸附后的 frame；已在网格点上（偏差 < 1px）时返回 nil
    /// - 网格原点：屏幕 visibleFrame 左上角（菜单栏下方）向内 margin
    /// - 以窗口左上角对齐网格交点，与桌面图标视觉一致
    func snappedFrame(for frame: NSRect, in screen: NSScreen) -> NSRect? {
        let visible = screen.visibleFrame
        let originX = visible.minX + margin
        let originTopY = visible.maxY - margin

        // AppKit 屏幕坐标 y 向上，窗口"顶边"是 frame.maxY
        let snappedX = originX + ((frame.minX - originX) / cell).rounded() * cell
        let snappedTopY = originTopY - ((originTopY - frame.maxY) / cell).rounded() * cell
        let newOrigin = NSPoint(x: snappedX, y: snappedTopY - frame.height)

        // 已在目标位置则不吸附（也避免 setFrame 递归触发 windowDidMove）
        guard abs(newOrigin.x - frame.minX) > 1 || abs(newOrigin.y - frame.minY) > 1 else {
            return nil
        }
        return NSRect(origin: newOrigin, size: frame.size)
    }

    // MARK: - 读取途径一：UserDefaults

    private static func iconSettingsFromUserDefaults() -> [String: Any]? {
        guard let dict = UserDefaults(suiteName: "com.apple.finder")?
            .dictionary(forKey: "DesktopViewSettings"),
            let iconSettings = dict["IconViewSettings"] as? [String: Any]
        else { return nil }
        return iconSettings
    }

    // MARK: - 读取途径二：/usr/bin/defaults 命令输出解析

    private static func iconSettingsFromDefaultsCommand() -> [String: Any]? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/defaults")
        process.arguments = ["read", "com.apple.finder", "DesktopViewSettings"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
        } catch {
            print("[DesktopGrid] defaults 命令启动失败（沙盒限制属预期）: \(error.localizedDescription)")
            return nil
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        guard process.terminationStatus == 0,
              let text = String(data: data, encoding: .utf8)
        else { return nil }

        // 输出是 OpenStep 格式 plist 文本，正则提取 IconViewSettings 区块中的数值
        var result: [String: Any] = [:]
        if let range = text.range(of: "IconViewSettings") {
            let tail = String(text[range.lowerBound...])
            for key in ["iconSize", "gridSpacing"] {
                if let match = tail.range(of: "\(key) = ([0-9.]+);", options: .regularExpression) {
                    let line = String(tail[match])
                    if let numRange = line.range(of: "[0-9.]+", options: .regularExpression, range: line.index(line.startIndex, offsetBy: key.count)..<line.endIndex),
                       let value = Double(line[numRange]) {
                        result[key] = value
                    }
                }
            }
        }
        return result.isEmpty ? nil : result
    }

    /// plist 数值可能是 NSNumber / Int / Double，统一转 CGFloat
    private static func doubleValue(_ value: Any?) -> CGFloat? {
        if let number = value as? NSNumber { return CGFloat(truncating: number) }
        if let double = value as? Double { return CGFloat(double) }
        if let int = value as? Int { return CGFloat(int) }
        return nil
    }
}
