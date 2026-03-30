//
//  AppIntent.swift
//  GalleryWidget
//
//  Widget Configuration Intent
//

import WidgetKit
import AppIntents

// MARK: - DisplayModeEnum
// 显示模式枚举

enum DisplayModeEnum: String, AppEnum, CaseIterable {
    case random = "random"
    case favorites = "favorites"
    case folder = "folder"
    
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Display Mode")
    
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .random: "Random Photos",
        .favorites: "My Favorites",
        .folder: "Specific Folder"
    ]
}

// MARK: - RefreshIntervalEnum
// 刷新间隔枚举

enum RefreshIntervalEnum: String, AppEnum, CaseIterable {
    case fifteenMinutes = "15"
    case thirtyMinutes = "30"
    case oneHour = "60"
    
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Refresh Interval")
    
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
        .fifteenMinutes: "Every 15 Minutes",
        .thirtyMinutes: "Every 30 Minutes",
        .oneHour: "Every Hour"
    ]
    
    var minutes: Int {
        switch self {
        case .fifteenMinutes: return 15
        case .thirtyMinutes: return 30
        case .oneHour: return 60
        }
    }
}

// MARK: - GalleryWidgetConfigurationIntent
// Widget 配置 Intent (必须遵循 WidgetConfigurationIntent)

struct GalleryWidgetConfigurationIntent: WidgetConfigurationIntent {
    
    // MARK: - Static Properties
    
    static var title: LocalizedStringResource = "Gallery Settings"
    static var description: IntentDescription = "Configure which photos to display and how often to refresh the widget."
    
    // MARK: - Parameters
    
    @Parameter(title: "Display Mode", default: .random)
    var mode: DisplayModeEnum?
    
    @Parameter(title: "Refresh Interval", default: .thirtyMinutes)
    var refreshInterval: RefreshIntervalEnum?
    
    @Parameter(title: "Include Videos", default: false)
    var includeVideos: Bool?
    
    // MARK: - Parameter Summary
    
    static var parameterSummary: some ParameterSummary {
        Summary {
            \.$mode
            \.$refreshInterval
            \.$includeVideos
        }
    }
    
    // MARK: - Perform
    
    func perform() async throws -> some IntentResult {
        return .result()
    }
}
