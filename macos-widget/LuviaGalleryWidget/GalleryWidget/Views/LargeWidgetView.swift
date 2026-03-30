import SwiftUI

// MARK: - LargeWidgetView
// 大尺寸 Widget（3x3 网格）
// 参考 macOS 相册小组件大尺寸样式

struct LargeWidgetView: View {
    let entry: GalleryEntry
    
    private let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 3)
    
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
                VStack(alignment: .leading, spacing: 2) {
                    Text("Luvia Gallery")
                        .font(.headline)
                        .fontWeight(.semibold)
                        .foregroundStyle(.primary)
                    
                    Text("Your photo library")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                
                Spacer()
                
                // 刷新时间
                Text(entry.date, style: .time)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            
            // 图片网格
            LazyVGrid(columns: columns, spacing: 4) {
                ForEach(entry.images.prefix(9)) { file in
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
        LargeWidgetView(entry: .notConfigured())
            .frame(width: 360, height: 360)
        
        LargeWidgetView(entry: .configured(images: []))
            .frame(width: 360, height: 360)
    }
    .padding()
}
