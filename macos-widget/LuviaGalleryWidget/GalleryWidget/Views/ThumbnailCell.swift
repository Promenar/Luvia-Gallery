import SwiftUI

// MARK: - ThumbnailCell
// 通用缩略图单元

struct ThumbnailCell: View {
    let mediaFile: MediaFile
    @State private var imageData: Data?
    
    var body: some View {
        ZStack {
            if let data = imageData,
               let nsImage = NSImage(data: data) {
                Image(nsImage: nsImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                Color(.windowBackgroundColor)
                    .overlay(
                        ProgressView()
                            .scaleEffect(0.5)
                    )
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .task {
            loadCachedImage()
        }
    }
    
    private func loadCachedImage() {
        if let cached = ImageCache.shared.image(for: mediaFile.id) {
            imageData = cached
        }
    }
}

// MARK: - ThumbnailCellAsync
// 异步加载版本（用于 Timeline 预加载后仍需加载的情况）

struct ThumbnailCellAsync: View {
    let mediaFile: MediaFile
    let serverUrl: String
    let token: String
    
    @State private var imageData: Data?
    @State private var isLoading = false
    
    var body: some View {
        ZStack {
            if let data = imageData,
               let nsImage = NSImage(data: data) {
                Image(nsImage: nsImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else if isLoading {
                Color(.windowBackgroundColor)
                    .overlay(
                        ProgressView()
                            .scaleEffect(0.5)
                    )
            } else {
                Color(.windowBackgroundColor)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .task {
            await loadImage()
        }
    }
    
    private func loadImage() async {
        if let cached = ImageCache.shared.image(for: mediaFile.id) {
            imageData = cached
            return
        }
        
        isLoading = true
        let client = APIClient(serverUrl: serverUrl, token: token)
        
        do {
            let data = try await client.downloadThumbnail(fileId: mediaFile.id)
            ImageCache.shared.save(data, for: mediaFile.id)
            imageData = data
        } catch {
            print("[ThumbnailCell] Load failed: \(error)")
        }
        
        isLoading = false
    }
}

// MARK: - Preview

#Preview {
    let sampleFile = MediaFile(
        id: "test-id",
        url: "/api/file/test",
        thumbnailUrl: "/api/thumb/test",
        name: "sample.jpg",
        folderPath: "Photos",
        size: 1024,
        type: "image/jpeg",
        lastModified: Int(Date().timeIntervalSince1970),
        mediaType: "image",
        sourceId: "local",
        isFavorite: false,
        width: 800,
        height: 600,
        aspectRatio: 1.33
    )
    
    ThumbnailCell(mediaFile: sampleFile)
        .frame(width: 100, height: 100)
        .padding()
}
