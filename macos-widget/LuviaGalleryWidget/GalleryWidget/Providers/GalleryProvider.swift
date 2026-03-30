import WidgetKit
import SwiftUI

// MARK: - GalleryProvider
// AppIntentTimelineProvider 实现

struct GalleryProvider: AppIntentTimelineProvider {
    
    typealias Entry = GalleryEntry
    typealias Intent = GalleryWidgetConfigurationIntent
    
    // MARK: - AppIntentTimelineProvider
    
    func placeholder(in context: Context) -> GalleryEntry {
        .configured(images: [])
    }
    
    func snapshot(
        for configuration: GalleryWidgetConfigurationIntent,
        in context: Context
    ) async -> GalleryEntry {
        if context.isPreview {
            return .configured(images: [])
        } else {
            return await loadEntry(configuration: configuration)
        }
    }
    
    func timeline(
        for configuration: GalleryWidgetConfigurationIntent,
        in context: Context
    ) async -> Timeline<GalleryEntry> {
        return await loadTimeline(configuration: configuration)
    }
    
    // MARK: - Private Methods
    
    private func loadEntry(configuration: GalleryWidgetConfigurationIntent) async -> GalleryEntry {
        guard let config = TokenStore.shared.loadConfig(),
              config.isValid else {
            return .notConfigured()
        }
        
        let client = APIClient(serverUrl: config.sanitizedServerUrl, token: config.token)
        let mode = mapDisplayMode(configuration.mode)
        
        do {
            let files = try await client.fetchRandomFiles(
                limit: 12,
                mode: mode,
                folder: config.folderPath
            )
            
            let filteredFiles = config.showVideos
                ? files
                : files.filter { $0.mediaType == "image" }
            
            guard !filteredFiles.isEmpty else {
                return .emptyLibrary()
            }
            
            await precacheThumbnails(files: Array(filteredFiles.prefix(9)), client: client)
            
            return .configured(images: Array(filteredFiles.prefix(9)))
            
        } catch {
            print("[GalleryProvider] Error: \(error)")
            return .networkError()
        }
    }
    
    private func loadTimeline(configuration: GalleryWidgetConfigurationIntent) async -> Timeline<GalleryEntry> {
        let entry = await loadEntry(configuration: configuration)
        
        let refreshInterval: TimeInterval
        
        switch entry.configurationState {
        case .configured:
            refreshInterval = TimeInterval(refreshMinutes(configuration: configuration) * 60)
        case .notConfigured:
            refreshInterval = 3600
        case .networkError:
            refreshInterval = 300
        case .emptyLibrary:
            refreshInterval = 1800
        }
        
        let nextUpdate = Date().addingTimeInterval(refreshInterval)
        
        print("[GalleryProvider] Timeline: state=\(entry.configurationState), nextUpdate=\(refreshInterval/60)min")
        
        return Timeline(entries: [entry], policy: .after(nextUpdate))
    }
    
    private func precacheThumbnails(files: [MediaFile], client: APIClient) async {
        for file in files {
            if ImageCache.shared.hasImage(for: file.id) {
                continue
            }
            
            do {
                let data = try await client.downloadThumbnail(fileId: file.id)
                ImageCache.shared.save(data, for: file.id)
            } catch {
                print("[GalleryProvider] Failed to cache \(file.id.prefix(20)): \(error)")
            }
        }
    }
    
    // MARK: - Helpers
    
    private func mapDisplayMode(_ mode: DisplayModeEnum?) -> WidgetConfig.DisplayMode {
        switch mode {
        case .random, .none:
            return .random
        case .favorites:
            return .favorites
        case .folder:
            return .folder
        }
    }
    
    private func refreshMinutes(configuration: GalleryWidgetConfigurationIntent) -> Int {
        configuration.refreshInterval?.minutes ?? 30
    }
}
