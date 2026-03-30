import WidgetKit

// MARK: - GalleryEntry
// Timeline Entry 数据模型

struct GalleryEntry: TimelineEntry {
    let date: Date
    let images: [MediaFile]
    let configurationState: ConfigurationState
    
    // MARK: - ConfigurationState
    
    enum ConfigurationState {
        case configured       // 已配置，数据正常
        case notConfigured    // 未配置 Token/Server
        case networkError     // 网络错误
        case emptyLibrary     // 图库为空
    }
    
    // MARK: - Convenience Initializers
    
    static func configured(images: [MediaFile], at date: Date = Date()) -> GalleryEntry {
        GalleryEntry(date: date, images: images, configurationState: .configured)
    }
    
    static func notConfigured(at date: Date = Date()) -> GalleryEntry {
        GalleryEntry(date: date, images: [], configurationState: .notConfigured)
    }
    
    static func networkError(at date: Date = Date()) -> GalleryEntry {
        GalleryEntry(date: date, images: [], configurationState: .networkError)
    }
    
    static func emptyLibrary(at date: Date = Date()) -> GalleryEntry {
        GalleryEntry(date: date, images: [], configurationState: .emptyLibrary)
    }
    
    // MARK: - Computed Properties
    
    var isPlaceholder: Bool {
        switch configurationState {
        case .configured:
            return images.isEmpty
        default:
            return true
        }
    }
}
