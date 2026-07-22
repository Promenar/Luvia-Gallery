//
//  WindowDragView.swift
//  LuviaGalleryWidget
//
//  空白区域拖动窗口的 AppKit 桥接视图。
//  替代 isMovableByWindowBackground：只有点在空白区域才拖窗，
//  文本框内的按住拖动（选中文字）不会被劫持。
//

import SwiftUI
import AppKit

// MARK: - WindowDragView

/// 铺在内容最底层的拖动层：mouseDown 直接转交 window.performDrag
struct WindowDragView: NSViewRepresentable {

    func makeNSView(context: Context) -> WindowDragNSView {
        WindowDragNSView()
    }

    func updateNSView(_ nsView: WindowDragNSView, context: Context) {}
}

// MARK: - WindowDragNSView

final class WindowDragNSView: NSView {

    /// 鼠标按下即进入系统拖窗循环（.stationary / 桌面层级均不影响 performDrag）
    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }

    /// 不抢焦点，避免影响文本框编辑
    override var acceptsFirstResponder: Bool { false }
}
