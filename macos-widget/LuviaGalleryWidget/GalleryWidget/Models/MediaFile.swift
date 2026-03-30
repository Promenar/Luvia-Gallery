import Foundation

// MARK: - MediaFile
// 对标 /api/scan/results 返回的文件数据结构

struct MediaFile: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let url: String
    let thumbnailUrl: String
    let name: String
    let folderPath: String
    let size: Int
    let type: String              // MIME type
    let lastModified: Int
    let mediaType: String         // "image" | "video" | "audio"
    let sourceId: String
    let isFavorite: Bool?
    let width: Int?
    let height: Int?
    let aspectRatio: Double?
    
    enum CodingKeys: String, CodingKey {
        case id, url, thumbnailUrl, name, folderPath, size, type
        case lastModified, mediaType, sourceId, isFavorite
        case width, height, aspectRatio
    }
    
    // Hashable conformance
    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
    
    static func == (lhs: MediaFile, rhs: MediaFile) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - ScanResult
// /api/scan/results 返回的完整响应结构

struct ScanResult: Decodable, Sendable {
    let files: [MediaFile]
    let total: Int
    let hasMore: Bool
    let sources: [SourceInfo]?
    
    struct SourceInfo: Decodable, Sendable {
        let id: String
        let name: String
        let count: Int
    }
}
