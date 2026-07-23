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

/// 铺在内容最底层的拖动层：mouseDown 直接转交 window.performDrag。
/// 锁定状态下不响应拖动（performDrag 不触发）。
struct WindowDragView: NSViewRepresentable {

    /// 位置是否已锁定
    var isLocked: Bool = false

    func makeNSView(context: Context) -> WindowDragNSView {
        let view = WindowDragNSView()
        view.isLocked = isLocked
        return view
    }

    func updateNSView(_ nsView: WindowDragNSView, context: Context) {
        nsView.isLocked = isLocked
    }
}

// MARK: - WindowDragNSView

final class WindowDragNSView: NSView {

    /// 位置是否已锁定（锁定时不拖窗）
    var isLocked = false

    /// 鼠标按下即进入系统拖窗循环（.stationary / 桌面层级均不影响 performDrag）
    override func mouseDown(with event: NSEvent) {
        guard !isLocked else {
            super.mouseDown(with: event)
            return
        }
        window?.performDrag(with: event)
    }

    /// 不抢焦点，避免影响文本框编辑
    override var acceptsFirstResponder: Bool { false }
}
