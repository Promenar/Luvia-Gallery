import SwiftUI

// MARK: - SmallWidgetView
// 小尺寸 Widget（单图展示）
// 参考 macOS 相册小组件小尺寸样式

struct SmallWidgetView: View {
    let entry: GalleryEntry
    @State private var imageData: Data?
    
    var body: some View {
        switch entry.configurationState {
        case .configured:
            if let firstImage = entry.images.first {
                singleImageView(firstImage)
            } else {
                PlaceholderView(state: .emptyLibrary)
            }
        case .notConfigured:
            PlaceholderView(state: .notConfigured)
        case .networkError:
            PlaceholderView(state: .networkError)
        case .emptyLibrary:
            PlaceholderView(state: .emptyLibrary)
        }
    }
    
    // MARK: - Single Image View
    
    @ViewBuilder
    private func singleImageView(_ file: MediaFile) -> some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottom) {
                // 背景图片
                if let data = imageData,
                   let nsImage = NSImage(data: data) {
                    Image(nsImage: nsImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .clipped()
                } else {
                    Color(.windowBackgroundColor)
                        .overlay(
                            ProgressView()
                        )
                }
                
                // 底部渐变 + 信息
                VStack(spacing: 0) {
                    Spacer()
                    
                    LinearGradient(
                        colors: [.clear, .black.opacity(0.6)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(height: 60)
                    
                    VStack(alignment: .leading, spacing: 2) {
                        Text(file.name)
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundColor(.white)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        
                        Text(file.folderPath.isEmpty ? "Library" : file.folderPath)
                            .font(.caption2)
                            .foregroundColor(.white.opacity(0.7))
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 10)
                    .padding(.bottom, 10)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .task {
            if let cached = ImageCache.shared.image(for: file.id) {
                imageData = cached
            }
        }
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 20) {
        SmallWidgetView(entry: .notConfigured())
            .frame(width: 170, height: 170)
        
        SmallWidgetView(entry: .networkError())
            .frame(width: 170, height: 170)
        
        SmallWidgetView(entry: .configured(images: []))
            .frame(width: 170, height: 170)
    }
    .padding()
}
