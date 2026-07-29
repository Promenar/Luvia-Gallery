import Foundation

/// 在线目录的最小安全表示，仅保留浏览和选择所需字段。
nonisolated struct RemoteFolder: Codable, Equatable, Identifiable, Sendable {
    let name: String
    let path: String

    var id: String { path }

    init(name: String, path: String) {
        self.name = name
        self.path = path
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedName = try container.decode(String.self, forKey: .name)
        let decodedPath = try container.decode(String.self, forKey: .path)
        guard !decodedName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !decodedPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw DecodingError.dataCorruptedError(
                forKey: .path,
                in: container,
                debugDescription: "目录名称和路径不能为空"
            )
        }
        name = decodedName
        path = decodedPath
    }
}

/// 仅接受服务端当前对象包装和兼容的旧版顶层数组，未知结构一律失败关闭。
nonisolated enum RemoteFolderResponse {
    private struct WrappedFolders: Decodable {
        let folders: [RemoteFolder]
    }

    static func decode(_ data: Data) throws -> [RemoteFolder] {
        let decoder = JSONDecoder()
        if let wrapped = try? decoder.decode(WrappedFolders.self, from: data) {
            return wrapped.folders
        }
        return try decoder.decode([RemoteFolder].self, from: data)
    }
}

nonisolated enum RemoteFolderRequestError: LocalizedError, Sendable {
    case invalidServerAddress
    case invalidToken

    var errorDescription: String? {
        switch self {
        case .invalidServerAddress:
            return "服务器地址无效"
        case .invalidToken:
            return "Token 不能为空"
        }
    }
}

/// 目录请求统一由此构造，避免 Token 落入 URL、查询参数或可见日志。
nonisolated enum RemoteFolderRequest {
    static func make(serverAddress: String, token: String, parentPath: String?) throws -> URLRequest {
        guard let serverURL = URL(string: serverAddress.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = serverURL.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              serverURL.host != nil,
              var components = URLComponents(url: serverURL, resolvingAgainstBaseURL: false) else {
            throw RemoteFolderRequestError.invalidServerAddress
        }
        guard !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw RemoteFolderRequestError.invalidToken
        }

        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = "/" + ([basePath, "api/library/folders"].filter { !$0.isEmpty }.joined(separator: "/"))
        components.query = nil
        components.fragment = nil

        if let parentPath, !parentPath.isEmpty {
            var allowed = CharacterSet.alphanumerics
            allowed.insert(charactersIn: "-._~")
            guard let encodedPath = parentPath.addingPercentEncoding(withAllowedCharacters: allowed) else {
                throw RemoteFolderRequestError.invalidServerAddress
            }
            components.percentEncodedQuery = "parentPath=\(encodedPath)"
        }

        guard let url = components.url else {
            throw RemoteFolderRequestError.invalidServerAddress
        }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }
}

/// 可视化目录浏览器的可观察状态。
enum RemoteFolderBrowserState: Equatable {
    case idle
    case loading
    case loaded
    case empty
    case failed(String)
}

/// 设置面板的加载前置条件，避免在线文件夹未选择时退化为全库加载。
nonisolated enum RemoteFolderLoadPolicy {
    static func hasUsableOnlineCredentials(serverAddress: String, apiToken: String) -> Bool {
        !serverAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !apiToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    static func canLoad(
        sourceMode: String,
        loadMode: String,
        serverAddress: String,
        apiToken: String,
        folderPath: String,
        localFolderPath: String
    ) -> Bool {
        if sourceMode == "local" {
            return !localFolderPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        guard hasUsableOnlineCredentials(serverAddress: serverAddress, apiToken: apiToken) else {
            return false
        }
        if loadMode == "folder" {
            return !folderPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return true
    }
}

private enum RemoteFolderCacheKey: Hashable {
    case root
    case folder(String)

    init(path: String?) {
        self = path.map(Self.folder) ?? .root
    }
}

/// Sheet 生命周期内的目录导航状态机；根为虚拟入口，不能被选择。
@MainActor
final class RemoteFolderBrowserSession {
    typealias Loader = @MainActor (String?) async throws -> [RemoteFolder]

    private let loader: Loader
    private var backStack: [String?] = []
    private var cache: [RemoteFolderCacheKey: [RemoteFolder]] = [:]
    private var requestGeneration = 0

    private(set) var currentPath: String?
    private(set) var folders: [RemoteFolder] = []
    private(set) var state: RemoteFolderBrowserState = .idle
    var onStateChange: (@MainActor () -> Void)?

    init(loader: @escaping Loader) {
        self.loader = loader
    }

    var canGoBack: Bool { !backStack.isEmpty }

    /// 虚拟根不可选择；进入真实目录后才返回可持久化的路径。
    var selectedCurrentPath: String? {
        guard let currentPath, !currentPath.isEmpty else { return nil }
        return currentPath
    }

    func loadInitial() async {
        backStack.removeAll()
        currentPath = nil
        await load(path: nil, force: true)
    }

    func enter(_ folder: RemoteFolder) async {
        guard state != .loading, !folder.path.isEmpty else { return }
        backStack.append(currentPath)
        currentPath = folder.path
        await load(path: folder.path, force: false)
    }

    func goBack() async {
        guard state != .loading, let previousPath = backStack.popLast() else { return }
        currentPath = previousPath
        await load(path: previousPath, force: false)
    }

    func retry() async {
        guard state != .loading else { return }
        await load(path: currentPath, force: true)
    }

    private func load(path: String?, force: Bool) async {
        let cacheKey = RemoteFolderCacheKey(path: path)
        requestGeneration += 1
        let generation = requestGeneration
        if !force, let cachedFolders = cache[cacheKey] {
            folders = cachedFolders
            state = cachedFolders.isEmpty ? .empty : .loaded
            notifyStateChange()
            return
        }

        folders = []
        state = .loading
        notifyStateChange()
        do {
            let fetchedFolders = try await loader(path)
            guard !Task.isCancelled, generation == requestGeneration else { return }
            cache[cacheKey] = fetchedFolders
            folders = fetchedFolders
            state = fetchedFolders.isEmpty ? .empty : .loaded
            notifyStateChange()
        } catch {
            guard !Task.isCancelled, generation == requestGeneration else { return }
            state = .failed(error.localizedDescription)
            notifyStateChange()
        }
    }

    private func notifyStateChange() {
        onStateChange?()
    }
}
