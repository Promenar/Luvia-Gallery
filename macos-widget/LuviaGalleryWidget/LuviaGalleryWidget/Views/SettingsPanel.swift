//
//  SettingsPanel.swift
//  LuviaGalleryWidget
//
//  设置面板：来源（在线 / 本地目录）、播放、窗口行为，分组排列。
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
    @Binding var launchAtLogin: Bool
    @Binding var snapToGrid: Bool
    @Binding var gridCellSize: Double
    @Binding var sourceMode: String
    @Binding var localFolderPath: String
    @Binding var localRecursive: Bool
    @Binding var displayCount: Double

    /// 视图模型（状态文字、加载动作）
    @ObservedObject var viewModel: CarouselViewModel
    /// 点击"立即加载"
    let onLoad: () -> Void
    /// 点击"选择目录…"（本地来源）
    let onChooseLocalFolder: () -> Void
    /// 点击"收起"（面板右下角）
    let onCollapse: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {

            // MARK: 来源
            sectionLabel("来源")

            // 在线 / 本地切换
            Picker("来源", selection: $sourceMode) {
                Text("在线").tag("online")
                Text("本地").tag("local")
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            if sourceMode == "local" {
                // 本地目录：当前路径 + 选择按钮
                HStack(spacing: 8) {
                    Text(localFolderPath.isEmpty ? "未选择目录" : localFolderPath)
                        .font(.caption)
                        .foregroundStyle(localFolderPath.isEmpty ? .secondary : .primary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button("选择目录…", action: onChooseLocalFolder)
                }
                // 是否递归子目录
                Toggle("包含子目录", isOn: $localRecursive)
                    .toggleStyle(.checkbox)
                    .font(.caption)
            } else {
                // 在线：服务器与 Token
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
            }

            Divider().opacity(0.3)

            // MARK: 播放
            sectionLabel("播放")

            // 切换间隔滑块 2–30 秒
            HStack(spacing: 8) {
                Text("切换间隔 \(Int(intervalSeconds)) 秒")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(width: 90, alignment: .leading)
                Slider(value: $intervalSeconds, in: 2...30, step: 1)
            }

            // 同时显示 1–6 张
            HStack(spacing: 8) {
                Text("同时显示 \(Int(displayCount)) 张")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(width: 90, alignment: .leading)
                Slider(value: $displayCount, in: 1...6, step: 1)
            }

            Divider().opacity(0.3)

            // MARK: 窗口
            sectionLabel("窗口")

            // 置顶开关
            Toggle("悬浮在所有窗口之上", isOn: $floatingOnTop)
                .toggleStyle(.checkbox)
                .font(.caption)

            // 开机自动启动（SMAppService，系统侧记录；失败时回滚并报错）
            Toggle("开机自动启动", isOn: Binding(
                get: { launchAtLogin },
                set: { newValue in
                    // 先记录用户意图
                    launchAtLogin = newValue
                    if let error = LoginItemManager.setEnabled(newValue) {
                        // 注册/注销失败：回滚开关并在状态区显示错误
                        launchAtLogin = !newValue
                        viewModel.statusIsError = true
                        viewModel.statusText = "设置开机启动失败：\(error.localizedDescription)"
                    }
                }
            ))
            .toggleStyle(.checkbox)
            .font(.caption)

            // 拖动松手后吸附桌面图标网格
            Toggle("拖动后吸附桌面网格", isOn: $snapToGrid)
                .toggleStyle(.checkbox)
                .font(.caption)

            // 网格 cell 大小滑块（Finder gridSpacing 换算不公开，交给用户校准）
            if snapToGrid {
                HStack(spacing: 8) {
                    Text("网格大小 \(Int(gridCellSize)) px")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .frame(width: 90, alignment: .leading)
                    Slider(value: $gridCellSize, in: 60...140, step: 2)
                }
            }

            Divider().opacity(0.3)

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
                .disabled(viewModel.isLoading || !loadEnabled)

                if !viewModel.statusText.isEmpty {
                    Text(viewModel.statusText)
                        .font(.caption)
                        .foregroundStyle(viewModel.statusIsError ? .red : .secondary)
                        .lineLimit(2)
                }
                Spacer()

                // 收起面板
                Button("收起", action: onCollapse)
                    .buttonStyle(.plain)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(12)
        .background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
    }

    /// 「立即加载」是否可用（按来源判断必填项）
    private var loadEnabled: Bool {
        if sourceMode == "local" {
            return !localFolderPath.isEmpty
        }
        return !serverAddress.isEmpty && !apiToken.isEmpty
    }

    /// 分组小标题
    private func sectionLabel(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
    }
}
