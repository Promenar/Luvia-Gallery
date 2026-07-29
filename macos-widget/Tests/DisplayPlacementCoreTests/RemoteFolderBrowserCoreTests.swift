import XCTest
@testable import DisplayPlacementCore

@MainActor
final class RemoteFolderBrowserCoreTests: XCTestCase {
    func test根目录请求不携带ParentPath且Bearer令牌不出现在URL中() throws {
        let request = try RemoteFolderRequest.make(
            serverAddress: "https://gallery.example.com/base/",
            token: "wallpaper-secret",
            parentPath: nil
        )

        XCTAssertEqual(request.url?.absoluteString, "https://gallery.example.com/base/api/library/folders")
        XCTAssertNil(request.url?.query)
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer wallpaper-secret")
        XCTAssertFalse(request.url?.absoluteString.contains("wallpaper-secret") ?? true)
    }

    func test子目录请求百分号编码路径且不把Bearer令牌写入查询参数() throws {
        let request = try RemoteFolderRequest.make(
            serverAddress: "https://gallery.example.com",
            token: "secret value",
            parentPath: "/媒体/100% 夏日"
        )

        XCTAssertEqual(
            request.url?.absoluteString,
            "https://gallery.example.com/api/library/folders?parentPath=%2F%E5%AA%92%E4%BD%93%2F100%25%20%E5%A4%8F%E6%97%A5"
        )
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer secret value")
        XCTAssertNil(request.url?.query?.range(of: "secret"))
    }

    func test目录响应同时兼容对象包装和旧版顶层数组() throws {
        let wrapped = Data(#"{"folders":[{"name":"旅行","path":"/图库/旅行"}]}"#.utf8)
        let legacy = Data(#"[{"name":"旅行","path":"/图库/旅行"}]"#.utf8)

        XCTAssertEqual(try RemoteFolderResponse.decode(wrapped), [RemoteFolder(name: "旅行", path: "/图库/旅行")])
        XCTAssertEqual(try RemoteFolderResponse.decode(legacy), [RemoteFolder(name: "旅行", path: "/图库/旅行")])
    }

    func test损坏目录JSON会失败关闭而非显示不可信目录() {
        XCTAssertThrowsError(try RemoteFolderResponse.decode(Data(#"{"folders":[{"name":"旅行"}]"#.utf8)))
    }

    func test首次加载自动请求虚拟根目录并展示授权目录() async {
        var requestedPaths: [String?] = []
        let session = RemoteFolderBrowserSession { parentPath in
            requestedPaths.append(parentPath)
            return [RemoteFolder(name: "授权图库", path: "/图库")]
        }

        await session.loadInitial()

        XCTAssertEqual(requestedPaths.count, 1)
        XCTAssertNil(requestedPaths[0])
        XCTAssertEqual(session.currentPath, nil)
        XCTAssertEqual(session.state, .loaded)
        XCTAssertEqual(session.folders, [RemoteFolder(name: "授权图库", path: "/图库")])
    }

    func test进入目录只加载下一层并允许选择当前目录() async {
        var requestedPaths: [String?] = []
        let root = RemoteFolder(name: "授权图库", path: "/图库")
        let session = RemoteFolderBrowserSession { parentPath in
            requestedPaths.append(parentPath)
            if parentPath == nil { return [root] }
            return [RemoteFolder(name: "旅行", path: "/图库/旅行")]
        }

        await session.loadInitial()
        await session.enter(root)

        XCTAssertEqual(requestedPaths.count, 2)
        XCTAssertNil(requestedPaths[0])
        XCTAssertEqual(requestedPaths[1], "/图库")
        XCTAssertEqual(session.currentPath, "/图库")
        XCTAssertEqual(session.selectedCurrentPath, "/图库")
    }

    func test返回已经加载的上级目录使用会话缓存而不重复请求() async {
        var requestedPaths: [String?] = []
        let root = RemoteFolder(name: "授权图库", path: "/图库")
        let session = RemoteFolderBrowserSession { parentPath in
            requestedPaths.append(parentPath)
            if parentPath == nil { return [root] }
            return [RemoteFolder(name: "旅行", path: "/图库/旅行")]
        }

        await session.loadInitial()
        await session.enter(root)
        await session.goBack()

        XCTAssertEqual(requestedPaths.count, 2)
        XCTAssertNil(session.currentPath)
        XCTAssertEqual(session.folders, [root])
        XCTAssertFalse(session.canGoBack)
    }

    func test重试失败目录会对当前位置重新发起请求并恢复可用状态() async {
        var attempts = 0
        let session = RemoteFolderBrowserSession { _ in
            attempts += 1
            if attempts == 1 { throw URLError(.notConnectedToInternet) }
            return [RemoteFolder(name: "授权图库", path: "/图库")]
        }

        await session.loadInitial()
        guard case .failed = session.state else {
            return XCTFail("离线时应进入可重试的失败状态")
        }

        await session.retry()

        XCTAssertEqual(attempts, 2)
        XCTAssertEqual(session.state, .loaded)
        XCTAssertEqual(session.folders, [RemoteFolder(name: "授权图库", path: "/图库")])
    }

    func test虚拟根目录不可作为选择结果() async {
        let session = RemoteFolderBrowserSession { _ in [] }

        await session.loadInitial()

        XCTAssertNil(session.selectedCurrentPath)
    }

    func test网络挂起时立即公开加载状态且旧响应不能覆盖较新的请求() async {
        var requestCount = 0
        let session = RemoteFolderBrowserSession { _ in
            requestCount += 1
            let request = requestCount
            try? await Task.sleep(nanoseconds: request == 1 ? 200_000_000 : 20_000_000)
            return [RemoteFolder(name: "请求\(request)", path: "/图库/请求\(request)")]
        }

        let firstLoad = Task { await session.loadInitial() }
        try? await Task.sleep(nanoseconds: 10_000_000)
        XCTAssertEqual(session.state, .loading)
        XCTAssertEqual(session.folders, [])

        let secondLoad = Task { await session.loadInitial() }
        await secondLoad.value
        await firstLoad.value

        XCTAssertEqual(requestCount, 2)
        XCTAssertEqual(session.state, .loaded)
        XCTAssertEqual(session.folders, [RemoteFolder(name: "请求2", path: "/图库/请求2")])
    }

    func test在线文件夹模式未选择目录时禁止加载以免退化为全库随机() {
        XCTAssertFalse(
            RemoteFolderLoadPolicy.canLoad(
                sourceMode: "online",
                loadMode: "folder",
                serverAddress: "https://gallery.example.com",
                apiToken: "token",
                folderPath: "  ",
                localFolderPath: ""
            )
        )
    }

    func test在线随机和收藏模式只需要服务器与令牌() {
        for loadMode in ["random", "favorites"] {
            XCTAssertTrue(
                RemoteFolderLoadPolicy.canLoad(
                    sourceMode: "online",
                    loadMode: loadMode,
                    serverAddress: "https://gallery.example.com",
                    apiToken: "token",
                    folderPath: "",
                    localFolderPath: ""
                )
            )
        }
    }

    func test本地来源继续只依赖本地目录而非在线字段() {
        XCTAssertTrue(
            RemoteFolderLoadPolicy.canLoad(
                sourceMode: "local",
                loadMode: "folder",
                serverAddress: "",
                apiToken: "",
                folderPath: "",
                localFolderPath: "/Users/example/Pictures"
            )
        )
        XCTAssertFalse(
            RemoteFolderLoadPolicy.canLoad(
                sourceMode: "local",
                loadMode: "random",
                serverAddress: "https://gallery.example.com",
                apiToken: "token",
                folderPath: "/图库",
                localFolderPath: "  "
            )
        )
    }

    func test纯空白Token会禁止浏览和加载并让目录请求失败关闭() {
        XCTAssertFalse(
            RemoteFolderLoadPolicy.hasUsableOnlineCredentials(
                serverAddress: "https://gallery.example.com",
                apiToken: " \n\t "
            )
        )
        XCTAssertFalse(
            RemoteFolderLoadPolicy.canLoad(
                sourceMode: "online",
                loadMode: "random",
                serverAddress: "https://gallery.example.com",
                apiToken: " \n\t ",
                folderPath: "",
                localFolderPath: ""
            )
        )
        XCTAssertThrowsError(
            try RemoteFolderRequest.make(
                serverAddress: "https://gallery.example.com",
                token: " \n\t ",
                parentPath: nil
            )
        )
    }

    func test加载期间进入返回和重试不会重复改变导航栈或发起额外请求() async {
        let root = RemoteFolder(name: "授权图库", path: "/图库")
        var requestedPaths: [String?] = []
        let session = RemoteFolderBrowserSession { parentPath in
            requestedPaths.append(parentPath)
            if parentPath == nil { return [root] }
            try? await Task.sleep(nanoseconds: 100_000_000)
            return [RemoteFolder(name: "旅行", path: "/图库/旅行")]
        }

        await session.loadInitial()
        let enterTask = Task { await session.enter(root) }
        try? await Task.sleep(nanoseconds: 10_000_000)
        let duplicateEnterTask = Task { await session.enter(root) }
        let goBackTask = Task { await session.goBack() }
        let retryTask = Task { await session.retry() }

        await enterTask.value
        await duplicateEnterTask.value
        await goBackTask.value
        await retryTask.value

        XCTAssertEqual(requestedPaths, [nil, "/图库"])
        XCTAssertEqual(session.currentPath, "/图库")
        XCTAssertTrue(session.canGoBack)
    }
}
