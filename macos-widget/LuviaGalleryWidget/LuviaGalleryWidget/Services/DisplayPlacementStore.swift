import Foundation
import CoreGraphics

/// 与某台显示器的可见工作区绑定的窗口位置。
///
/// 坐标只保存为 visibleFrame 内可恢复的相对比例；窗口尺寸仍以点为单位保存，
/// 以避免在不同分辨率下意外改变用户手动选择的尺寸。
struct DisplayPlacement: Codable, Equatable {
    static let currentSchemaVersion = 2

    let schemaVersion: Int
    let xRatio: CGFloat
    let topRatio: CGFloat
    let width: CGFloat
    let height: CGFloat

    init(xRatio: CGFloat, topRatio: CGFloat, width: CGFloat, height: CGFloat) {
        self.schemaVersion = Self.currentSchemaVersion
        self.xRatio = Self.normalizedRatio(xRatio)
        self.topRatio = Self.normalizedRatio(topRatio)
        self.width = Self.normalizedLength(width)
        self.height = Self.normalizedLength(height)
    }

    init(globalFrame: CGRect, visibleFrame: CGRect) {
        let safeWidth = Self.normalizedLength(globalFrame.width)
        let safeHeight = Self.normalizedLength(globalFrame.height)
        let horizontalRange = max(visibleFrame.width - safeWidth, 0)
        let verticalRange = max(visibleFrame.height - safeHeight, 0)

        self.init(
            xRatio: horizontalRange > 0 ? (globalFrame.minX - visibleFrame.minX) / horizontalRange : 0,
            topRatio: verticalRange > 0 ? (visibleFrame.maxY - globalFrame.maxY) / verticalRange : 0,
            width: safeWidth,
            height: safeHeight
        )
    }

    func restoredFrame(in visibleFrame: CGRect) -> CGRect? {
        guard Self.isValidVisibleFrame(visibleFrame) else { return nil }
        let safeVisibleWidth = visibleFrame.width
        let safeVisibleHeight = visibleFrame.height
        let restoredWidth = min(width, safeVisibleWidth)
        let restoredHeight = min(height, safeVisibleHeight)
        let x = visibleFrame.minX + (safeVisibleWidth - restoredWidth) * xRatio
        let y = visibleFrame.maxY - (safeVisibleHeight - restoredHeight) * topRatio - restoredHeight
        return CGRect(x: x, y: y, width: restoredWidth, height: restoredHeight)
    }

    static func isValidVisibleFrame(_ visibleFrame: CGRect) -> Bool {
        visibleFrame.origin.x.isFinite
            && visibleFrame.origin.y.isFinite
            && visibleFrame.width.isFinite
            && visibleFrame.height.isFinite
            && visibleFrame.width > 0
            && visibleFrame.height > 0
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case xRatio
        case topRatio
        case width
        case height
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let schemaVersion = try values.decode(Int.self, forKey: .schemaVersion)
        guard schemaVersion == Self.currentSchemaVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .schemaVersion,
                in: values,
                debugDescription: "不支持的位置存档版本"
            )
        }
        self.init(
            xRatio: try values.decode(CGFloat.self, forKey: .xRatio),
            topRatio: try values.decode(CGFloat.self, forKey: .topRatio),
            width: try values.decode(CGFloat.self, forKey: .width),
            height: try values.decode(CGFloat.self, forKey: .height)
        )
    }

    private static func normalizedRatio(_ value: CGFloat) -> CGFloat {
        guard value.isFinite else { return 0 }
        return min(max(value, 0), 1)
    }

    private static func normalizedLength(_ value: CGFloat) -> CGFloat {
        guard value.isFinite, value > 0 else { return 1 }
        return value
    }

}

/// 只由物理属性派生的显示器身份；不包含会话临时 display ID。
struct DisplayPhysicalIdentity: Equatable {
    let isBuiltIn: Bool
    let vendorID: UInt32
    let modelID: UInt32
    let serialNumber: UInt32
    let localizedName: String
    let physicalSizeMillimeters: CGSize

    var fingerprint: String {
        let base = "vendor:\(vendorID)|model:\(modelID)"
        if isBuiltIn {
            return "display-v2|builtin|\(base)"
        }
        if serialNumber != 0 {
            return "display-v2|external|\(base)|serial:\(serialNumber)"
        }
        return "display-v2|external|\(base)|name:\(normalizedName)|size:\(normalizedSize)"
    }

    /// 信息不足时宁可只使用进程内 session 键，也不能生成会污染持久化的退化指纹。
    var isPersistable: Bool {
        guard vendorID != 0 && modelID != 0 else { return false }
        if isBuiltIn || serialNumber != 0 { return true }
        return !normalizedName.isEmpty && hasValidPhysicalSize
    }

    private var normalizedName: String {
        localizedName
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
    }

    private var normalizedSize: String {
        "\(normalizedMillimeters(physicalSizeMillimeters.width))x\(normalizedMillimeters(physicalSizeMillimeters.height))"
    }

    private var hasValidPhysicalSize: Bool {
        physicalSizeMillimeters.width.isFinite
            && physicalSizeMillimeters.height.isFinite
            && physicalSizeMillimeters.width > 0
            && physicalSizeMillimeters.height > 0
    }

    private func normalizedMillimeters(_ value: CGFloat) -> Int {
        guard value.isFinite, value > 0 else { return 0 }
        return Int((value * 10).rounded())
    }
}

/// 持久指纹冲突时，session 键仅在进程内有效，不能写入 UserDefaults。
enum DisplayPlacementKey: Equatable {
    case persistent(String)
    case session(String)

    var rawValue: String {
        switch self {
        case let .persistent(value), let .session(value): value
        }
    }

    var isPersistent: Bool {
        if case .persistent = self { return true }
        return false
    }
}

/// 对当前连接集合做冲突检测。connectionID 只用来复用同一次启动的随机 session 键。
struct DisplayPlacementKeyResolver {
    private var sessionKeysByConnectionID: [String: String] = [:]
    private let sessionKeyFactory: () -> String

    init(sessionKeyFactory: @escaping () -> String = { UUID().uuidString }) {
        self.sessionKeyFactory = sessionKeyFactory
    }

    mutating func resolve(
        identity: DisplayPhysicalIdentity,
        connectionID: String,
        connectedFingerprints: [String]
    ) -> DisplayPlacementKey {
        let fingerprint = identity.fingerprint
        guard identity.isPersistable,
              connectedFingerprints.filter({ $0 == fingerprint }).count <= 1
        else {
            let sessionKey = sessionKeysByConnectionID[connectionID] ?? sessionKeyFactory()
            sessionKeysByConnectionID[connectionID] = sessionKey
            return .session(sessionKey)
        }
        return .persistent(fingerprint)
    }
}

/// 只以 Resolver 的最终存储键判断系统主屏是否改变；同一物理指纹的两个 session 键必须可区分。
struct SystemPrimaryDisplayState {
    private(set) var lastSystemPrimaryDisplayKey: DisplayPlacementKey?

    mutating func shouldRestore(for key: DisplayPlacementKey) -> Bool {
        guard key != lastSystemPrimaryDisplayKey else { return false }
        lastSystemPrimaryDisplayKey = key
        return true
    }
}

/// 仅负责 V2 存档和进程内 session 存档；AppKit 身份与主屏状态留在 AppDelegate。
final class DisplayPlacementStore {
    static let storageKey = "displayPlacementsV2"

    private let defaults: UserDefaults
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var sessionEntries: [String: DisplayPlacement] = [:]

    init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    func placement(for displayKey: String) -> DisplayPlacement? {
        guard !displayKey.isEmpty,
              let data = storedEntries()[displayKey]
        else { return nil }
        return try? decoder.decode(DisplayPlacement.self, from: data)
    }

    func placement(for key: DisplayPlacementKey) -> DisplayPlacement? {
        switch key {
        case let .persistent(value): placement(for: value)
        case let .session(value): sessionEntries[value]
        }
    }

    func save(_ placement: DisplayPlacement, for displayKey: String) {
        guard !displayKey.isEmpty,
              let data = try? encoder.encode(placement)
        else { return }
        var entries = storedEntries()
        entries[displayKey] = data
        defaults.set(entries, forKey: Self.storageKey)
    }

    func save(_ placement: DisplayPlacement, for key: DisplayPlacementKey) {
        switch key {
        case let .persistent(value): save(placement, for: value)
        case let .session(value): sessionEntries[value] = placement
        }
    }

    private func storedEntries() -> [String: Data] {
        defaults.dictionary(forKey: Self.storageKey) as? [String: Data] ?? [:]
    }
}
