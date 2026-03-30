import SwiftUI

// MARK: - PlaceholderView
// 占位视图（未配置/加载中/错误状态）

struct PlaceholderView: View {
    let state: GalleryEntry.ConfigurationState
    
    var body: some View {
        ZStack {
            Color(.windowBackgroundColor)
            
            VStack(spacing: 12) {
                icon
                    .font(.system(size: 36))
                
                title
                    .font(.headline)
                    .foregroundStyle(.primary)
                
                subtitle
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding()
        }
    }
    
    // MARK: - Icon
    
    @ViewBuilder
    private var icon: some View {
        switch state {
        case .notConfigured:
            Image(systemName: "gear.badge.questionmark")
                .foregroundStyle(.orange)
        case .networkError:
            Image(systemName: "wifi.exclamationmark")
                .foregroundStyle(.red)
        case .emptyLibrary:
            Image(systemName: "photo.on.rectangle.angled")
                .foregroundStyle(.secondary)
        case .configured:
            Image(systemName: "photo.on.rectangle.angled")
                .foregroundStyle(.secondary)
        }
    }
    
    // MARK: - Title
    
    @ViewBuilder
    private var title: some View {
        Text("Luvia Gallery")
    }
    
    // MARK: - Subtitle
    
    @ViewBuilder
    private var subtitle: some View {
        switch state {
        case .notConfigured:
            Text("Open app to configure")
        case .networkError:
            Text("Network error - retrying...")
        case .emptyLibrary:
            Text("No photos found")
        case .configured:
            Text("Loading...")
        }
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 20) {
        PlaceholderView(state: .notConfigured)
            .frame(width: 170, height: 170)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        
        PlaceholderView(state: .networkError)
            .frame(width: 170, height: 170)
            .clipShape(RoundedRectangle(cornerRadius: 16))
        
        PlaceholderView(state: .emptyLibrary)
            .frame(width: 170, height: 170)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }
    .padding()
}
