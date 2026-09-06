// components/player/PlayerWindow.tsx
// Task B+C：非模态悬浮播放窗壳（取代 MediaPlayer 原全屏遮罩形态），三形态：window 浮窗 / mini 小窗 / fab 圆钮。
// - 非模态：不渲染任何 inset-0 遮罩层，容器 fixed z-40，页面其余区域保持可交互。
// - 材质：复用全站浮岛类 glass-1 gallery-toolbar-glass rounded-2xl（与 GalleryNavigationBar 一致）。
// - window：宽度取 localStorage 偏好或 clamp(280, 视口宽*0.42, 视口宽-48)；hotfix-3 起等比模式写显式高度：
//   容器 height = 内容区高(宽/媒体比例) + 头部 44px——内容区正好贴合媒体比例（旧 aspectRatio 作用于含头部的
//   整容器，系统性留白已消除）；内容区推导高超视口高 80% 时以高度定宽（竖图收窄），触 240px 宽度下限则
//   高度按比例回推；边缘/角落拖动写高度覆盖（媒体 contain）；头部为完整画廊控制栏。
// - mini：固定 240px 宽小窗，仍可拖动；头部只留展开回 window 与关闭的最小控制，
//   画廊式完整控制栏与信息面板隐藏，内容区只保留媒体（视频沿用原生控件）。
// - fab：56px 圆钮固定右下（16px 边距），不可拖动；背景为当前项缩略图（getAuthUrl 拼认证，
//   加载失败回退 Icons.Image），视频项带播放角标；点击回 window。fab 不暂停播放（音频继续，视频随容器卸载）。
// - 边缘拖拽自定义大小（hotfix-2，hotfix-4 起标准窗口语义，仅 window 形态）：三个抓手全部自由缩放
//   （非等比）——右缘只改宽（heightOverride 锁定为起点容器渲染总高，宽度变化后高度不再按比例跟随）、
//   右下角宽高各自独立跟随（+dx/+dy）、下边缘只改高；覆盖落盘（heightOverride 字段，覆盖期间容器显式
//   height、媒体 contain）；双击右缘/右下角清除覆盖回等比自适应。复用头部抓手同款 pointer 三段式。
// - 拖动：头部抓手自实现 pointerdown→move→up（fab 无抓手不可拖动），位置 clamp 视口内，pointerup 落库。
// - 跟手（hotfix-3）：拖动/缩放 pointermove 直写容器 style.left/top/width/height（起点增量推算，零 setState
//   零重渲染）；会话期间 isInteracting 置 true 禁用 framer-motion layout 补间；pointerup 一次性 setState 同步
//   React 状态（与直写值一致，无视觉跳变）并 saveWindowPrefs 落盘。
// - 动画：AnimatePresence mode="popLayout" 下 window/mini 共用同 key 容器（不卸载，媒体子树跨形态保持），
//   形变由 framer-motion layout 驱动（交互会话期间禁用）；window 与 fab 为不同 key 互斥出现（fade + scale）。
// - 形态偏好：切换形态即落盘 saveWindowPrefs（mode 字段）；重新 open 时按偏好恢复 mini/fab
//   （fullscreen 不作为持久形态，loadWindowPrefs 已归一化为 window）。
import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useMediaPlayer } from './PlayerProvider';
import { ImageViewPane } from './ImageViewPane';
import { VideoPane } from './VideoPane';
import { Icons } from '../ui/Icon';
import { getAuthUrl } from '../../utils/fileUtils';
import { loadWindowPrefs, saveWindowPrefs } from './window-prefs';
import type { PlayerDisplayMode } from './types';
import type { MediaItem } from '../../types';

interface PlayerWindowProps {
    /** 收藏回调：由 App 透传（头部按钮直接调用） */
    onToggleFavorite?: (item: MediaItem, type: 'file') => void;
    /** 信息面板开合状态（状态与 EXIF 拉取由 MediaPlayer 壳层持有，本组件只渲染开关按钮） */
    showInfo: boolean;
    onToggleInfo: () => void;
    /** 信息面板节点（MediaPlayer 壳层构建，仅 window 形态渲染在窗口内容区内） */
    infoPanel?: React.ReactNode;
}

/** 浮窗与视口边缘的默认间距（px） */
const WINDOW_MARGIN = 24;
/** 浮窗宽度下限（px）：记忆/拖拽宽度的 clamp 下限 */
const MIN_WIDTH = 280;
/** 竖图收窄保护（hotfix-2）：比例推导宽度的下限（px），触底后高度按比例回推保持形状贴合 */
const MIN_FIT_WIDTH = 240;
/** 视口高度预算系数（hotfix-2）：比例推导高度的硬上限 = 视口高 * 0.8，超高媒体以高度定宽 */
const MAX_HEIGHT_RATIO = 0.8;
/** mini 小窗固定宽度（px） */
const MINI_WIDTH = 240;
/** mini 内容区最小高度（px）：比例推导高度过低时以 minHeight 兜底 */
const MINI_MIN_HEIGHT = 120;
/** 高度覆盖/推导的最小高度下限（px）：下边缘拖高与覆盖值的共同下限 */
const MIN_SHELL_HEIGHT = 120;
/** 头部高度（px，hotfix-3）：与头部 h-11 对应；等比模式容器高 = 内容区高 + 头部高 */
const HEADER_HEIGHT = 44;
/** fab 圆钮边长（px）与右下边距（px） */
const FAB_SIZE = 56;
const FAB_MARGIN = 16;
/** 无尺寸信息媒体的比例兜底（16:9） */
const FALLBACK_ASPECT = 16 / 9;

const clamp = (value: number, lo: number, hi: number) => Math.min(Math.max(value, lo), Math.max(lo, hi));

/** 媒体显示比例：优先 item.width/height，其次 aspectRatio 字段，最后 16:9 兜底（hotfix-3 起容器高由 ratio 公式推导） */
const resolveAspect = (item: MediaItem): { ratio: number } => {
    if (item.width && item.height && item.width > 0 && item.height > 0) {
        return { ratio: item.width / item.height };
    }
    if (item.aspectRatio && Number.isFinite(item.aspectRatio) && item.aspectRatio > 0) {
        return { ratio: item.aspectRatio };
    }
    return { ratio: FALLBACK_ASPECT };
};

export const PlayerWindow: React.FC<PlayerWindowProps> = ({ onToggleFavorite, showInfo, onToggleInfo, infoPanel }) => {
    const { state, currentItem, close, next, prev, displayMode, setMode } = useMediaPlayer();

    // 宽度：首次挂载读一次偏好（Task A loadWindowPrefs），无偏好按视口宽 42% clamp。
    // 该宽度始终是 window 形态的记忆宽度：mini 固定 240、fab 无宽度，均不改写此值。
    // hotfix-2 起可变：右缘/右下角拖拽直接改写（clamp [280, 视口宽-48]）；右缘拖拽同时锁定高度覆盖（hotfix-4）。
    const [width, setWidth] = useState(() => {
        const preferred = loadWindowPrefs()?.width;
        return typeof preferred === 'number' && Number.isFinite(preferred)
            ? clamp(preferred, MIN_WIDTH, window.innerWidth - WINDOW_MARGIN * 2)
            : clamp(window.innerWidth * 0.42, MIN_WIDTH, window.innerWidth - WINDOW_MARGIN * 2);
    });
    // 高度覆盖（px，hotfix-2）：边缘/角落拖动自定义高度后落盘（window-prefs 可选字段）——
    // 下缘/右下角写拖拽高，右缘锁定起点容器渲染总高（hotfix-4）；null = 无覆盖，高度按媒体比例自适应。
    // 仅 window 形态生效；双击右缘/右下角清除回等比。
    const [heightOverride, setHeightOverride] = useState<number | null>(() => {
        const override = loadWindowPrefs()?.heightOverride;
        return typeof override === 'number' ? override : null;
    });
    // 记忆位置：偏好坐标原样保存，渲染/拖动时统一 clamp 进视口；null 表示未拖动过 → 按右下角锚定
    const [pos, setPos] = useState<{ x: number; y: number } | null>(() => {
        const prefs = loadWindowPrefs();
        return prefs ? { x: prefs.x, y: prefs.y } : null;
    });
    // fab 缩略图加载失败标记：回退图标兜底；切换队列项时重置以重试新缩略图
    const [fabImageFailed, setFabImageFailed] = useState(false);
    useEffect(() => { setFabImageFailed(false); }, [currentItem?.id]);

    // 打开播放器时恢复上次落盘的形态（仅 mini/fab；fullscreen 已在 loadWindowPrefs 归一化为 window）。
    // setMode 经 ref 间接调用：context value 随 state 重建，避免易变引用进入依赖导致偏好反复覆盖用户手动切换。
    const setModeRef = useRef(setMode);
    useEffect(() => { setModeRef.current = setMode; });
    useEffect(() => {
        if (!state.isOpen) return;
        const restored = loadWindowPrefs()?.mode;
        if (restored === 'mini' || restored === 'fab') setModeRef.current(restored);
        // 仅在 open/close 翻转时执行一次；用户手动切形态不触发本 effect
    }, [state.isOpen]);

    // 拖动会话：起点指针坐标 + 起点窗口坐标（move/up 都从起点增量推算，避免闭包读到过期状态）
    const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
    // hotfix-3：浮窗容器 ref——拖动/缩放 pointermove 直接写 style（left/top/width/height），
    // 绕过 React 状态更新消除整树重渲染延迟；pointerup 才 setState 同步 + 落盘。
    const windowRef = useRef<HTMLDivElement>(null);
    // hotfix-3：拖动/缩放交互会话标记。pointerdown/pointerup 各 setState 一次（move 中零 setState）；
    // 会话期间 layout 补间禁用（layout={!isInteracting}），位置/尺寸由直写样式全权接管，结束后恢复。
    const [isInteracting, setIsInteracting] = useState(false);

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const isMini = displayMode === 'mini';
    const isWindow = displayMode === 'window';
    const isFab = displayMode === 'fab';

    // 形状贴合媒体（hotfix-3，双向预算）：宽度基准 = 记忆/拖拽宽度，内容区高按比例推导；
    // 推导高度超视口高 80% 时以高度定宽（竖图收窄）；触 240px 宽度下限则高度按比例回推（保持比例）。
    // 容器总高 = 内容区高 + 头部 44px（hotfix-3 显式公式）——内容区（容器高 - 44）正好贴合媒体比例，
    // 消除旧 aspectRatio 作用于含头部整容器导致的系统性留白；高度覆盖期间容器高即覆盖值（媒体 contain）。
    // 退出动画期间 currentItem 为 null（aspect 为 null），width/height 保持基准值即可。
    const aspect = currentItem ? resolveAspect(currentItem) : null;
    const maxWidth = viewportW - WINDOW_MARGIN * 2;
    let shellWidth = isMini ? MINI_WIDTH : width;
    let contentHeight = aspect ? shellWidth / aspect.ratio : 0;
    if (aspect && !isMini && contentHeight > viewportH * MAX_HEIGHT_RATIO) {
        // 超高媒体：以高度定宽（竖图收窄）
        contentHeight = viewportH * MAX_HEIGHT_RATIO;
        shellWidth = contentHeight * aspect.ratio;
    }
    if (aspect && !isMini && shellWidth < MIN_FIT_WIDTH) {
        // 极端竖图触宽度下限：宽度收在 240，高度按比例回推（比例仍保持，优先形状贴合）
        shellWidth = MIN_FIT_WIDTH;
        contentHeight = shellWidth / aspect.ratio;
    }
    if (isMini) contentHeight = Math.max(contentHeight, MINI_MIN_HEIGHT);
    // 高度覆盖（仅 window 形态）：边缘/角落拖动写入（hotfix-4），覆盖期间容器显式 height、媒体 contain 显示
    const heightOverrideActive = isWindow && heightOverride !== null;
    // 容器总高：等比 = 内容区高 + 头部；覆盖 = 覆盖值本身（显式 height 语义沿用 hotfix-2）
    const containerHeight = heightOverrideActive ? heightOverride! : contentHeight + HEADER_HEIGHT;

    // 当前渲染位置：有记忆/拖动坐标则 clamp 进视口，否则锚定视口右下（右/下各 24px）
    // （下边界按容器总高 clamp，hotfix-3 起容器高含头部）
    const currentPos = pos
        ? { x: clamp(pos.x, 0, viewportW - shellWidth), y: clamp(pos.y, 0, viewportH - containerHeight) }
        : { x: Math.max(0, viewportW - shellWidth - WINDOW_MARGIN), y: Math.max(0, viewportH - containerHeight - WINDOW_MARGIN) };

    // 形态切换统一入口：reducer 切换 + 立即落盘偏好。
    // width 沿用 window 记忆宽度（mini/fab 不改写），坐标保留当前位置——恢复 window 时可直接复用。
    const changeMode = (mode: PlayerDisplayMode) => {
        setMode(mode);
        saveWindowPrefs({ x: currentPos.x, y: currentPos.y, width, mode, heightOverride: heightOverride ?? undefined });
    };

    // fab 背景：当前项缩略图（相对路径经 getAuthUrl 拼认证参数）；无缩略图或加载失败回退图标
    const fabThumbSrc = currentItem?.thumbnailUrl && !fabImageFailed ? getAuthUrl(currentItem.thumbnailUrl) : null;

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        // 真实浏览器锁定指针到抓手（jsdom 无此 API，可选调用）
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragRef.current = { px: e.clientX, py: e.clientY, ox: currentPos.x, oy: currentPos.y };
        // 会话开始：禁用 layout 补间（手势起止各一次渲染，move 不触发）
        setIsInteracting(true);
        e.preventDefault();
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        // hotfix-3：直写 DOM——起点增量 + clamp（与渲染公式同源），不 setState；
        // 交互期零重渲染，位置即时跟手，落库延迟到 pointerup
        const el = windowRef.current;
        if (el) {
            el.style.left = `${clamp(drag.ox + (e.clientX - drag.px), 0, viewportW - shellWidth)}px`;
            el.style.top = `${clamp(drag.oy + (e.clientY - drag.py), 0, viewportH - containerHeight)}px`;
        }
    };

    const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        // hotfix-3：pointerup 一次性同步 React 状态（与直写值一致，无视觉跳变）并落库
        // （clamp 后的位置 + 当前宽度/高度覆盖与形态写入偏好，写入失败由 saveWindowPrefs 静默忽略）
        const x = clamp(drag.ox + (e.clientX - drag.px), 0, viewportW - shellWidth);
        const y = clamp(drag.oy + (e.clientY - drag.py), 0, viewportH - containerHeight);
        setPos({ x, y });
        setIsInteracting(false);
        saveWindowPrefs({ x, y, width, mode: displayMode, heightOverride: heightOverride ?? undefined });
    };

    // 边缘 resize 会话（hotfix-2，hotfix-4 起标准窗口语义）：与拖动同款三段式——起点指针 + 起点尺寸，
    // move/up 都从起点增量推算，避免闭包读到过期状态。三个抓手各自独立会话：
    // 右缘只改宽（高度锁定起点渲染总高）；右下角宽高各自独立跟随（+dx/+dy，互不推导）；下缘只改高。
    // hotfix-3：move 期直写 DOM 不 setState，pointerup 才同步状态并落盘。
    const rightResizeRef = useRef<{ px: number; startWidth: number; startHeight: number } | null>(null);
    const cornerResizeRef = useRef<{ px: number; py: number; startWidth: number; startHeight: number } | null>(null);
    const vResizeRef = useRef<{ py: number; startHeight: number } | null>(null);

    const startResize = (e: React.PointerEvent<HTMLDivElement>, kind: 'right' | 'corner' | 'bottom') => {
        if (e.button !== 0) return;
        // 阻断冒泡：边缘抓手不得触发头部拖动等父级 pointer 逻辑
        e.stopPropagation();
        e.preventDefault();
        // 真实浏览器锁定指针到抓手（jsdom 无此 API，可选调用）
        e.currentTarget.setPointerCapture?.(e.pointerId);
        if (kind === 'right') {
            rightResizeRef.current = { px: e.clientX, startWidth: shellWidth, startHeight: containerHeight };
        } else if (kind === 'corner') {
            cornerResizeRef.current = { px: e.clientX, py: e.clientY, startWidth: shellWidth, startHeight: containerHeight };
        } else {
            vResizeRef.current = { py: e.clientY, startHeight: containerHeight };
        }
        setIsInteracting(true);
    };

    // 右缘：宽度自由变化（起点 + dx，clamp [280, 视口宽-48]）；高度直写为锁定值（起点容器渲染总高），
    // 不再按 宽/ratio+44 推导——宽度变化后高度保持不变（hotfix-4 自由缩放语义）
    const applyRightResize = (clientX: number, session: { px: number; startWidth: number; startHeight: number }) => {
        const nextWidth = clamp(session.startWidth + (clientX - session.px), MIN_WIDTH, maxWidth);
        const el = windowRef.current;
        if (el) {
            el.style.width = `${nextWidth}px`;
            el.style.height = `${session.startHeight}px`;
        }
        return nextWidth;
    };

    const finishRightResize = (e: React.PointerEvent<HTMLDivElement>) => {
        const session = rightResizeRef.current;
        if (!session) return;
        rightResizeRef.current = null;
        const nextWidth = applyRightResize(e.clientX, session);
        // pointerup：宽度写入记忆；高度覆盖锁定为起点渲染总高（后续宽度变化不再触发比例重算）
        setWidth(nextWidth);
        setHeightOverride(session.startHeight);
        setIsInteracting(false);
        saveWindowPrefs({ x: currentPos.x, y: currentPos.y, width: nextWidth, mode: displayMode, heightOverride: session.startHeight });
    };

    // 右下角：宽高各自独立跟随（宽 = 起点 + dx，高 = 起点 + dy），互不推导、不锁比例（hotfix-4）
    const applyCornerResize = (
        clientX: number,
        clientY: number,
        session: { px: number; py: number; startWidth: number; startHeight: number },
    ) => {
        const nextWidth = clamp(session.startWidth + (clientX - session.px), MIN_WIDTH, maxWidth);
        const nextHeight = clamp(session.startHeight + (clientY - session.py), MIN_SHELL_HEIGHT, viewportH - WINDOW_MARGIN);
        const el = windowRef.current;
        if (el) {
            el.style.width = `${nextWidth}px`;
            el.style.height = `${nextHeight}px`;
        }
        return { width: nextWidth, height: nextHeight };
    };

    const finishCornerResize = (e: React.PointerEvent<HTMLDivElement>) => {
        const session = cornerResizeRef.current;
        if (!session) return;
        cornerResizeRef.current = null;
        const { width: nextWidth, height: nextHeight } = applyCornerResize(e.clientX, e.clientY, session);
        // pointerup：宽高一次性同步状态（与直写值一致）+ 落盘
        setWidth(nextWidth);
        setHeightOverride(nextHeight);
        setIsInteracting(false);
        saveWindowPrefs({ x: currentPos.x, y: currentPos.y, width: nextWidth, mode: displayMode, heightOverride: nextHeight });
    };

    // 双击右缘/右下角：清除高度覆盖回等比模式（容器高 = 宽/媒体比例 + 头部 44），并同步落盘
    const resetHeightOverride = () => {
        setHeightOverride(null);
        saveWindowPrefs({ x: currentPos.x, y: currentPos.y, width, mode: displayMode, heightOverride: undefined });
    };

    const applyVResize = (clientY: number, session: { py: number; startHeight: number }) => {
        // 高度 = 起点容器高 + 垂直位移，clamp [120, 视口高-边距]；覆盖生效期间容器高度固定（媒体 contain）
        const next = clamp(session.startHeight + (clientY - session.py), MIN_SHELL_HEIGHT, viewportH - WINDOW_MARGIN);
        // hotfix-3：直写 DOM 高度（等比模式本就不写 aspectRatio，覆盖即显式 height 生效）
        const el = windowRef.current;
        if (el) {
            el.style.height = `${next}px`;
        }
        return next;
    };

    const finishVResize = (e: React.PointerEvent<HTMLDivElement>) => {
        const session = vResizeRef.current;
        if (!session) return;
        vResizeRef.current = null;
        const next = applyVResize(e.clientY, session);
        // pointerup：一次性同步状态（与直写值一致）+ 落盘覆盖
        setHeightOverride(next);
        setIsInteracting(false);
        saveWindowPrefs({ x: currentPos.x, y: currentPos.y, width, mode: displayMode, heightOverride: next });
    };

    // window 形态头部控制栏按钮（完整画廊控制栏：导航/收藏/信息/全屏占位 + 收起 mini/fab + 关闭）。
    // 以 currentItem 守卫构造：hotfix-2 起关闭后（isOpen=false）调度层回落渲染 PlayerWindow 一帧，
    // 此时 currentItem 为 null，而收藏按钮 JSX 使用了 currentItem! 断言，无条件构造会直接崩溃。
    const windowControls = currentItem && (
        <div className="flex shrink-0 items-center gap-0.5">
            {/* 队列导航：沿用原边界隐藏逻辑（首项隐藏上一处、末项隐藏下一处） */}
            {state.index > 0 && (
                <button
                    title="Previous"
                    onClick={() => prev()}
                    className="p-1.5 rounded-full text-white/70 transition-colors hover:bg-white/10"
                >
                    <Icons.Back size={18} />
                </button>
            )}
            {state.index < state.items.length - 1 && (
                <button
                    title="Next"
                    onClick={() => next()}
                    className="rotate-180 p-1.5 rounded-full text-white/70 transition-colors hover:bg-white/10"
                >
                    <Icons.Back size={18} />
                </button>
            )}
            {onToggleFavorite && (
                <button
                    title="Toggle Favorite"
                    onClick={(e) => { e.stopPropagation(); onToggleFavorite(currentItem!, 'file'); }}
                    className={`p-1.5 rounded-full transition-colors ${currentItem!.isFavorite ? 'text-red-500 hover:bg-white/10' : 'text-white/70 hover:bg-white/10'}`}
                >
                    <Icons.Heart size={18} fill={currentItem!.isFavorite ? 'currentColor' : 'none'} />
                </button>
            )}
            <button
                title="File Info"
                onClick={(e) => { e.stopPropagation(); onToggleInfo(); }}
                className={`p-1.5 rounded-full transition-colors ${showInfo ? 'bg-white/20' : 'hover:bg-white/10'}`}
            >
                <Icons.Info size={18} />
            </button>
            {/* 全屏（Task D）：切到独占全屏形态。仅 setMode 切状态，不落盘偏好
                （fullscreen 不作为持久形态，loadWindowPrefs 载入时已归一化为 window）；
                requestFullscreen 由 PlayerFullscreen 的宿主 effect 承接 */}
            <button
                data-testid="player-fullscreen-btn"
                title="Full Screen"
                onClick={(e) => { e.stopPropagation(); setMode('fullscreen'); }}
                className="p-1.5 rounded-full text-white/70 transition-colors hover:bg-white/10"
            >
                <Icons.Maximize size={18} />
            </button>
            {/* 收起为 mini / fab：形态偏好即刻落盘 */}
            <button
                title="Mini Mode"
                onClick={(e) => { e.stopPropagation(); changeMode('mini'); }}
                className="p-1.5 rounded-full text-white/70 transition-colors hover:bg-white/10"
            >
                <Icons.Minus size={18} />
            </button>
            <button
                title="FAB Mode"
                onClick={(e) => { e.stopPropagation(); changeMode('fab'); }}
                className="p-1.5 rounded-full text-white/70 transition-colors hover:bg-white/10"
            >
                <Icons.ChevronDown size={18} />
            </button>
            <button
                data-testid="player-window-close"
                title="Close"
                onClick={(e) => { e.stopPropagation(); close(); }}
                className="p-1.5 rounded-full text-white/70 transition-colors hover:bg-white/10"
            >
                <Icons.Close size={18} />
            </button>
        </div>
    );

    // mini 形态头部：仅展开回 window 与关闭的最小控制（画廊式控制栏隐藏）
    const miniControls = (
        <div className="flex shrink-0 items-center gap-0.5">
            <button
                title="Restore Window"
                onClick={(e) => { e.stopPropagation(); changeMode('window'); }}
                className="p-1.5 rounded-full text-white/70 transition-colors hover:bg-white/10"
            >
                <Icons.Maximize size={18} />
            </button>
            <button
                data-testid="player-window-close"
                title="Close"
                onClick={(e) => { e.stopPropagation(); close(); }}
                className="p-1.5 rounded-full text-white/70 transition-colors hover:bg-white/10"
            >
                <Icons.Close size={18} />
            </button>
        </div>
    );

    return (
        <AnimatePresence mode="popLayout">
            {/* window/mini：同 key 容器——形态切换不卸载（媒体子树跨形态保持，video 不重载），
                尺寸/内容差异由 framer-motion layout 形变过渡；退出动画期间 currentItem 为 null 自动收敛为不渲染 */}
            {state.isOpen && currentItem && aspect && !isFab && (
                <motion.div
                    key="player-window"
                    ref={windowRef}
                    data-testid="player-window"
                    data-mode={displayMode}
                    // hotfix-3：交互会话期间禁用 layout 补间（直写样式全权接管，pointerup 的 setState
                    // 不会触发位置/尺寸补间）；会话结束恢复，形态切换 window↔mini 动画不受影响
                    layout={!isInteracting}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ duration: 0.25, ease: 'easeOut' }}
                    className="fixed z-40 pointer-events-auto flex flex-col overflow-hidden text-white glass-1 gallery-toolbar-glass rounded-2xl border border-white/5 shadow-2xl"
                    style={{
                        left: currentPos.x,
                        top: currentPos.y,
                        width: `${shellWidth}px`,
                        // hotfix-3：显式高度公式——等比模式容器高 = 内容区高(宽/媒体比例) + 头部 44，
                        // 内容区正好贴合媒体比例（不写 aspectRatio，消除含头部整容器的比例误差留白）；
                        // 高度覆盖期间容器高即覆盖值（媒体 contain）
                        height: `${containerHeight}px`,
                    }}
                >
                    {/* 头部：抓手（标题区）+ 控制栏。拖动仅绑定在标题抓手区域，按钮区不受影响 */}
                    <div className="relative z-50 flex h-11 shrink-0 items-center gap-1 border-b border-white/10 bg-white/5 px-2">
                        <div
                            data-testid="player-window-handle"
                            title="拖动移动窗口"
                            className="flex min-w-0 flex-1 cursor-move select-none touch-none flex-col justify-center py-1"
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={finishDrag}
                            onPointerCancel={finishDrag}
                        >
                            <span className="truncate text-sm font-medium">{currentItem.name}</span>
                            {/* mini 窗体空间有限，仅 window 显示路径副标题 */}
                            {!isMini && <span className="truncate text-[10px] opacity-60">{currentItem.folderPath || 'Root'}</span>}
                        </div>
                        {isWindow ? windowControls : miniControls}
                    </div>

                    {/* 内容区：媒体 contain 显示。图片面板（含缩放/幻灯片按钮）以 absolute inset-0 铺满本区域，
                        视频面板 w-full h-full 铺满；两者内部 transform/gesture 逻辑不变。
                        信息面板仅在 window 形态渲染（mini 只保留媒体，fab 无内容区）。 */}
                    <div className="relative min-h-0 flex-1 bg-black/50">
                        {currentItem.mediaType === 'video' ? (
                            <VideoPane item={currentItem} />
                        ) : currentItem.mediaType === 'image' ? (
                            <ImageViewPane item={currentItem} onSlideNext={next} />
                        ) : null}
                        {isWindow && infoPanel}
                    </div>

                    {/* 边缘 resize 抓手（hotfix-2，hotfix-4 起三向自由缩放，仅 window 形态）：右缘拖宽（高度锁定
                        起点渲染总高）、右下角宽高独立跟随、下缘拖高写覆盖；双击右缘/右下角回等比自适应。
                        抓手置于内容区之后保证可命中；stopPropagation 避免触发头部拖动。
                        mini 固定 240 宽、fab 无窗体，均不渲染抓手。 */}
                    {isWindow && (
                        <>
                            <div
                                data-testid="player-resize-right"
                                className="absolute right-0 top-0 bottom-0 z-50 w-1.5 cursor-ew-resize touch-none"
                                onPointerDown={(e) => startResize(e, 'right')}
                                onPointerMove={(e) => {
                                    if (rightResizeRef.current) applyRightResize(e.clientX, rightResizeRef.current);
                                }}
                                onPointerUp={finishRightResize}
                                onPointerCancel={finishRightResize}
                                onDoubleClick={resetHeightOverride}
                            />
                            <div
                                data-testid="player-resize-bottom"
                                className="absolute bottom-0 left-0 right-0 z-50 h-1.5 cursor-ns-resize touch-none"
                                onPointerDown={(e) => startResize(e, 'bottom')}
                                onPointerMove={(e) => {
                                    if (vResizeRef.current) applyVResize(e.clientY, vResizeRef.current);
                                }}
                                onPointerUp={finishVResize}
                                onPointerCancel={finishVResize}
                            />
                            {/* 右下角：宽高各自独立跟随（互不推导）；置于最后声明，重叠区优先命中角抓手 */}
                            <div
                                data-testid="player-resize-corner"
                                className="absolute right-0 bottom-0 z-50 w-4 h-4 cursor-nwse-resize touch-none"
                                onPointerDown={(e) => startResize(e, 'corner')}
                                onPointerMove={(e) => {
                                    if (cornerResizeRef.current) applyCornerResize(e.clientX, e.clientY, cornerResizeRef.current);
                                }}
                                onPointerUp={finishCornerResize}
                                onPointerCancel={finishCornerResize}
                                onDoubleClick={resetHeightOverride}
                            />
                        </>
                    )}
                </motion.div>
            )}

            {/* fab：与 window 互斥出现（不同 key 经 AnimatePresence 接管出入场）。
                固定右下角不可拖动；点击回 window。不包含任何暂停逻辑——音频由 AudioPlayer 承接继续播放。 */}
            {state.isOpen && currentItem && isFab && (
                <motion.button
                    key="player-fab"
                    type="button"
                    data-testid="player-fab"
                    data-mode="fab"
                    title={currentItem.name}
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    onClick={() => changeMode('window')}
                    className="fixed z-40 pointer-events-auto flex items-center justify-center overflow-hidden rounded-full border border-white/10 bg-black/60 shadow-2xl"
                    style={{ right: FAB_MARGIN, bottom: FAB_MARGIN, width: FAB_SIZE, height: FAB_SIZE }}
                >
                    {fabThumbSrc ? (
                        // key 随队列项变化：切换当前项时重挂 img 重试新缩略图（onError 回退由 fabImageFailed 承接）
                        <img
                            key={currentItem.id}
                            src={fabThumbSrc}
                            alt={currentItem.name}
                            className="h-full w-full object-cover"
                            onError={() => setFabImageFailed(true)}
                        />
                    ) : (
                        <span data-testid="player-fab-fallback" className="flex items-center justify-center text-white/80">
                            <Icons.Image size={24} />
                        </span>
                    )}
                    {/* 视频项播放角标：提示该 fab 对应可恢复播放的视频项 */}
                    {currentItem.mediaType === 'video' && (
                        <span
                            data-testid="player-fab-playing"
                            className="absolute inset-0 m-auto flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
                        >
                            <Icons.Play size={14} />
                        </span>
                    )}
                </motion.button>
            )}
        </AnimatePresence>
    );
};
