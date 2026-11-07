import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { MediaItem } from '@luvia/contracts';
import { isQuarterTurn, unrotatePoint, type Rotation } from '../rotation';

interface Stroke { erase: boolean; radius: number; points: { x: number; y: number }[] }

export interface MaskCanvasHandle {
  undo: () => void;
  clear: () => void;
  /** 返回不含 data URL 前缀的 PNG base64；没有有效蒙版时为 null。 */
  exportPng: () => string | null;
  /** 返回红色增加、蓝色擦除的变更图，不改变原始检测蒙版。 */
  exportChanges: () => string | null;
  /** 蒙版内部像素尺寸，随能力上限下采样。 */
  width: number;
  height: number;
}

/**
 * 修复蒙版画布。画布内部是原图方向校正后的像素空间（长边受能力接口限制），
 * 显示时跟随查看器的旋转与缩放；指针坐标先按画布包围盒归一化，再逆旋转回原图。
 * 画布只画可见的高亮层；导出时把同一组笔画重放到黑底白字的二值 PNG。
 */
export const MaskCanvas = forwardRef<MaskCanvasHandle, {
  item: Pick<MediaItem, 'id' | 'width' | 'height'>;
  rotation: Rotation;
  brush: number;
  erase: boolean;
  active: boolean;
  maxEdge: number;
  baseMaskUrl?: string | null;
  onChange: (hasMask: boolean) => void;
}>(function MaskCanvas({ item, rotation, brush, erase, active, maxEdge, baseMaskUrl, onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseLayer = useRef<HTMLCanvasElement | null>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef<Stroke | null>(null);
  const lastReported = useRef(false);

  const baseW = item.width && item.height ? item.width : 1600;
  const baseH = item.width && item.height ? item.height : 1200;
  const scale = Math.min(1, maxEdge / Math.max(baseW, baseH));
  const width = Math.max(1, Math.round(baseW * scale));
  const height = Math.max(1, Math.round(baseH * scale));

  const accent = () => {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return value || '#ffffff';
  };

  const trace = (ctx: CanvasRenderingContext2D, stroke: Stroke, points = stroke.points) => {
    ctx.beginPath();
    const first = points[0];
    if (!first) return;
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
  };

  const drawDot = (ctx: CanvasRenderingContext2D, stroke: Stroke, x: number, y: number, color: string) => {
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, stroke.radius), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };

  const drawVisible = useCallback((ctx: CanvasRenderingContext2D, stroke: Stroke, color: string) => {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (stroke.erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = 1;
      ctx.lineWidth = stroke.radius * 2;
      if (stroke.points.length === 1) drawDot(ctx, stroke, stroke.points[0]!.x, stroke.points[0]!.y, '#000');
      else { trace(ctx, stroke); ctx.stroke(); }
    } else {
      ctx.globalCompositeOperation = 'source-over';
      // 先描一圈浅黑影，保证亮色照片上也能看清笔触边界。
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = stroke.radius * 2 + 2;
      ctx.strokeStyle = '#000';
      if (stroke.points.length === 1) drawDot(ctx, stroke, stroke.points[0]!.x, stroke.points[0]!.y, '#000');
      else { trace(ctx, stroke); ctx.stroke(); }
      ctx.globalAlpha = 0.48;
      ctx.lineWidth = stroke.radius * 2;
      ctx.strokeStyle = color;
      if (stroke.points.length === 1) drawDot(ctx, stroke, stroke.points[0]!.x, stroke.points[0]!.y, color);
      else { trace(ctx, stroke); ctx.stroke(); }
    }
    ctx.restore();
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (baseLayer.current) ctx.drawImage(baseLayer.current, 0, 0, canvas.width, canvas.height);
    const color = accent();
    for (const stroke of strokes.current) drawVisible(ctx, stroke, color);
  }, [drawVisible]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    redraw();
  }, [width, height, redraw]);

  const notify = useCallback(() => {
    const has = baseMaskUrl ? strokes.current.length > 0 : strokes.current.some((stroke) => !stroke.erase);
    if (has !== lastReported.current) {
      lastReported.current = has;
      onChange(has);
    }
  }, [onChange, baseMaskUrl]);

  useEffect(() => {
    let cancelled = false;
    baseLayer.current = null;
    strokes.current = [];
    lastReported.current = false;
    onChange(false);
    redraw();
    if (!baseMaskUrl) return;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      const layer = document.createElement('canvas');
      layer.width = width; layer.height = height;
      const context = layer.getContext('2d');
      if (!context) return;
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        const opacity = pixels.data[i]!;
        pixels.data[i] = 255; pixels.data[i + 1] = 255; pixels.data[i + 2] = 255;
        pixels.data[i + 3] = Math.round(opacity * 0.48);
      }
      context.putImageData(pixels, 0, 0);
      baseLayer.current = layer;
      redraw();
    };
    image.src = `${baseMaskUrl}${baseMaskUrl.includes('?') ? '&' : '?'}preview=1`;
    return () => { cancelled = true; };
  }, [baseMaskUrl, width, height, onChange, redraw]);

  useEffect(() => {
    strokes.current = [];
    drawing.current = null;
    lastReported.current = false;
    redraw();
    onChange(false);
  }, [item.id, redraw, onChange]);

  const radius = () => {
    const canvas = canvasRef.current;
    if (!canvas) return Math.max(1, brush / 2);
    const rect = canvas.getBoundingClientRect();
    const quarter = isQuarterTurn(rotation);
    const unit = rect.width / (quarter ? canvas.height : canvas.width);
    return Math.max(0.75, (brush / 2) / Math.max(unit, 0.0001));
  };

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const u = (event.clientX - rect.left) / Math.max(1, rect.width);
    const v = (event.clientY - rect.top) / Math.max(1, rect.height);
    const original = unrotatePoint(u, v, rotation);
    return { x: original.u * canvas.width, y: original.v * canvas.height };
  };

  const down = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const stroke: Stroke = { erase, radius: radius(), points: [pointOf(event)] };
    strokes.current.push(stroke);
    drawing.current = stroke;
    redraw();
    notify();
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const stroke = drawing.current;
    if (!stroke) return;
    event.stopPropagation();
    const point = pointOf(event);
    const last = stroke.points[stroke.points.length - 1]!;
    if (Math.hypot(point.x - last.x, point.y - last.y) < 0.4) return;
    stroke.points.push(point);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const color = accent();
    // 增量绘制当前段，避免每次 pointermove 重放全部笔画。
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (stroke.erase) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = stroke.radius * 2;
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(point.x, point.y); ctx.stroke();
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = stroke.radius * 2 + 2;
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(point.x, point.y); ctx.stroke();
      ctx.globalAlpha = 0.48;
      ctx.strokeStyle = color;
      ctx.lineWidth = stroke.radius * 2;
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(point.x, point.y); ctx.stroke();
    }
    ctx.restore();
  };

  const up = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    event.stopPropagation();
    drawing.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* 指针已被系统释放。 */ }
    // 增量绘制会在拐点叠加半透明像素；落笔后整段重绘，避免出现锯齿状暗点。
    redraw();
    notify();
  };

  const drawBinary = (ctx: CanvasRenderingContext2D, stroke: Stroke) => {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke.erase ? '#000' : '#fff';
    ctx.fillStyle = stroke.erase ? '#000' : '#fff';
    ctx.lineWidth = stroke.radius * 2;
    if (stroke.points.length === 1) drawDot(ctx, stroke, stroke.points[0]!.x, stroke.points[0]!.y, ctx.fillStyle);
    else { trace(ctx, stroke); ctx.stroke(); }
    ctx.restore();
  };

  useImperativeHandle(ref, () => ({
    undo: () => {
      strokes.current.pop();
      redraw();
      notify();
    },
    clear: () => {
      strokes.current = [];
      redraw();
      notify();
    },
    exportPng: () => {
      if (!strokes.current.some((stroke) => !stroke.erase)) return null;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
      for (const stroke of strokes.current) drawBinary(ctx, stroke);
      return canvas.toDataURL('image/png').split(',')[1] ?? null;
    },
    exportChanges: () => {
      if (!strokes.current.length) return null;
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
      for (const stroke of strokes.current) {
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = stroke.erase ? '#0000ff' : '#ff0000';
        ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = stroke.radius * 2;
        if (stroke.points.length === 1) drawDot(ctx, stroke, stroke.points[0]!.x, stroke.points[0]!.y, ctx.fillStyle);
        else { trace(ctx, stroke); ctx.stroke(); }
        ctx.restore();
      }
      return canvas.toDataURL('image/png').split(',')[1] ?? null;
    },
    width,
    height,
  }), [redraw, notify, width, height]);

  const diameter = Math.max(6, brush);
  const ring = diameter + 4;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ring}" height="${ring}"><circle cx="${ring / 2}" cy="${ring / 2}" r="${diameter / 2}" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="1.5"${erase ? ' stroke-dasharray="3 2"' : ''}/><circle cx="${ring / 2}" cy="${ring / 2}" r="1.5" fill="rgba(255,255,255,.9)"/></svg>`;
  const cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${ring / 2} ${ring / 2}, crosshair`;

  return (
    <canvas
      ref={canvasRef}
      className="lv-mask"
      width={width}
      height={height}
      style={{ cursor, display: active ? undefined : 'none' }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      aria-label="修复蒙版画布"
    />
  );
});
