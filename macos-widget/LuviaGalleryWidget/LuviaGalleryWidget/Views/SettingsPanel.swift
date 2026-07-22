//
//  SettingsPanel.swift
//  LuviaGalleryWidget
//
//  设置面板：服务器、Token、加载模式、间隔、置顶开关、立即加载。
//  字段通过 @AppStorage 持久化（由 ContentView 传入 Binding）。
//

import SwiftUI

// MARK: - SettingsPanel

struct SettingsPanel: View {

    // 持久化字段（Binding 来自 ContentView 的 @AppStorage）
    @Binding var serverAddress: String
    @Binding var apiToken: String
    @Binding var loadMode: String
    @Binding var folderPath: String
    @Binding var intervalSeconds: Double
    @Binding var floatingOnTop: Bool

    /// 视图模型（状态文字、加载动作）
    @ObservedObject var viewModel: CarouselViewModel
    /// 点击"立即加载"
    let onLoad: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // 服务器与 Token
            TextField("Server Address", text: $serverAddress, prompt: Text("https://your-server:8443"))
                .textFieldStyle(.roundedBorder)
            SecureField("API Token", text: $apiToken, prompt: Text("粘贴 Wallpaper Token"))
                .textFieldStyle(.roundedBorder)

            // 加载模式
            Picker("加载模式", selection: $loadMode) {
                Text("随机").tag("random")
                Text("收藏").tag("favorites")
                Text("文件夹").tag("folder")
            }
            .pickerStyle(.segmented)

            // 文件夹路径（仅 folder 模式显示）
            if loadMode == "folder" {
                TextField("文件夹路径", text: $folderPath, prompt: Text("Photos/Vacation"))
                    .textFieldStyle(.roundedBorder)
            }

            // 切换间隔滑块 2–30 秒
            HStack(spacing: 8) {
                Text("切换间隔 \(Int(intervalSeconds)) 秒")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(width: 90, alignment: .leading)
                Slider(value: $intervalSeconds, in: 2...30, step: 1)
            }

            // 置顶开关
            Toggle("悬浮在所有窗口之上", isOn: $floatingOnTop)
                .toggleStyle(.checkbox)
                .font(.caption)

            // 加载按钮 + 状态文字
            HStack(spacing: 10) {
                Button(action: onLoad) {
                    HStack(spacing: 4) {
                        if viewModel.isLoading {
                            ProgressView().controlSize(.small)
                        }
                        Text("立即加载")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.isLoading || serverAddress.isEmpty || apiToken.isEmpty)

                if !viewModel.statusText.isEmpty {
                    Text(viewModel.statusText)
                        .font(.caption)
                        .foregroundStyle(viewModel.statusIsError ? .red : .secondary)
                        .lineLimit(2)
                }
                Spacer()
            }
        }
        .padding(12)
        .background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 14)
    }
}
