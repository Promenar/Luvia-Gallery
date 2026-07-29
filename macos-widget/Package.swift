// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "LuviaGalleryWidgetCore",
    platforms: [.macOS(.v13)],
    products: [
        .library(name: "DisplayPlacementCore", targets: ["DisplayPlacementCore"])
    ],
    targets: [
        .target(
            name: "DisplayPlacementCore",
            path: "LuviaGalleryWidget/LuviaGalleryWidget/Services",
            exclude: [
                "APIClient.swift",
                "DesktopGridSnap.swift",
                "ImageCache.swift",
                "ImageLoader.swift",
                "LocalImageSource.swift",
                "LoginItemManager.swift",
                "StatusBarController.swift",
                "TokenStore.swift"
            ],
            sources: [
                "DisplayPlacementStore.swift",
                "RemoteFolderBrowserCore.swift"
            ]
        ),
        .testTarget(
            name: "DisplayPlacementCoreTests",
            dependencies: ["DisplayPlacementCore"],
            path: "Tests/DisplayPlacementCoreTests"
        )
    ]
)
