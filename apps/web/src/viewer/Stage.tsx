import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mediaUrls, type MediaItem } from '@luvia/contracts';
import { canThumb, thumbhashUrl } from '@/components/media/Thumb';
import { activeMedia, isReduceMotion, useViewerUi } from './state';
import { VideoMedia } from './VideoMedia';
import { detailQuery } from './InfoSheet';
import { Icon } from './icons';
import { MediaError } from './MediaError';
import { isQuarterTurn, type Rotation } from './rotation';
import {
  centerOn, clampPan, formatPercent, isZoomed, minimapBox, needsHigherRes, oneToOneZoom, pixelPercent, shouldPixelate,
  wheelFactor, zoomAt, zoomCentered, type Rect, type Size, type View,
} from './zoom';

const dpr = () => (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1);
/** l 档缩略图的长边约 1600px。 */
const L_EDGE = 1600;

export const thumbL = (m: MediaItem) => (canThumb(m) ? mediaUrls.thumb(m.id, 'l', m.thumbVersion) : null);
export const thumbS = (m: MediaItem) => (canThumb(m) ? mediaUrls.thumb(m.id, 's', m.thumbVersion) : undefined);

/** 缩放上下文：几何信息与上限，供手势、按钮和键盘共用。 */
export interface ZoomCtx {
  rect: Rect;
  viewport: Size;
  /** 原图宽度（像素）。 */
  mediaW: number;
  max: number;
}

/** 以 (cx, cy) 为中心在适合窗口与原始像素之间切换。 */
export function toggleZoomAt(ctx: ZoomCtx, cx: number, cy: number) {
  const ui = useViewerUi.getState();
  const nz = isZoomed(ui.view) ? 1 : oneToOneZoom(ctx.rect, ctx.mediaW);
  ui.setView(zoomAt(ui.view, ctx.rect, ctx.viewport, cx, cy, nz, ctx.max), true);
}

export function zoomStep(ctx: ZoomCtx, factor: number) {
  const ui = useViewerUi.getState();
  ui.setView(zoomCentered(ui.view, ctx.rect, ctx.viewport, ui.view.z * factor, ctx.max), true);
}

export function zoomToLevel(ctx: ZoomCtx, z: number) {
  const ui = useViewerUi.getState();
  ui.setView(zoomCentered(ui.view, ctx.rect, ctx.viewport, z, ctx.max), true);
}

interface Shown { item: MediaItem; rect: Rect; src: string | undefined; rotation: Rotation }

/**
 * 舞台：当前媒体（图片或视频）与缩放层、换图交叉淡化、指针手势（拖动、双指捏合、滑动翻页、双击/双击触摸切换缩放）、滚轮缩放与右键菜单入口。
 */
export function Stage({ item, ctx, frameRef, first, rotation, errorHint, resultUrl, showOriginal, overlay, kenBurns, onStep, onMenu, onVideoEnded }: {
  item: MediaItem;
  ctx: ZoomCtx;
  frameRef: React.RefObject<HTMLDivElement | null>;
  /** 首次显示（由打开过渡负责入场，不做淡入）。 */
  first: boolean;
  /** 顺时针旋转角度；只影响预览，不改变原文件。 */
  rotation: Rotation;
  /** 打开时已知的失败原因，原图不可读时显示。 */
  errorHint?: string;
  /** 修复结果地址；存在时替代原图显示。 */
  resultUrl?: string | null;
  /** 按住对比时显示原图。 */
  showOriginal?: boolean;
  /** 蒙版画布等编辑层，渲染在旋转容器内部。 */
  overlay?: React.ReactNode;
  kenBurns: { on: boolean; sec: number };
  onStep: (dir: 1 | -1) => void;
  onMenu: (x: number, y: number) => void;
  onVideoEnded: () => void;
}) {
  const view = useViewerUi((s) => s.view);
  const animate = useViewerUi((s) => s.animate);
  const slideshow = useViewerUi((s) => s.slideshow);
  const stageRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const isVideo = item.mediaType === 'video';
  // 后台尚未读取元数据的视频：先取详情（服务器当场读取），再决定直接播放还是转码，避免 HEVC 等格式直接播放失败
  const probing = isVideo && item.playability === null;
  const detail = useQuery({ ...detailQuery(item.id), enabled: probing });
  const video = !probing ? item : detail.data ? { ...item, playability: detail.data.playability, durationSec: detail.data.durationSec } : detail.isError ? item : null;

  // 图源：先 l 缩略图，显示尺寸超过其分辨率时换成 display 全分辨率；GIF 与无缩略图时直接用 display。
  const lUrl = thumbL(item);
  const displayUrl = mediaUrls.display(item.id, item.thumbVersion);
  const directHi = !lUrl || item.mime === 'image/gif';
  const [hi, setHi] = useState<{ id: string; ready: boolean } | null>(null);
  // l 缩略图读不出来时先退到 display，再失败才显示错误卡片；避免一次坏缓存直接判死刑。
  const [lFailed, setLFailed] = useState<{ id: string } | null>(null);
  const lFailedNow = lFailed?.id === item.id;
  const useHi = directHi || lFailedNow || (hi?.id === item.id && hi.ready);
  const src = isVideo ? lUrl ?? undefined : useHi ? displayUrl : lUrl!;
  const [nat, setNat] = useState<{ src: string; w: number } | null>(null);
  const sourceW = nat && nat.src === src ? nat.w : useHi ? ctx.mediaW : Math.min(ctx.mediaW, L_EDGE);
  const pixelated = shouldPixelate(ctx.rect, view.z, dpr(), isVideo ? ctx.mediaW : sourceW);
  const loadingHi = !isVideo && hi?.id === item.id && !hi.ready;
  const [loaded, setLoaded] = useState<string | null>(null);

  // 原图不可读：记录失败的是哪一版地址；重试换 key 让 img 重新发起请求。
  const [failed, setFailed] = useState<{ key: string } | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const srcKey = `${item.id}:${src ?? ''}:${retryKey}`;
  const showError = !isVideo && failed?.key === srcKey;
  const retry = () => { setFailed(null); setLFailed(null); setRetryKey((n) => n + 1); };
  useEffect(() => {
    useViewerUi.getState().set({ failed: showError ? item.id : null });
  }, [showError, item.id]);

  useEffect(() => {
    if (isVideo || directHi || lFailedNow || hi?.id === item.id) return;
    if (!needsHigherRes(ctx.rect, view.z, dpr(), Math.min(ctx.mediaW, nat?.src === lUrl ? nat.w : L_EDGE))) return;
    if (ctx.mediaW <= (nat?.src === lUrl ? nat.w : L_EDGE)) return; // 原图本身不比缩略图大
    const id = item.id;
    setHi({ id, ready: false });
    const im = new Image();
    im.decoding = 'async';
    im.src = displayUrl;
    im.decode().then(
      () => setHi((h) => (h?.id === id ? { id, ready: true } : h)),
      () => {
        setHi((h) => (h?.id === id ? { id, ready: false } : h));
        useViewerUi.getState().say('原图载入失败，暂时显示缩略图。可以稍后再放大试试');
      },
    );
  }, [isVideo, directHi, lFailedNow, hi?.id, item.id, ctx.rect, ctx.mediaW, view.z, nat, lUrl, displayUrl]);

  // 换图时把上一张留作淡出的“残影”。
  const lastRef = useRef<Shown | null>(null);
  const [ghost, setGhost] = useState<(Shown & { key: number }) | null>(null);
  useLayoutEffect(() => {
    const last = lastRef.current;
    if (last && last.item.id !== item.id && !isReduceMotion()) {
      setGhost({ ...last, key: Date.now() });
      const t = setTimeout(() => setGhost(null), 950);
      return () => clearTimeout(t);
    }
  }, [item.id]);
  useEffect(() => { lastRef.current = { item, rect: ctx.rect, src, rotation }; });

  // 旋转时让外框几何与内层角度一起过渡；换图复位不做这段动画，避免与交叉淡化打架。
  const prevRot = useRef({ id: item.id, rot: rotation });
  const [rotAnim, setRotAnim] = useState(false);
  useLayoutEffect(() => {
    const p = prevRot.current;
    if (p.id !== item.id) {
      prevRot.current = { id: item.id, rot: rotation };
      setRotAnim(false);
      return;
    }
    if (p.rot === rotation) return;
    prevRot.current = { id: item.id, rot: rotation };
    if (isReduceMotion()) { setRotAnim(false); return; }
    setRotAnim(true);
    const t = window.setTimeout(() => setRotAnim(false), 280);
    return () => window.clearTimeout(t);
  }, [item.id, rotation]);

  // 滚轮缩放（以光标为中心）。React 的 onWheel 是被动监听，无法阻止默认滚动，因此手动绑定。
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = ctxRef.current;
      const ui = useViewerUi.getState();
      ui.setView(zoomAt(ui.view, c.rect, c.viewport, e.clientX, e.clientY, ui.view.z * wheelFactor(e.deltaY, e.ctrlKey, e.deltaMode), c.max));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 指针手势
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const down = useRef<{ x: number; y: number; t: number; type: string } | null>(null);
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const ui = useViewerUi.getState();
    if (ui.menu) ui.set({ menu: null });
    e.currentTarget.setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...ptrs.current.values()];
    if (pts.length === 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: ui.view.z };
      drag.current = null;
      down.current = null;
    } else if (pts.length === 1) {
      drag.current = { x: e.clientX, y: e.clientY, ox: ui.view.x, oy: ui.view.y };
      down.current = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = ctxRef.current;
    const ui = useViewerUi.getState();
    const pts = [...ptrs.current.values()];
    if (pinch.current && pts.length === 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      const nz = pinch.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d);
      ui.setView(zoomAt(ui.view, c.rect, c.viewport, (a.x + b.x) / 2, (a.y + b.y) / 2, nz, c.max));
      return;
    }
    const d = drag.current;
    if (d && isZoomed(ui.view)) {
      if (!ui.dragging) ui.set({ dragging: true });
      ui.setView(clampPan({ z: ui.view.z, x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }, c.rect, c.viewport));
    }
  };

  const onPointerEnd = (e: React.PointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.delete(e.pointerId);
    const ui = useViewerUi.getState();
    if (ui.dragging) ui.set({ dragging: false });
    if (pinch.current) {
      if (ptrs.current.size < 2) pinch.current = null;
      drag.current = null;
      down.current = null;
      return;
    }
    const dn = down.current;
    drag.current = null;
    down.current = null;
    if (!dn || e.type === 'pointercancel') return;
    const dx = e.clientX - dn.x;
    const dy = e.clientY - dn.y;
    const dt = performance.now() - dn.t;
    if (!isZoomed(ui.view) && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) && dt < 600) {
      onStep(dx < 0 ? 1 : -1);
      return;
    }
    // 触摸双击：鼠标由 dblclick 处理
    if (dn.type !== 'mouse' && Math.hypot(dx, dy) < 10 && dt < 300) {
      const lt = lastTap.current;
      const now = performance.now();
      if (lt && now - lt.t < 320 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 30) {
        lastTap.current = null;
        toggleZoomAt(ctxRef.current, e.clientX, e.clientY);
      } else {
        lastTap.current = { x: e.clientX, y: e.clientY, t: now };
      }
    }
  };

  const zoomed = isZoomed(view);
  const kbOn = kenBurns.on && !zoomed && slideshow !== 'off' && !isVideo && !isReduceMotion();
  const placeholder = thumbhashUrl(item);
  const r = ctx.rect;
  const quarter = isQuarterTurn(rotation);
  const innerW = quarter ? r.h : r.w;
  const innerH = quarter ? r.w : r.h;
  const ghostQuarter = ghost ? isQuarterTurn(ghost.rotation) : false;

  return (
    <div
      ref={stageRef}
      className="lv-stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onDoubleClick={(e) => toggleZoomAt(ctxRef.current, e.clientX, e.clientY)}
      onContextMenu={(e) => {
        if (e.shiftKey) return; // 按住 Shift 时保留浏览器自带菜单
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
    >
      {ghost && (
        <div key={ghost.key} className="lv-frame lv-ghost" aria-hidden style={{ left: ghost.rect.x, top: ghost.rect.y, width: ghost.rect.w, height: ghost.rect.h }}>
          <div className="lv-zoom">
            <div
              className="lv-rot"
              style={{
                width: ghostQuarter ? ghost.rect.h : ghost.rect.w,
                height: ghostQuarter ? ghost.rect.w : ghost.rect.h,
                transform: `rotate(${ghost.rotation}deg)`,
              }}
            >
              {ghost.src && <img src={ghost.src} alt="" draggable={false} />}
            </div>
          </div>
        </div>
      )}
      <div
        key={item.id}
        ref={frameRef}
        className={`lv-frame${first ? '' : ' lv-fin'}${rotAnim ? ' lv-rot-anim' : ''}`}
        style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
      >
        <div className={kbOn ? 'lv-kb on' : 'lv-kb'} style={{ '--kbd': `${kenBurns.sec}s` } as React.CSSProperties}>
          <div
            className={animate ? 'lv-zoom anim' : 'lv-zoom'}
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}
          >
            {(!showError || !!resultUrl) && (
              <div
                className="lv-rot"
                style={{
                  width: innerW,
                  height: innerH,
                  transform: `rotate(${rotation}deg)`,
                  backgroundImage: !resultUrl && placeholder && loaded !== item.id ? `url(${placeholder})` : undefined,
                }}
              >
                {resultUrl && !showOriginal ? (
                  <img
                    src={resultUrl}
                    alt={item.name}
                    draggable={false}
                    className={pixelated ? 'px' : undefined}
                    onError={() => useViewerUi.getState().say('修复结果加载失败，请重新生成')}
                  />
                ) : isVideo ? (
                  !video || video.playability === 'unsupported' ? (
                    src && <img src={src} alt={item.name} draggable={false} />
                  ) : (
                    <VideoMedia
                      item={video}
                      poster={src}
                      autoPlay={slideshow === 'playing'}
                      pixelated={pixelated}
                      onEnded={onVideoEnded}
                      onMeasured={(w, h) => {
                        setLoaded(item.id);
                        if (!item.width || !item.height) useViewerUi.getState().set({ measured: { id: item.id, w, h } });
                      }}
                    />
                  )
                ) : (
                  <img
                    ref={(el) => { activeMedia.image = el; }}
                    src={src}
                    alt={item.name}
                    draggable={false}
                    decoding="async"
                    className={pixelated ? 'px' : undefined}
                    onLoad={(e) => {
                      const im = e.currentTarget;
                      setNat({ src: im.currentSrc || im.src, w: im.naturalWidth });
                      setLoaded(item.id);
                      if ((!item.width || !item.height) && useHi) useViewerUi.getState().set({ measured: { id: item.id, w: im.naturalWidth, h: im.naturalHeight } });
                    }}
                    onError={() => {
                      // 缩略图失败先换 display 全分辨率；两者都失败才展示错误卡片。
                      if (!useHi && lUrl) { setLFailed({ id: item.id }); return; }
                      setFailed({ key: srcKey });
                    }}
                  />
                )}
                {overlay}
              </div>
            )}
          </div>
        </div>
      </div>
      {showError && !resultUrl && <MediaError item={item} hint={errorHint} onRetry={retry} />}
      <div className={loadingHi ? 'lv-chip show' : 'lv-chip'} aria-hidden={!loadingHi}>正在载入原图</div>
    </div>
  );
}

/** 小地图：缩放后显示整图与当前视口，点击或拖动可跳转。 */
export function Minimap({ item, ctx, rotation }: { item: MediaItem; ctx: ZoomCtx; rotation: Rotation }) {
  const view = useViewerUi((s) => s.view);
  const box = minimapBox(view, ctx.rect, ctx.viewport);
  const quarter = isQuarterTurn(rotation);
  const jump = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const fy = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const ui = useViewerUi.getState();
    ui.setView(centerOn(ui.view, ctx.rect, ctx.viewport, fx, fy));
  };
  return (
    <div
      className="lv-mini"
      aria-hidden
      style={{ aspectRatio: `${ctx.rect.w} / ${ctx.rect.h}` }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); jump(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) jump(e); }}
    >
      <div
        className="lv-mini-rot"
        style={{
          width: quarter ? `${(ctx.rect.h / ctx.rect.w) * 100}%` : '100%',
          height: quarter ? `${(ctx.rect.w / ctx.rect.h) * 100}%` : '100%',
          transform: `rotate(${rotation}deg)`,
        }}
      >
        {thumbS(item) && <img src={thumbS(item)} alt="" draggable={false} />}
      </div>
      <i style={{ left: `${box.left * 100}%`, top: `${box.top * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }} />
    </div>
  );
}

/** 缩放 HUD：缩小、百分比（在适合窗口与原始像素之间切换）、放大、适合。 */
export function ZoomHud({ ctx }: { ctx: ZoomCtx }) {
  const view = useViewerUi((s) => s.view);
  const pct = pixelPercent(view, ctx.rect, ctx.mediaW);
  const atOne = Math.abs(pct - 100) < 1;
  return (
    <div className="lv-zhud" role="group" aria-label="缩放">
      <button type="button" aria-label="缩小" onClick={() => zoomStep(ctx, 1 / 1.6)}><Icon name="minus" /></button>
      <button
        type="button"
        className="pct"
        title="在适合窗口与原始像素之间切换"
        aria-label={`当前 ${formatPercent(pct)}，在适合窗口与原始像素之间切换`}
        onClick={() => zoomToLevel(ctx, atOne && isZoomed(view) ? 1 : oneToOneZoom(ctx.rect, ctx.mediaW))}
      >
        {formatPercent(pct)}
      </button>
      <button type="button" aria-label="放大" onClick={() => zoomStep(ctx, 1.6)}><Icon name="plus" /></button>
      <button type="button" onClick={() => zoomToLevel(ctx, 1)}>适合</button>
    </div>
  );
}
