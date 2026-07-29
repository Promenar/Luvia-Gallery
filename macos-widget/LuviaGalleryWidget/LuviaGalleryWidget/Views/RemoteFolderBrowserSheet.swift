import SwiftUI

/// 在线来源的权限范围内目录选择器。本地来源仍由 NSOpenPanel 处理。
struct RemoteFolderBrowserSheet: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: RemoteFolderBrowserViewModel
    @State private var navigationTask: Task<Void, Never>?
    private let onSelect: (String) -> Void

    init(serverAddress: String, token: String, onSelect: @escaping (String) -> Void) {
        _viewModel = StateObject(
            wrappedValue: RemoteFolderBrowserViewModel(serverAddress: serverAddress, token: token)
        )
        self.onSelect = onSelect
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                currentLocation
                Divider()
                content
            }
            .navigationTitle("浏览在线目录")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .navigation) {
                    Button {
                        goBack()
                    } label: {
                        Label("返回上级", systemImage: "chevron.left")
                    }
                    .disabled(!viewModel.canGoBack || viewModel.state == .loading)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("选择当前文件夹") {
                        guard let path = viewModel.selectedCurrentPath else { return }
                        onSelect(path)
                        dismiss()
                    }
                    .disabled(viewModel.selectedCurrentPath == nil || viewModel.state == .loading)
                }
            }
        }
        .frame(minWidth: 460, minHeight: 340)
        .task {
            await viewModel.loadInitial()
        }
        .onDisappear {
            navigationTask?.cancel()
            navigationTask = nil
        }
    }

    private var currentLocation: some View {
        HStack(spacing: 8) {
            Image(systemName: "folder")
                .foregroundStyle(.secondary)
            Text(viewModel.currentPath ?? "授权根目录")
                .font(.caption)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("当前位置：\(viewModel.currentPath ?? "授权根目录")")
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            ProgressView("正在读取目录…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            List(viewModel.folders) { folder in
                Button {
                    enter(folder)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "folder.fill")
                            .foregroundStyle(.yellow)
                        Text(folder.name)
                            .lineLimit(1)
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("进入\(folder.name)")
            }
            .listStyle(.inset)
        case .empty:
            ContentUnavailableView(
                "此目录为空",
                systemImage: "folder",
                description: Text("当前授权范围内没有可浏览的子目录。")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            ContentUnavailableView {
                Label("无法读取目录", systemImage: "exclamationmark.triangle")
            } description: {
                Text(message)
            } actions: {
                Button("重试") {
                    retry()
                }
                .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func enter(_ folder: RemoteFolder) {
        navigationTask?.cancel()
        navigationTask = Task { await viewModel.enter(folder) }
    }

    private func goBack() {
        navigationTask?.cancel()
        navigationTask = Task { await viewModel.goBack() }
    }

    private func retry() {
        navigationTask?.cancel()
        navigationTask = Task { await viewModel.retry() }
    }
}
