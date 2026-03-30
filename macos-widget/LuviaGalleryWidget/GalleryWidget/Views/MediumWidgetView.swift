import SwiftUI

// MARK: - MediumWidgetView
// 中尺寸 Widget（2x2 网格）
// 参考 macOS 相册小组件中尺寸样式

struct MediumWidgetView: View {
    let entry: GalleryEntry
    
    private let columns = [
        GridItem(.flexible(), spacing: 4),
        GridItem(.flexible(), spacing: 4)
    ]
    
    var body: some View {
        switch entry.configurationState {
        case .configured:
            if entry.images.isEmpty {
                PlaceholderView(state: .emptyLibrary)
            } else {
                gridView
            }
        case .notConfigured:
            PlaceholderView(state: .notConfigured)
        case .networkError:
            PlaceholderView(state: .networkError)
        case .emptyLibrary:
            PlaceholderView(state: .emptyLibrary)
        }
    }
    
    // MARK: - Grid View
    
    @ViewBuilder
    private var gridView: some View {
        VStack(spacing: 0) {
            // 标题栏
            HStack {
                Text("Luvia Gallery")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)
                
                Spacer()
                
                Text("\(entry.images.count) photos")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            
            // 图片网格
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(entry.images.prefix(4)) { file in
                    ThumbnailCell(mediaFile: file)
                }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 4)
        }
        .background(Color(.windowBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 20) {
        MediumWidgetView(entry: .notConfigured())
            .frame(width: 360, height: 170)
        
        MediumWidgetView(entry: .configured(images: []))
            .frame(width: 360, height: 170)
    }
    .padding()
}
