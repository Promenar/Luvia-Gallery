import Foundation

// MARK: - WidgetError

enum WidgetError: Error, LocalizedError {
    case invalidURL
    case networkError(Error)
    case invalidResponse
    case serverError(Int)
    case decodingError(Error)
    case noData
    
    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .invalidResponse:
            return "Invalid server response"
        case .serverError(let code):
            return "Server error: HTTP \(code)"
        case .decodingError(let error):
            return "Data parsing error: \(error.localizedDescription)"
        case .noData:
            return "No data available"
        }
    }
}

// MARK: - APIClient
// 对标 wallpaper.js 中的 fetchItems() 和 getMediaUrl()

actor APIClient {
    
    // MARK: - Properties
    
    let serverUrl: String
    let token: String
    
    // MARK: - Initialization
    
    init(serverUrl: String, token: String) {
        self.serverUrl = serverUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        self.token = token
    }
    
    // MARK: - API Methods
    
    /// 获取随机图片列表
    /// 对标 wallpaper.js fetchItems()
    func fetchRandomFiles(
        limit: Int = 12,
        mode: WidgetConfig.DisplayMode = .random,
        folder: String = ""
    ) async throws -> [MediaFile] {
        // 构建 URL
        var components = URLComponents(string: "\(serverUrl)/api/scan/results")!
        
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "random", value: "true"),
            URLQueryItem(name: "limit", value: "\(limit)"),
            URLQueryItem(name: "recursive", value: "true"),
            URLQueryItem(name: "token", value: token)
        ]
        
        // 根据模式添加参数
        switch mode {
        case .favorites:
            queryItems.append(URLQueryItem(name: "favorites", value: "true"))
        case .folder:
            if !folder.isEmpty {
                queryItems.append(URLQueryItem(name: "folder", value: folder))
            }
        case .random:
            break
        }
        
        components.queryItems = queryItems
        
        guard let url = components.url else {
            throw WidgetError.invalidURL
        }
        
        print("[APIClient] Fetching: \(url.absoluteString.prefix(100))...")
        
        // 发起请求
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(from: url)
        } catch {
            throw WidgetError.networkError(error)
        }
        
        // 检查响应
        guard let httpResponse = response as? HTTPURLResponse else {
            throw WidgetError.invalidResponse
        }
        
        guard (200...299).contains(httpResponse.statusCode) else {
            print("[APIClient] Server error: HTTP \(httpResponse.statusCode)")
            throw WidgetError.serverError(httpResponse.statusCode)
        }
        
        // 解析数据
        do {
            let result = try JSONDecoder().decode(ScanResult.self, from: data)
            print("[APIClient] Fetched \(result.files.count) files (total: \(result.total))")
            return result.files
        } catch {
            print("[APIClient] Decoding error: \(error)")
            throw WidgetError.decodingError(error)
        }
    }
    
    /// 构建缩略图 URL
    /// 对标 wallpaper.js getMediaUrl()
    func thumbnailURL(for fileId: String) -> URL? {
        // Base64 编码的 ID 需要保留原样
        let encodedId = fileId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? fileId
        let urlString = "\(serverUrl)/api/thumb/\(encodedId)?token=\(token)"
        return URL(string: urlString)
    }
    
    /// 下载缩略图数据
    func downloadThumbnail(fileId: String) async throws -> Data {
        guard let url = thumbnailURL(for: fileId) else {
            throw WidgetError.invalidURL
        }
        
        let (data, response): (Data, URLResponse)
        do {
            (data, response) = try await URLSession.shared.data(from: url)
        } catch {
            throw WidgetError.networkError(error)
        }
        
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw WidgetError.serverError((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        
        return data
    }
    
    /// 构建原图 URL
    func originalImageURL(for fileId: String) -> URL? {
        let encodedId = fileId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? fileId
        let urlString = "\(serverUrl)/api/file/\(encodedId)?token=\(token)"
        return URL(string: urlString)
    }
}
