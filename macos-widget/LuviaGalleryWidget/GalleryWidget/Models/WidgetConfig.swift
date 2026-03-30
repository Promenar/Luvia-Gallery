import Foundation

// MARK: - WidgetConfig
// 存储在 App Groups 中的配置数据

struct WidgetConfig: Codable, Equatable {
    let serverUrl: String
    let token: String
    let mode: DisplayMode
    let folderPath: String
    let showVideos: Bool
    let refreshInterval: Int      // 分钟
    
    // MARK: - DisplayMode
    
    enum DisplayMode: String, Codable, CaseIterable {
        case random
        case favorites
        case folder
        
        var displayName: String {
            switch self {
            case .random: return "Random"
            case .favorites: return "Favorites"
            case .folder: return "Folder"
            }
        }
    }
    
    // MARK: - Default
    
    static var `default`: WidgetConfig {
        WidgetConfig(
            serverUrl: "",
            token: "",
            mode: .random,
            folderPath: "",
            showVideos: false,
            refreshInterval: 30
        )
    }
    
    // MARK: - Validation
    
    var isValid: Bool {
        !serverUrl.isEmpty && !token.isEmpty
    }
    
    var sanitizedServerUrl: String {
        serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
}
