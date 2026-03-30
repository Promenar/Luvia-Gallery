//
//  GalleryWidget.swift
//  GalleryWidget
//
//  Luvia Gallery macOS Widget
//

import WidgetKit
import SwiftUI

// MARK: - GalleryWidget
// 主 Widget 定义

@main
struct GalleryWidget: Widget {
    let kind: String = "com.luvia.gallery.widget"
    
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: GalleryWidgetConfigurationIntent.self,
            provider: GalleryProvider()
        ) { entry in
            GalleryWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Luvia Gallery")
        .description("Display photos from your Luvia Gallery library on your desktop.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

// MARK: - GalleryWidgetEntryView
// 根据尺寸选择不同视图

struct GalleryWidgetEntryView: View {
    var entry: GalleryEntry
    @Environment(\.widgetFamily) var family
    
    var body: some View {
        switch family {
        case .systemSmall:
            SmallWidgetView(entry: entry)
        case .systemMedium:
            MediumWidgetView(entry: entry)
        case .systemLarge:
            LargeWidgetView(entry: entry)
        default:
            SmallWidgetView(entry: entry)
        }
    }
}

// MARK: - Previews

#Preview(as: .systemSmall) {
    GalleryWidget()
} timeline: {
    GalleryEntry.notConfigured()
    GalleryEntry.configured(images: [])
}

#Preview(as: .systemMedium) {
    GalleryWidget()
} timeline: {
    GalleryEntry.notConfigured()
}

#Preview(as: .systemLarge) {
    GalleryWidget()
} timeline: {
    GalleryEntry.notConfigured()
}
