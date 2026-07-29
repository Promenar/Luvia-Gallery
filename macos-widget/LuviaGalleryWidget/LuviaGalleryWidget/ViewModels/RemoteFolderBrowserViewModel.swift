import Foundation
import Combine

/// 将 Foundation 目录状态机投影为 SwiftUI 可观察状态。
@MainActor
final class RemoteFolderBrowserViewModel: ObservableObject {
    @Published private(set) var currentPath: String? = nil
    @Published private(set) var folders: [RemoteFolder] = []
    @Published private(set) var state: RemoteFolderBrowserState = .idle
    @Published private(set) var canGoBack = false

    private let session: RemoteFolderBrowserSession

    init(serverAddress: String, token: String) {
        let client = APIClient(serverUrl: serverAddress, token: token)
        let session = RemoteFolderBrowserSession { parentPath in
            try await client.fetchFolders(parentPath: parentPath)
        }
        self.session = session
        session.onStateChange = { [weak self] in
            self?.synchronize()
        }
    }

    var selectedCurrentPath: String? { session.selectedCurrentPath }

    func loadInitial() async {
        await session.loadInitial()
    }

    func enter(_ folder: RemoteFolder) async {
        await session.enter(folder)
    }

    func goBack() async {
        await session.goBack()
    }

    func retry() async {
        await session.retry()
    }

    private func synchronize() {
        currentPath = session.currentPath
        folders = session.folders
        state = session.state
        canGoBack = session.canGoBack
    }
}
