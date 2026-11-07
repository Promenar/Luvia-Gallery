import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { mediaUrls, type EditorModelId, type MediaItem } from '@luvia/contracts';
import { call, ApiError, type CallOptions } from '@/lib/api';
import { invalidate, q, queryClient } from '@/lib/query';
import { useIsAdmin, usePreferences, useUpdatePreferences } from '@/stores/session';
import { useViewer, type ViewerScope } from '@/stores/viewer';
import { setDynamicFrom } from '@/theme/ThemeProvider';
import { thumbhashUrl } from '@/components/media/Thumb';
import { canWriteImage, clipboardFailMessage, copyImageToClipboard, copyTextToClipboard, triggerDownload } from './clipboard';
import { ContextMenu, type MenuAction } from './ContextMenu';
import { DeleteConfirm } from './DeleteConfirm';
import { Filmstrip } from './Filmstrip';
import { Icon } from './icons';
import { detailQuery, InfoSheet } from './InfoSheet';
import { EditorDock } from './editor/EditorDock';
import { MaskCanvas, type MaskCanvasHandle } from './editor/MaskCanvas';
import { SaveCopyDialog } from './editor/SaveCopyDialog';
import { useEditorJob } from './editor/useEditorJob';
import { nextRotation, rotatedSize, rotationLabel, type Rotation } from './rotation';
import {
  buildOrder, counterText, dedupe, excludeIds, extendOrder, filePath, formatTakenAt, removeFromOrder, reorder, shouldLoadMore, step,
} from './sequence';
import { Minimap, Stage, thumbL, thumbS, ZoomHud, zoomStep, zoomToLevel, type ZoomCtx } from './Stage';
import { activeMedia, isReduceMotion, useViewerUi } from './state';
import { VideoControls } from './VideoMedia';
import { clampPan, FIT_VIEW, fitRect, MOBILE_BREAKPOINT, isZoomed, maxZoom, oneToOneZoom, originTransform, panBy, zoomAt, type Rect } from './zoom';
import './viewer.css';

const INTERVALS = [3, 5, 8, 15, 30] as const;
const EASE = 'cubic-bezier(.2, .8, .2, 1)';
const errText = (e: unknown) => (e instanceof Error && e.message ? e.message : '网络连接中断');

function useViewportSize() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const on = () => setVp(read());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return vp;
}

const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height });
const onScreen = (r: DOMRect) => r.width > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;

/** 全屏查看器。由 AppShell 在 useViewer().open 时渲染；播放范围来自 stores/viewer.ts。 */
export function Viewer() {
  const scope = useViewer((s) => s.scope);
  const close = useViewer((s) => s.close);
  const empty = !scope || scope.items.length === 0;
  useEffect(() => { if (empty) close(); }, [empty, close]);
  if (empty) return null;
  return <ViewerDialog scope={scope} />;
}

function ViewerDialog({ scope }: { scope: ViewerScope }) {
  const index = useViewer((s) => s.index);
  const options = useViewer((s) => s.options);
  const prefs = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const isAdmin = useIsAdmin();
  const editor = useEditorJob();
  const capsQuery = useQuery({ ...q('editorCapabilities'), enabled: isAdmin, staleTime: 30_000 });
  const models = capsQuery.data?.models ?? [];
  const availableModels = models.filter((model) => model.available);
  const navigate = useNavigate();
  const vp = useViewportSize();
  const mobile = vp.w < MOBILE_BREAKPOINT;

  const pos = useViewerUi((s) => s.pos);
  const order = useViewerUi((s) => s.order);
  const slideshow = useViewerUi((s) => s.slideshow);
  const info = useViewerUi((s) => s.info);
  const idle = useViewerUi((s) => s.idle);
  const menu = useViewerUi((s) => s.menu);
  const dragging = useViewerUi((s) => s.dragging);
  const measured = useViewerUi((s) => s.measured);
  const zoomed = useViewerUi((s) => isZoomed(s.view));
  const failedId = useViewerUi((s) => s.failed);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorModel, setEditorModel] = useState<EditorModelId>('migan');
  const [brush, setBrush] = useState(18);
  const [erase, setErase] = useState(false);
  const [hasMask, setHasMask] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedCopy, setSavedCopy] = useState<string | null>(null);
  const [mobileEditOpen, setMobileEditOpen] = useState(false);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);

  const items = scope.items;
  const item: MediaItem = items[index] ?? items[0]!;
  const isVideo = item.mediaType === 'video';
  const imgFailed = failedId === item.id;
  const canDelete = isAdmin && !!item.source;
  const canEdit = !isVideo || canDelete;
  const {
    job: editorJob, create: createEditorJob, cancel: cancelEditorJob, reset: resetEditorJob,
    saveCopy: saveEditorCopy, createPending: editorPending, createError: editorCreateError, queryError: editorQueryError,
    busy: editorBusy,
  } = editor;
  const canRepair = isAdmin && !isVideo && availableModels.length > 0;
  const activeModel = models.find((model) => model.id === editorModel) ?? null;
  const maskLimit = capsQuery.data?.mask ?? null;
  const modelTooLarge = !!(activeModel?.maxPixels && item.width && item.height && item.width * item.height > activeModel.maxPixels);
  const resultUrl = editorJob?.status === 'succeeded' ? editorJob.resultUrl : null;
  const editorError = editorCreateError ?? editorQueryError ?? editorJob?.error ?? null;
  const canGenerate = !!item.width && !!item.height && !!maskLimit && hasMask && !modelTooLarge;
  const generateHint = !item.width || !item.height ? '原图尺寸未知，暂时无法修复'
    : !maskLimit ? '正在读取编辑器能力…'
      : modelTooLarge ? '图片超过该模型的输入上限'
        : !hasMask ? '先涂抹要修复的区域'
          : null;
  const extMatch = /\.[^.]+$/.exec(item.name);
  const originalExt = (extMatch?.[0] ?? '').toLowerCase();
  const saveExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(originalExt) ? originalExt : '.png';
  const saveDefaultName = `${item.name.slice(0, item.name.length - (extMatch?.[0]?.length ?? 0)) || '修复副本'}-修复${saveExt}`;
  useEffect(() => {
    if (!availableModels.length) return;
    if (!availableModels.some((model) => model.id === editorModel)) setEditorModel(availableModels[0]!.id);
  }, [availableModels, editorModel]);
  useEffect(() => {
    setDeleteOpen(false);
    setDeleteError(null);
    deleteOpRef.current = null;
    setEditorOpen(false);
    setHasMask(false);
    setComparing(false);
    setSaveOpen(false);
    setSaveError(null);
    setSavedCopy(null);
    setMobileEditOpen(false);
    resetEditorJob();
  }, [item.id, resetEditorJob]);

  // 几何
  const [rotationState, setRotationState] = useState<{ id: string; deg: Rotation } | null>(null);
  const rotation: Rotation = rotationState?.id === item.id ? rotationState.deg : 0;
  const [rotHint, setRotHint] = useState<string | null>(null);
  useEffect(() => {
    if (!rotHint) return;
    const t = window.setTimeout(() => setRotHint(null), 1200);
    return () => window.clearTimeout(t);
  }, [rotHint]);

  const base = item.width && item.height
    ? { w: item.width, h: item.height }
    : measured?.id === item.id ? { w: measured.w, h: measured.h } : { w: 1600, h: 1200 };
  const dims = rotatedSize(base.w, base.h, rotation);
  const rect = useMemo(() => fitRect(dims, vp, { info }), [dims.w, dims.h, vp, info]);
  const ctx: ZoomCtx = useMemo(() => ({ rect, viewport: vp, mediaW: dims.w, max: maxZoom(rect, dims.w) }), [rect, vp, dims.w]);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  // 最新值引用（供事件回调使用）
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const itemRef = useRef(item);
  itemRef.current = item;
  const firstIdRef = useRef<string | null>(null);
  const openIndexRef = useRef(index);
  const deleteOpRef = useRef<string | null>(null);
  const maskRef = useRef<MaskCanvasHandle>(null);

  const say = useViewerUi.getState().say;

  // ---------- 会话初始化：每次 openViewer 都会产生新的 options 对象 ----------
  useLayoutEffect(() => {
    const st = useViewer.getState();
    const sc = st.scope;
    if (!sc) return;
    const ui = useViewerUi.getState();
    const shuffle = !sc.random && (!!options.shuffle || (!!options.play && prefsRef.current.slideshow.order === 'shuffle'));
    const { order: o, pos: p } = buildOrder(sc.items.length, st.index, shuffle);
    ui.reset();
    ui.set({ order: o, pos: p, shuffled: shuffle, slideshow: options.play ? 'playing' : 'off' });
    openIndexRef.current = o[p] ?? 0;
    firstIdRef.current = sc.items[o[p] ?? 0]?.id ?? null;
    if (o[p] !== st.index && o[p] != null) st.setIndex(o[p]);
    if (options.play) say(startText(sc, shuffle, prefsRef.current.slideshow.intervalSec));
  }, [options]);

  useEffect(() => () => useViewerUi.getState().reset(), []);

  // ---------- 打开：模态对话框 + 从缩略图放大 ----------
  useLayoutEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (!dlg.open) dlg.showModal();
    dlg.focus({ preventScroll: true });
    if (isReduceMotion()) return;
    const anims: Animation[] = [];
    const fade = [{ opacity: 0 }, { opacity: 1 }];
    if (baseRef.current) anims.push(baseRef.current.animate(fade, { duration: 320, easing: 'ease' }));
    if (chromeRef.current) anims.push(chromeRef.current.animate(fade, { duration: 320, delay: 120, easing: 'ease', fill: 'backwards' }));
    const origin = options.originEl;
    const frame = frameRef.current;
    if (frame && origin?.isConnected) {
      const a = origin.getBoundingClientRect();
      if (onScreen(a)) {
        const t = originTransform(toRect(a), ctxRef.current.rect);
        anims.push(frame.animate(
          [{ transform: t.transform, clipPath: t.clipPath }, { transform: 'none', clipPath: 'inset(0px 0px round 0px)' }],
          { duration: 420, easing: EASE },
        ));
      }
    }
    return () => anims.forEach((x) => x.cancel());
  }, []);

  // ---------- 关闭：反向过渡后卸载，焦点回到原缩略图 ----------
  const requestClose = useCallback((animate = true) => {
    const ui = useViewerUi.getState();
    if (ui.closing) return;
    activeMedia.video?.pause();
    ui.set({ closing: true, menu: null, slideshow: 'off', idle: false, view: FIT_VIEW, animate: false });
    const origin = useViewer.getState().options.originEl ?? null;
    const finish = () => {
      dialogRef.current?.close();
      useViewer.getState().close();
      if (origin?.isConnected) origin.focus({ preventScroll: true });
    };
    if (!animate || isReduceMotion()) { finish(); return; }
    const anims: Animation[] = [];
    const out = [{ opacity: 1 }, { opacity: 0 }];
    if (baseRef.current) anims.push(baseRef.current.animate(out, { duration: 300, easing: 'ease', fill: 'forwards' }));
    if (chromeRef.current) anims.push(chromeRef.current.animate(out, { duration: 180, easing: 'ease', fill: 'forwards' }));
    const frame = frameRef.current;
    const sameItem = useViewer.getState().index === openIndexRef.current;
    const a = origin?.isConnected ? origin.getBoundingClientRect() : null;
    if (frame) {
      if (sameItem && a && onScreen(a)) {
        const t = originTransform(toRect(a), ctxRef.current.rect);
        anims.push(frame.animate(
          [{ transform: 'none', clipPath: 'inset(0px 0px round 0px)' }, { transform: t.transform, clipPath: t.clipPath }],
          { duration: 360, easing: EASE, fill: 'forwards' },
        ));
      } else {
        anims.push(frame.animate([{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.96 }], { duration: 240, easing: 'ease', fill: 'forwards' }));
      }
    }
    let done = false;
    const once = () => { if (!done) { done = true; finish(); } };
    Promise.all(anims.map((x) => x.finished)).then(once, once);
    setTimeout(once, 600);
  }, []);

  // ---------- 浏览顺序与续页 ----------
  const pendingRef = useRef(false);
  const loadingRef = useRef(false);
  const exhaustedRef = useRef(false);

  const canLoadMore = () => {
    const s = useViewer.getState().scope;
    if (!s) return false;
    if (s.random) return !exhaustedRef.current;
    return !!(s.query && s.nextCursor);
  };

  const goPos = useCallback((p: number) => {
    const ui = useViewerUi.getState();
    const idx = ui.order[p];
    if (idx == null) return;
    ui.set({ pos: p, view: FIT_VIEW, animate: false, menu: null });
    useViewer.getState().setIndex(idx);
  }, []);

  const loadMore = useCallback(async () => {
    const s = useViewer.getState().scope;
    if (!s || loadingRef.current) return;
    loadingRef.current = true;
    try {
      if (s.random) {
        type RQ = NonNullable<CallOptions<'randomMedia'>['query']>;
        const base = s.random as RQ;
        const ex = excludeIds(s.items, 500);
        let got = dedupe(s.items.slice(-500), (await call('randomMedia', { query: { ...base, count: 24, exclude: ex } })).items);
        if (!got.length) {
          // 范围内的媒体都已播过：放开排除，只避开最近几项
          got = dedupe(s.items.slice(-10), (await call('randomMedia', { query: { ...base, count: 24 } })).items);
        }
        if (!got.length) exhaustedRef.current = true;
        else useViewer.getState().appendItems(got, s.nextCursor ?? null);
      } else if (s.query && s.nextCursor) {
        const page = await call('listMedia', { query: { ...s.query, cursor: s.nextCursor } });
        useViewer.getState().appendItems(dedupe(s.items, page.items), page.nextCursor);
      }
    } catch (e) {
      say(`后续内容加载失败：${errText(e)}。稍后翻页会自动重试`);
      pendingRef.current = false;
    } finally {
      loadingRef.current = false;
      if (pendingRef.current && !canLoadMore()) {
        // 加载完毕但没有新项：按到头处理
        pendingRef.current = false;
        advanceRef.current(1, useViewerUi.getState().slideshow === 'playing');
      }
    }
  }, []);

  // 新项追加到顺序末尾；等待中的翻页随之推进
  useEffect(() => {
    const ui = useViewerUi.getState();
    if (!ui.order.length || ui.order.length >= items.length) return;
    ui.set({ order: extendOrder(ui.order, items.length, ui.shuffled) });
    if (pendingRef.current) {
      pendingRef.current = false;
      goPos(ui.pos + 1);
    }
  }, [items.length, goPos]);

  // 接近已加载末尾时预取
  useEffect(() => {
    if (order.length && shouldLoadMore(pos, order.length) && canLoadMore()) void loadMore();
  }, [pos, order.length, loadMore]);

  const stopSlideshow = useCallback(() => {
    useViewerUi.getState().set({ slideshow: 'off', idle: false });
  }, []);

  /** 翻页。auto=true 为幻灯片自动推进（遵循 loop）。 */
  const advance = useCallback((dir: 1 | -1, auto = false) => {
    const ui = useViewerUi.getState();
    if (ui.closing) return;
    const r = step(ui.pos, ui.order.length, dir, { auto, loop: prefsRef.current.slideshow.loop, canLoadMore: canLoadMore() });
    if (r.kind === 'go') goPos(r.pos);
    else if (r.kind === 'wait') { pendingRef.current = true; void loadMore(); }
    else if (r.kind === 'end') { stopSlideshow(); say('已经播放到最后一项'); }
  }, [goPos, loadMore, stopSlideshow]);
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // ---------- 换图副作用 ----------
  useEffect(() => { setDynamicFrom(item); }, [item.id]);
  useEffect(() => {
    // 预载前后两项的 l 缩略图，翻页时立即可见
    const ui = useViewerUi.getState();
    for (const d of [1, -1, 2]) {
      const m = items[ui.order[ui.pos + d] ?? -1];
      const u = m && thumbL(m);
      if (u) { const im = new Image(); im.src = u; }
    }
  }, [pos, items]);

  // 布局变化：信息栏开关时回到适合窗口，窗口尺寸变化时重新约束平移
  useEffect(() => { useViewerUi.getState().setView(FIT_VIEW); }, [info]);
  useEffect(() => {
    const ui = useViewerUi.getState();
    if (isZoomed(ui.view)) ui.setView(clampPan(ui.view, ctxRef.current.rect, ctxRef.current.viewport));
  }, [vp]);

  // ---------- 幻灯片 ----------
  const startSlideshow = useCallback(() => {
    const ui = useViewerUi.getState();
    if (ui.slideshow !== 'off') return;
    const sc = useViewer.getState().scope;
    if (!sc) return;
    const wantShuffle = prefsRef.current.slideshow.order === 'shuffle' && !sc.random;
    if (wantShuffle && !ui.shuffled) ui.set({ ...reorder(ui.order, ui.pos, true), shuffled: true });
    ui.set({ slideshow: 'playing', view: FIT_VIEW, animate: false });
    say(startText(sc, wantShuffle || ui.shuffled, prefsRef.current.slideshow.intervalSec));
  }, []);

  const pauseSlideshow = useCallback(() => {
    const ui = useViewerUi.getState();
    if (ui.slideshow !== 'playing') return;
    ui.set({ slideshow: 'paused', idle: false });
    activeMedia.video?.pause();
  }, []);

  const resumeSlideshow = useCallback(() => {
    const ui = useViewerUi.getState();
    if (ui.slideshow !== 'paused') return;
    ui.set({ slideshow: 'playing', ...(isZoomed(ui.view) ? { view: FIT_VIEW, animate: true } : {}) });
  }, []);

  const toggleSlideshow = useCallback(() => {
    const s = useViewerUi.getState().slideshow;
    if (s === 'off') startSlideshow();
    else if (s === 'paused') resumeSlideshow();
    else pauseSlideshow();
  }, [startSlideshow, resumeSlideshow, pauseSlideshow]);

  // 图片停留计时：由顶部进度条的 Web Animation 驱动，暂停即暂停动画
  const ssOn = slideshow !== 'off';
  const intervalSec = prefs.slideshow.intervalSec;
  const animRef = useRef<Animation | null>(null);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    bar.style.width = '0%';
    if (!ssOn || isVideo) return;
    const a = bar.animate([{ width: '0%' }, { width: '100%' }], { duration: intervalSec * 1000, easing: 'linear', fill: 'forwards' });
    a.onfinish = () => advanceRef.current(1, true);
    if (useViewerUi.getState().slideshow === 'paused') a.pause();
    animRef.current = a;
    return () => { a.onfinish = null; a.cancel(); animRef.current = null; };
  }, [ssOn, item.id, intervalSec, isVideo]);
  useEffect(() => {
    const a = animRef.current;
    if (!a) return;
    if (slideshow === 'paused') a.pause();
    else if (slideshow === 'playing' && a.playState === 'paused') a.play();
  }, [slideshow]);
  // 视频在幻灯片中：进度条跟随播放进度
  useEffect(() => {
    if (!ssOn || !isVideo) return;
    return useViewerUi.subscribe((s) => {
      const bar = barRef.current;
      if (bar) bar.style.width = `${s.video.duration ? Math.min(100, (s.video.time / s.video.duration) * 100) : 0}%`;
    });
  }, [ssOn, isVideo]);
  // 放大查看时暂停幻灯片
  useEffect(() => {
    if (zoomed && useViewerUi.getState().slideshow === 'playing') {
      pauseSlideshow();
      say('放大查看时幻灯片已暂停，按空格继续');
    }
  }, [zoomed]);

  // 播放中 3 秒无操作隐藏控件
  useEffect(() => {
    const dlg = dialogRef.current;
    if (slideshow !== 'playing' || !dlg) {
      if (useViewerUi.getState().idle) useViewerUi.getState().set({ idle: false });
      return;
    }
    let t = 0;
    const arm = () => {
      clearTimeout(t);
      t = window.setTimeout(() => { if (!useViewerUi.getState().menu) useViewerUi.getState().set({ idle: true }); }, 3000);
    };
    const bump = () => { if (useViewerUi.getState().idle) useViewerUi.getState().set({ idle: false }); arm(); };
    arm();
    dlg.addEventListener('pointermove', bump);
    dlg.addEventListener('pointerdown', bump);
    dlg.addEventListener('keydown', bump);
    return () => {
      clearTimeout(t);
      dlg.removeEventListener('pointermove', bump);
      dlg.removeEventListener('pointerdown', bump);
      dlg.removeEventListener('keydown', bump);
    };
  }, [slideshow]);

  const setShuffle = (next: boolean) => {
    updatePrefs.mutate({ slideshow: { order: next ? 'shuffle' : 'sequential' } });
    const ui = useViewerUi.getState();
    if (useViewer.getState().scope?.random) return;
    const r = reorder(ui.order, ui.pos, next);
    ui.set({ ...r, shuffled: next });
    const idx = r.order[r.pos];
    if (idx != null) useViewer.getState().setIndex(idx);
    say(next ? '改为随机顺序' : '改为按时间顺序');
  };

  // ---------- 动作 ----------
  const toggleFavorite = useCallback(async () => {
    const it = itemRef.current;
    const next = !it.favorite;
    const { updateItem } = useViewer.getState();
    updateItem(it.id, { favorite: next });
    say(next ? '已收藏' : '已取消收藏');
    try {
      await call('setFavorite', { body: { ids: [it.id], favorite: next } });
      void invalidate('listMedia', 'mediaDetail');
    } catch (e) {
      updateItem(it.id, { favorite: !next });
      say(`${next ? '收藏' : '取消收藏'}没有保存：${errText(e)}。请稍后再试`);
    }
  }, []);

  const copyImage = useCallback(() => {
    const it = itemRef.current;
    if (!canWriteImage()) { say(clipboardFailMessage()); return; }
    const video = it.mediaType === 'video' && it.playability !== 'unsupported' ? activeMedia.video : null;
    if (it.mediaType === 'video' && video && video.readyState < 2) { say('视频画面还没有加载出来，稍等片刻再复制'); return; }
    const source = video ?? (it.mediaType === 'video' ? thumbL(it) ?? mediaUrls.display(it.id, it.thumbVersion) : mediaUrls.display(it.id, it.thumbVersion));
    copyImageToClipboard(source).then(
      () => say(video ? '已复制当前画面，可以直接粘贴到聊天或文档里' : '已复制图片，可以直接粘贴到聊天或文档里'),
      () => say(clipboardFailMessage()),
    );
  }, []);

  const copyText = useCallback(async (text: string, ok: string) => {
    const done = await copyTextToClipboard(text, dialogRef.current);
    say(done ? ok : `无法写入剪贴板，可以手动复制：${text}`);
  }, []);

  const openFolder = useCallback((path: string) => {
    void navigate({ to: '/folders', search: { path } });
    requestClose(false);
  }, [navigate, requestClose]);

  const closeMenu = useCallback((restoreFocus: boolean) => {
    useViewerUi.getState().set({ menu: null });
    if (restoreFocus) dialogRef.current?.focus({ preventScroll: true });
  }, []);

  const openMenu = useCallback((x: number, y: number) => {
    useViewerUi.getState().set({ menu: { x, y }, idle: false });
    void queryClient.prefetchQuery(detailQuery(itemRef.current.id));
  }, []);

  const onMenuAction = useCallback(async (a: MenuAction) => {
    const it = itemRef.current;
    const at = useViewerUi.getState().menu;
    dialogRef.current?.focus({ preventScroll: true });
    switch (a) {
      case 'copy': copyImage(); break;
      case 'link': await copyText(location.origin + mediaUrls.original(it.id), '已复制原图链接'); break;
      case 'path': {
        try {
          const d = queryClient.getQueryData(detailQuery(it.id).queryKey) ?? (await queryClient.fetchQuery(detailQuery(it.id)));
          await copyText(filePath(d.breadcrumbs, d.name), '已复制文件路径');
        } catch (e) {
          say(`没有取到文件路径：${errText(e)}`);
        }
        break;
      }
      case 'download': triggerDownload(mediaUrls.download(it.id), dialogRef.current); say(`已开始下载 ${it.name}`); break;
      case 'open': window.open(mediaUrls.original(it.id), '_blank', 'noopener'); break;
      case 'reveal': openFolder(it.folder); break;
      case 'hero': {
        const name = it.folder.split('/').pop() || it.folder;
        updatePrefs.mutate(
          { home: { heroSource: 'folder', heroFolder: it.folder } },
          { onError: (e) => say(`首页轮播没有改成：${errText(e)}`) },
        );
        say(`首页轮播已改为文件夹「${name}」`);
        break;
      }
      case 'pixels': {
        const c = ctxRef.current;
        const ui = useViewerUi.getState();
        const p = at ?? { x: c.rect.x + c.rect.w / 2, y: c.rect.y + c.rect.h / 2 };
        ui.setView(zoomAt(ui.view, c.rect, c.viewport, p.x, p.y, oneToOneZoom(c.rect, c.mediaW), c.max), true);
        break;
      }
    }
  }, [copyImage, copyText, openFolder, updatePrefs]);

  const toggleInfo = useCallback(() => {
    const ui = useViewerUi.getState();
    ui.set({ info: !ui.info });
  }, []);

  /** 顺时针旋转 90°：只影响预览，不写原文件；换图后自动回到 0°。 */
  const rotate = useCallback(() => {
    const ui = useViewerUi.getState();
    const deg = nextRotation(rotation);
    setRotationState({ id: itemRef.current.id, deg });
    if (isZoomed(ui.view)) ui.setView(FIT_VIEW, true);
    setRotHint(rotationLabel(deg));
  }, [rotation]);

  /** 管理员确认后的磁盘删除；成功后把当前顺序重映射到删除后的索引。 */
  const confirmDelete = useCallback(async () => {
    const it = itemRef.current;
    if (!it.source) return;
    const operationId = deleteOpRef.current ?? crypto.randomUUID();
    deleteOpRef.current = operationId;
    setDeletePending(true);
    setDeleteError(null);
    try {
      await call('deleteMedia', { params: { id: it.id }, body: { confirm: true, source: it.source, operationId } });
      setDeletePending(false);
      setDeleteOpen(false);
      deleteOpRef.current = null;
      const viewer = useViewer.getState();
      if (!viewer.scope || viewer.scope.items.length <= 1) {
        say(`已删除 ${it.name}`);
        void invalidate('listMedia', 'mediaDetail', 'adminOverview');
        void queryClient.invalidateQueries({ queryKey: ['listMediaFailures'] });
        requestClose();
        return;
      }
      const ui = useViewerUi.getState();
      const { order: nextOrder, removedPos } = removeFromOrder(ui.order, viewer.index);
      viewer.removeItem(it.id);
      const nextPos = Math.max(0, Math.min(removedPos < 0 ? ui.pos : removedPos, nextOrder.length - 1));
      ui.set({ order: nextOrder, pos: nextPos, view: FIT_VIEW, animate: false, menu: null });
      if (nextOrder[nextPos] != null) viewer.setIndex(nextOrder[nextPos]!);
      say(`已删除 ${it.name}`);
      void invalidate('listMedia', 'mediaDetail', 'adminOverview');
      void queryClient.invalidateQueries({ queryKey: ['listMediaFailures'] });
    } catch (e) {
      setDeletePending(false);
      const message = e instanceof ApiError ? e.message : '删除失败，请稍后重试';
      if (e instanceof ApiError && (e.code === 'MEDIA_CHANGED' || e.code === 'NOT_FOUND')) {
        setDeleteOpen(false);
        setDeleteError(null);
        say(`${message}，列表已刷新`);
        void invalidate('listMedia', 'mediaDetail');
        void queryClient.invalidateQueries({ queryKey: ['listMediaFailures'] });
      } else {
        setDeleteError(message);
      }
    }
  }, [requestClose, say]);

  const openEditor = useCallback(() => {
    if (!canRepair) return;
    const ui = useViewerUi.getState();
    ui.set({ info: false, menu: null, slideshow: 'off', idle: false });
    ui.setView(FIT_VIEW, true);
    setEditorOpen(true);
    setHasMask(false);
    setComparing(false);
    setErase(false);
    setSavedCopy(null);
    setSaveOpen(false);
    setSaveError(null);
    resetEditorJob();
  }, [canRepair, resetEditorJob]);

  const closeEditor = useCallback(() => {
    if (editorPending) { say('正在提交修复作业，请稍候'); return; }
    if (editorJob?.status === 'queued' || editorJob?.status === 'running') void cancelEditorJob();
    else if (editorJob?.status === 'succeeded' && !savedCopy) say('已放弃修复预览，原图未修改');
    setEditorOpen(false);
    setComparing(false);
    setHasMask(false);
    setSaveOpen(false);
    setSaveError(null);
    resetEditorJob();
    useViewerUi.getState().setView(FIT_VIEW, true);
  }, [editorPending, editorJob?.status, savedCopy, cancelEditorJob, resetEditorJob, say]);

  const generate = useCallback(async () => {
    const it = itemRef.current;
    const mask = maskRef.current;
    if (!it.source || !mask || !maskLimit) return;
    const data = mask.exportPng();
    if (!data) { say('先涂抹要修复的区域'); return; }
    if (Math.floor((data.length * 3) / 4) > maskLimit.maxBytes) {
      say('蒙版文件过大，请减少涂抹范围或换更小的笔刷');
      return;
    }
    setComparing(false);
    setSavedCopy(null);
    await createEditorJob({
      mediaId: it.id,
      source: it.source,
      model: editorModel,
      mask: { data, width: mask.width, height: mask.height },
    });
  }, [createEditorJob, editorModel, maskLimit, say]);

  const resetEditorResult = useCallback(() => {
    resetEditorJob();
    setComparing(false);
    setSavedCopy(null);
  }, [resetEditorJob]);

  const saveEditorResult = useCallback(async (name: string) => {
    const it = itemRef.current;
    if (!it.source) return;
    setSavePending(true);
    setSaveError(null);
    try {
      const saved = await saveEditorCopy(name, it.source);
      setSavePending(false);
      setSaveOpen(false);
      setSavedCopy(saved.name);
      say(saved.status === 'saved' ? `已保存副本 ${saved.name}` : `已保存 ${saved.name}，正在入库`);
      void invalidate('listMedia', 'adminOverview');
    } catch (error) {
      setSavePending(false);
      setSaveError(error instanceof ApiError ? error.message : '保存副本失败，请稍后重试');
    }
  }, [saveEditorCopy, say]);

  // ---------- 键盘 ----------
  const onKeyDown = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    const t = e.target as HTMLElement;
    const k = e.key;
    if (deleteOpen) return;
    if (editorOpen) {
      if (saveOpen) return;
      if (k === 'Escape') { e.preventDefault(); closeEditor(); return; }
      if (k === ' ') { e.preventDefault(); setComparing(true); return; }
      return;
    }
    if (mobileEditOpen) {
      if (k === 'Escape') { e.preventDefault(); setMobileEditOpen(false); }
      return;
    }
    const ui = useViewerUi.getState();
    const c = ctxRef.current;
    if (k === 'Escape') {
      e.preventDefault(); // 自己处理关闭顺序，阻止对话框默认的关闭请求
      if (ui.menu) closeMenu(true);
      else if (isZoomed(ui.view)) zoomToLevel(c, 1);
      else requestClose();
      return;
    }
    if (ui.closing || t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if ((e.metaKey || e.ctrlKey) && (k === 'c' || k === 'C')) {
      if (window.getSelection()?.toString()) return; // 选中了信息栏文字时保留原生复制
      e.preventDefault();
      copyImage();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const onControl = t.tagName === 'BUTTON' || t.tagName === 'A' || t.getAttribute('role') === 'slider';
    switch (k) {
      case ' ':
        if (onControl) return;
        e.preventDefault();
        toggleSlideshow();
        return;
      case 'ArrowRight':
      case 'ArrowLeft':
        e.preventDefault();
        if (isZoomed(ui.view)) ui.setView(panBy(ui.view, c.rect, c.viewport, k === 'ArrowRight' ? -160 : 160, 0), true);
        else advance(k === 'ArrowRight' ? 1 : -1);
        return;
      case 'ArrowUp':
      case 'ArrowDown':
        if (isZoomed(ui.view)) {
          e.preventDefault();
          ui.setView(panBy(ui.view, c.rect, c.viewport, 0, k === 'ArrowDown' ? -160 : 160), true);
        }
        return;
      case '+': case '=': zoomStep(c, 1.6); return;
      case '-': case '_': zoomStep(c, 1 / 1.6); return;
      case '0': zoomToLevel(c, 1); return;
      case '1': zoomToLevel(c, oneToOneZoom(c.rect, c.mediaW)); return;
      case 'i': case 'I': toggleInfo(); return;
      case 'f': case 'F': void toggleFavorite(); return;
      case 'r': case 'R': if (!isVideo) rotate(); return;
    }
  };

  // ---------- 渲染 ----------
  const backdrop = prefs.theme.viewerBackdrop;
  const hasMore = canLoadMore();
  const counter = counterText(pos, order.length || items.length, scope.total, hasMore);
  const placeholder = thumbhashUrl(item);
  const bdImage = [thumbS(item), placeholder].filter(Boolean).map((u) => `url("${u}")`).join(', ');
  const playLabel = slideshow === 'off' ? '幻灯片播放' : slideshow === 'paused' ? '继续幻灯片' : '暂停幻灯片';
  const cls = [
    'lv-viewer',
    backdrop === 'ambient' && 'is-amb',
    backdrop === 'theme' && 'is-thm',
    zoomed && 'is-zoomed',
    dragging && 'is-drag',
    slideshow !== 'off' && 'is-ss',
    slideshow === 'paused' && 'is-paused',
    idle && 'is-idle',
    info && 'is-info',
    editorOpen && 'is-edit',
    isVideo && 'is-vid',
  ].filter(Boolean).join(' ');

  return (
    <dialog
      ref={dialogRef}
      className={cls}
      aria-label={`查看${isVideo ? '视频' : '照片'}：${item.name}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onKeyUp={(event) => { if (editorOpen && !saveOpen && event.key === ' ') setComparing(false); }}
      onCancel={(e) => { e.preventDefault(); requestClose(); }}
      onPointerDownCapture={(e) => {
        if (useViewerUi.getState().menu && !(e.target as HTMLElement).closest('.lv-menu')) closeMenu(false);
        if (mobileEditOpen && !(e.target as HTMLElement).closest('.lv-edit-sheet, .lv-edit-trigger')) setMobileEditOpen(false);
      }}
    >
      <div ref={baseRef} className="lv-base" aria-hidden>
        <div className="lv-bd" style={{ backgroundImage: bdImage || undefined }} />
      </div>

      <Stage
        item={item}
        ctx={ctx}
        frameRef={frameRef}
        first={item.id === firstIdRef.current}
        rotation={rotation}
        errorHint={scope.errorHint}
        resultUrl={resultUrl}
        showOriginal={comparing}
        overlay={editorOpen ? (
          <MaskCanvas
            key={item.id}
            ref={maskRef}
            item={item}
            rotation={rotation}
            brush={brush}
            erase={erase}
            active={!resultUrl && !editorBusy}
            maxEdge={maskLimit?.maxEdge ?? 2048}
            onChange={setHasMask}
          />
        ) : undefined}
        kenBurns={{ on: prefs.slideshow.kenBurns, sec: intervalSec }}
        onStep={(d) => advance(d)}
        onMenu={openMenu}
        onVideoEnded={() => { if (useViewerUi.getState().slideshow === 'playing') advance(1, true); }}
      />

      <div ref={chromeRef} className="lv-chrome">
        <div className="lv-prog" aria-hidden><i ref={barRef} /></div>

        {editorOpen ? (
          <div className="lv-vt">
            <button type="button" className="lv-vb" aria-label="退出修复编辑" onClick={closeEditor}><Icon name="close" /></button>
            <div className="lv-nm">
              <b>{item.name}</b>
              <small>修复编辑</small>
            </div>
            <button type="button" className="lv-vb lv-ed-done" onClick={closeEditor}>完成</button>
          </div>
        ) : (
          <div className="lv-vt">
            <button type="button" className="lv-vb" aria-label="关闭" onClick={() => requestClose()}><Icon name="close" /></button>
            <div className="lv-nm">
              <b>{item.name}</b>
              <small>{formatTakenAt(item.takenAt)}</small>
            </div>
            <button
              type="button"
              className={slideshow !== 'off' ? 'lv-vb on' : 'lv-vb'}
              aria-label={playLabel}
              title={slideshow === 'off' ? `幻灯片播放（空格），范围：${scope.label}` : '空格暂停或继续'}
              onClick={toggleSlideshow}
            >
              <Icon name={slideshow === 'playing' ? 'pause' : 'play'} />
            </button>
            <button
              type="button"
              className={item.favorite ? 'lv-vb on' : 'lv-vb'}
              aria-label="收藏"
              aria-pressed={item.favorite}
              title={item.favorite ? '取消收藏（F）' : '收藏（F）'}
              onClick={() => void toggleFavorite()}
            >
              <Icon name="heart" filled={item.favorite} />
            </button>
            {!mobile && !isVideo && (
              <>
                <span className="lv-vsep" aria-hidden />
                <button
                  type="button"
                  className="lv-vb"
                  aria-label="顺时针旋转 90 度"
                  title="顺时针旋转 90 度（R）"
                  onClick={rotate}
                >
                  <Icon name="rotate" />
                </button>
              </>
            )}
            {!mobile && canDelete && (
              <>
                {isVideo && <span className="lv-vsep" aria-hidden />}
                <button
                  type="button"
                  className="lv-vb lv-danger"
                  aria-label="删除原文件"
                  title="删除原文件（不可撤销）"
                  onClick={() => { setDeleteError(null); setDeleteOpen(true); }}
                >
                  <Icon name="trash" />
                </button>
              </>
            )}
            {!mobile && canRepair && (
              <button
                type="button"
                className="lv-vb"
                aria-label="修复"
                title="图像修复"
                onClick={openEditor}
              >
                <Icon name="brush" />
              </button>
            )}
            {mobile && canEdit && (
              <>
                <span className="lv-vsep" aria-hidden />
                <button
                  type="button"
                  className="lv-vb lv-edit-trigger"
                  aria-label="编辑"
                  title="编辑"
                  aria-expanded={mobileEditOpen}
                  onClick={() => setMobileEditOpen((value) => !value)}
                >
                  <Icon name="edit" />
                </button>
              </>
            )}
            <a className="lv-vb" href={mediaUrls.download(item.id)} download aria-label="下载原图" title="下载原图">
              <Icon name="download" />
            </a>
            <button
              type="button"
              className={info ? 'lv-vb on' : 'lv-vb'}
              aria-label="信息"
              aria-pressed={info}
              title="信息（I）"
              onClick={toggleInfo}
            >
              <Icon name="info" />
            </button>
          </div>
        )}

        {mobile && mobileEditOpen && (
          <div className="lv-edit-sheet" role="menu" aria-label="编辑">
            {!isVideo && (
              <button type="button" role="menuitem" onClick={() => { setMobileEditOpen(false); rotate(); }}>
                <Icon name="rotate" />旋转 90°
              </button>
            )}
            {canRepair && (
              <button type="button" role="menuitem" onClick={() => { setMobileEditOpen(false); openEditor(); }}>
                <Icon name="brush" />修复
              </button>
            )}
            {canDelete && (
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => { setMobileEditOpen(false); setDeleteError(null); setDeleteOpen(true); }}
              >
                <Icon name="trash" />删除原文件
              </button>
            )}
          </div>
        )}

        <div className={rotHint ? 'lv-rot-hint show' : 'lv-rot-hint'} role="status" aria-live="polite">{rotHint}</div>

        {isVideo && <VideoControls item={item} />}

        <button type="button" className="lv-vn l" aria-label="上一项" onClick={() => advance(-1)}><Icon name="prev" /></button>
        <button type="button" className="lv-vn r" aria-label="下一项" onClick={() => advance(1)}><Icon name="next" /></button>

        <InfoSheet item={item} open={info} onOpenFolder={openFolder} />

        {editorOpen && (
          <EditorDock
            models={models}
            model={editorModel}
            onModel={setEditorModel}
            brush={brush}
            onBrush={setBrush}
            erase={erase}
            onErase={setErase}
            hasMask={hasMask}
            onUndo={() => maskRef.current?.undo()}
            onClear={() => maskRef.current?.clear()}
            job={editorJob}
            createPending={editorPending}
            error={editorError}
            canGenerate={canGenerate}
            generateHint={generateHint}
            onGenerate={() => void generate()}
            onCancel={() => void cancelEditorJob()}
            onReset={resetEditorResult}
            onSave={() => { setSaveError(null); setSaveOpen(true); }}
            onCompare={setComparing}
            comparing={comparing}
            savedName={savedCopy}
            writeAvailable={capsQuery.data?.write.available ?? false}
            writeReason={capsQuery.data?.write.reason ?? '正在读取编辑器能力…'}
            onDone={closeEditor}
          />
        )}

        <Filmstrip
          items={items}
          order={order.length ? order : items.map((_, i) => i)}
          pos={pos}
          // 桌面端给右下角缩放 HUD 与信息栏让位，避免胶片条与其重叠
          viewportW={vp.w < MOBILE_BREAKPOINT ? vp.w : vp.w - (info ? 362 : 0) - 440}
          onPick={goPos}
        />

        {!isVideo && !imgFailed && <Minimap item={item} ctx={ctx} rotation={rotation} />}
        {!imgFailed && <ZoomHud ctx={ctx} />}

        <div className="lv-sspill" role="group" aria-label="幻灯片控制">
          <div className="ssl"><b title={scope.label}>{scope.label}</b><small>{counter}</small></div>
          <button type="button" className="lv-vb" aria-label="上一项" onClick={() => advance(-1)}><Icon name="prev" /></button>
          <button type="button" className="lv-vb" aria-label={slideshow === 'paused' ? '继续播放' : '暂停'} onClick={toggleSlideshow}>
            <Icon name={slideshow === 'paused' ? 'play' : 'pause'} />
          </button>
          <button type="button" className="lv-vb" aria-label="下一项" onClick={() => advance(1)}><Icon name="next" /></button>
          <span className="div" aria-hidden />
          <div className="lv-ssint" role="group" aria-label="每张停留">
            {INTERVALS.map((v) => (
              <button
                key={v}
                type="button"
                className={intervalSec === v ? 'on' : undefined}
                aria-pressed={intervalSec === v}
                onClick={() => updatePrefs.mutate({ slideshow: { intervalSec: v } })}
              >
                {v} 秒
              </button>
            ))}
          </div>
          <button
            type="button"
            className={prefs.slideshow.order === 'shuffle' ? 'lv-vb on' : 'lv-vb'}
            aria-label="随机顺序"
            aria-pressed={prefs.slideshow.order === 'shuffle'}
            disabled={!!scope.random}
            title={scope.random ? '当前范围本身就是随机抽取' : '随机顺序'}
            onClick={() => setShuffle(prefs.slideshow.order !== 'shuffle')}
          >
            <Icon name="shuffle" />
          </button>
          <button type="button" className="lv-vb" aria-label="退出幻灯片" onClick={stopSlideshow}><Icon name="close" /></button>
        </div>

        <ViewerToast />
      </div>

      <DeleteConfirm
        open={deleteOpen}
        name={item.name}
        pending={deletePending}
        error={deleteError}
        onCancel={() => { if (!deletePending) { setDeleteOpen(false); setDeleteError(null); } }}
        onConfirm={() => void confirmDelete()}
      />

      <SaveCopyDialog
        open={saveOpen}
        defaultName={saveDefaultName}
        pending={savePending}
        error={saveError}
        onCancel={() => { if (!savePending) { setSaveOpen(false); setSaveError(null); } }}
        onSave={(name) => void saveEditorResult(name)}
      />

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} video={isVideo} onAction={(a) => void onMenuAction(a)} onClose={closeMenu} />
      )}
    </dialog>
  );
}

/** 幻灯片开始时的提示。 */
function startText(sc: ViewerScope, shuffle: boolean, sec: number) {
  const known = sc.total ?? (!sc.random && !(sc.query && sc.nextCursor) ? sc.items.length : null);
  return `开始播放${sc.label}${known != null ? `，共 ${known} 项` : ''}${shuffle ? '，随机顺序' : ''}。图片每张 ${sec} 秒，视频播完自动下一项`;
}

/** 查看器内的提示条：模态对话框位于顶层，页面级 Toaster 会被遮住，因此在对话框内单独显示。 */
function ViewerToast() {
  const toast = useViewerUi((s) => s.toast);
  const [shown, setShown] = useState<{ id: number; text: string } | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setShown(toast);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3600);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <div className={visible ? 'lv-toast show' : 'lv-toast'} role="status" aria-live="polite">
      {shown?.text}
    </div>
  );
}

