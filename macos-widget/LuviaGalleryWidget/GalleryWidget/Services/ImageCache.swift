import Foundation

// MARK: - ImageCache
// Widget 中必须使用本地文件缓存，不能依赖 URLSession 内存缓存
// 使用 final class + @unchecked Sendable 避免 Swift 6 actor 隔离问题

final class ImageCache: @unchecked Sendable {
    
    // MARK: - Singleton
    
    static let shared = ImageCache()
    
    // MARK: - Constants
    
    private let suiteName = "group.com.luvia.gallery"
    private let cacheDirectoryName = "WidgetCache/Thumbnails"
    private let maxCacheSize: Int = 50 * 1024 * 1024  // 50 MB
    
    // MARK: - Properties
    
    private let fileManager = FileManager.default
    private let lock = NSLock()
    
    private var cacheDirectory: URL? {
        guard let groupURL = fileManager.containerURL(
            forSecurityApplicationGroupIdentifier: suiteName
        ) else { return nil }
        return groupURL.appendingPathComponent(cacheDirectoryName, isDirectory: true)
    }
    
    // MARK: - Initialization
    
    private init() {
        createCacheDirectoryIfNeeded()
    }
    
    // MARK: - Public API
    
    /// 获取缓存的图片数据
    func image(for fileId: String) -> Data? {
        lock.lock()
        defer { lock.unlock() }
        
        guard let fileURL = cacheFileURL(for: fileId) else { return nil }
        
        guard fileManager.fileExists(atPath: fileURL.path) else {
            return nil
        }
        
        do {
            return try Data(contentsOf: fileURL)
        } catch {
            print("[ImageCache] Failed to read cache for \(fileId.prefix(20)): \(error)")
            return nil
        }
    }
    
    /// 保存图片数据到缓存
    func save(_ data: Data, for fileId: String) {
        lock.lock()
        defer { lock.unlock() }
        
        guard let fileURL = cacheFileURL(for: fileId) else { return }
        
        do {
            createCacheDirectoryIfNeeded()
            
            try data.write(to: fileURL, options: .atomic)
            print("[ImageCache] Saved: \(fileId.prefix(20))... (\(data.count) bytes)")
            
            trimCacheIfNeeded()
        } catch {
            print("[ImageCache] Failed to save cache for \(fileId.prefix(20)): \(error)")
        }
    }
    
    /// 检查是否有缓存
    func hasImage(for fileId: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        
        guard let fileURL = cacheFileURL(for: fileId) else { return false }
        return fileManager.fileExists(atPath: fileURL.path)
    }
    
    /// 清除所有缓存
    func clearCache() throws {
        lock.lock()
        defer { lock.unlock() }
        
        guard let cacheDir = cacheDirectory else { return }
        
        if fileManager.fileExists(atPath: cacheDir.path) {
            try fileManager.removeItem(at: cacheDir)
        }
        
        createCacheDirectoryIfNeeded()
        print("[ImageCache] Cache cleared")
    }
    
    /// 获取缓存大小（字节）
    func cacheSize() -> Int {
        guard let cacheDir = cacheDirectory,
              let enumerator = fileManager.enumerator(
                at: cacheDir,
                includingPropertiesForKeys: [.fileSizeKey],
                options: [.skipsHiddenFiles]
              ) else {
            return 0
        }
        
        var totalSize = 0
        for case let fileURL as URL in enumerator {
            if let attrs = try? fileURL.resourceValues(forKeys: [.fileSizeKey]),
               let fileSize = attrs.fileSize {
                totalSize += fileSize
            }
        }
        return totalSize
    }
    
    /// 获取缓存文件数量
    func cacheFileCount() -> Int {
        guard let cacheDir = cacheDirectory,
              let enumerator = fileManager.enumerator(
                at: cacheDir,
                includingPropertiesForKeys: nil,
                options: [.skipsHiddenFiles]
              ) else {
            return 0
        }
        
        return enumerator.allObjects.count
    }
    
    // MARK: - Private
    
    private func cacheFileURL(for fileId: String) -> URL? {
        let safeFilename = fileId
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "=", with: "")
        
        return cacheDirectory?.appendingPathComponent("\(safeFilename).webp")
    }
    
    private func createCacheDirectoryIfNeeded() {
        guard let cacheDir = cacheDirectory else { return }
        
        if !fileManager.fileExists(atPath: cacheDir.path) {
            try? fileManager.createDirectory(at: cacheDir, withIntermediateDirectories: true)
            print("[ImageCache] Created cache directory: \(cacheDir.path)")
        }
    }
    
    private func trimCacheIfNeeded() {
        let currentSize = cacheSize()
        
        if currentSize > maxCacheSize {
            print("[ImageCache] Cache size (\(currentSize / 1024 / 1024)MB) exceeds limit, trimming...")
            
            guard let cacheDir = cacheDirectory,
                  let enumerator = fileManager.enumerator(
                    at: cacheDir,
                    includingPropertiesForKeys: [.contentModificationDateKey],
                    options: [.skipsHiddenFiles]
                  ) else {
                return
            }
            
            var files: [(URL, Date)] = []
            for case let fileURL as URL in enumerator {
                if let attrs = try? fileURL.resourceValues(forKeys: [.contentModificationDateKey]),
                   let modDate = attrs.contentModificationDate {
                    files.append((fileURL, modDate))
                }
            }
            
            files.sort { $0.1 < $1.1 }
            
            var deletedCount = 0
            for (fileURL, _) in files {
                if cacheSize() < maxCacheSize * 80 / 100 {
                    break
                }
                try? fileManager.removeItem(at: fileURL)
                deletedCount += 1
            }
            
            print("[ImageCache] Deleted \(deletedCount) old files")
        }
    }
}
