import { useEffect, useRef } from 'react';
import { mediaUrls, type MediaItem } from '@luvia/contracts';
import { formatDuration } from '@/components/media/Thumb';
import { activeMedia, useViewerUi } from './state';
import { Icon } from './icons';

const HLS_MIME = 'application/vnd.apple.mpegurl';

/**
 * 视频画面：direct 直接播放原文件；transcode 优先用浏览器原生 HLS（Safari），否则按需加载 hls.js。
 * 播放状态写入 useViewerUi.video，供顶层控件（中央播放按钮、进度条）读取。
 */
export function VideoMedia({ item, poster, autoPlay, pixelated, onEnded, onMeasured }: {
  item: MediaItem;
  poster: string | undefined;
  autoPlay: boolean;
  pixelated: boolean;
  onEnded: () => void;
  onMeasured: (w: number, h: number, sourceW: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const endRef = useRef(onEnded);
  endRef.current = onEnded;
  const setVideo = (patch: Partial<ReturnType<typeof useViewerUi.getState>['video']>) =>
    useViewerUi.setState((s) => ({ video: { ...s.video, ...patch } }));

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    activeMedia.video = v;
    setVideo({ playing: false, time: 0, duration: item.durationSec ?? 0, error: null });
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;

    if (item.playability === 'transcode') {
      const url = mediaUrls.hls(item.id);
      if (v.canPlayType(HLS_MIME)) {
        v.src = url;
      } else {
        void import('hls.js').then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            setVideo({ error: '当前浏览器不支持 HLS 播放。可以下载原文件后用本地播放器打开。' });
            return;
          }
          const h = new Hls({ maxBufferLength: 30 });
          hls = h;
          h.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) setVideo({ error: '转码播放中断。可能是服务器转码失败，可以下载原文件后用本地播放器打开。' });
          });
          h.loadSource(url);
          h.attachMedia(v);
        }, () => setVideo({ error: '播放组件加载失败，请检查网络后重新打开。' }));
      }
    } else {
      v.src = mediaUrls.original(item.id);
    }

    return () => {
      cancelled = true;
      hls?.destroy();
      v.removeAttribute('src');
      v.load();
      if (activeMedia.video === v) activeMedia.video = null;
    };
  }, [item.id, item.playability, item.durationSec]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !autoPlay) return;
    v.play().catch(() => {
      // 自动播放被拦截时改为静音再试
      v.muted = true;
      v.play().catch(() => {});
    });
  }, [autoPlay, item.id]);

  return (
    <video
      ref={ref}
      poster={poster}
      playsInline
      preload="metadata"
      className={pixelated ? 'px' : undefined}
      onLoadedMetadata={(e) => {
        const v = e.currentTarget;
        setVideo({ duration: Number.isFinite(v.duration) ? v.duration : item.durationSec ?? 0 });
        if (v.videoWidth) onMeasured(v.videoWidth, v.videoHeight, v.videoWidth);
      }}
      onTimeUpdate={(e) => setVideo({ time: e.currentTarget.currentTime })}
      onPlay={() => setVideo({ playing: true })}
      onPause={() => setVideo({ playing: false })}
      onEnded={() => { setVideo({ playing: false }); endRef.current(); }}
      onError={() => {
        if (item.playability !== 'transcode') setVideo({ error: '视频无法加载。文件可能已移动，或编码不受浏览器支持。可以下载原文件后用本地播放器打开。' });
      }}
    />
  );
}

/** 视频控件：中央播放按钮 + 底部进度条（可拖动、方向键快进快退）。 */
export function VideoControls({ item }: { item: MediaItem }) {
  const { playing, time, duration, error } = useViewerUi((s) => s.video);
  const trackRef = useRef<HTMLSpanElement>(null);
  const dur = duration || item.durationSec || 0;
  const frac = dur ? Math.min(1, time / dur) : 0;

  const toggle = () => {
    const v = activeMedia.video;
    if (!v) return;
    if (v.paused) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    else v.pause();
  };
  const seekTo = (t: number) => {
    const v = activeMedia.video;
    if (v && dur) v.currentTime = Math.max(0, Math.min(dur, t));
  };
  const seekFromPointer = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (r && r.width) seekTo(((clientX - r.left) / r.width) * dur);
  };

  if (item.playability === 'unsupported' || error) {
    return (
      <div className="lv-vmsg" role="alert">
        <b>{item.playability === 'unsupported' ? '这个视频无法在浏览器中播放' : '视频播放失败'}</b>
        <p>{error ?? '它的编码浏览器无法直接解码，服务器也没有开启转码。可以下载原文件后用本地播放器打开。'}</p>
        <a className="lv-btn" href={mediaUrls.download(item.id)} download>
          <Icon name="download" />下载原文件
        </a>
      </div>
    );
  }

  return (
    <>
      {!playing && (
        <button type="button" className="lv-play" aria-label="播放视频" onClick={toggle}>
          <Icon name="play" />
        </button>
      )}
      <div className="lv-vidbar">
        <button type="button" className="lv-vb" aria-label={playing ? '暂停视频' : '播放视频'} onClick={toggle}>
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <span>{formatDuration(time)}</span>
        <span
          className="tr"
          role="slider"
          tabIndex={0}
          aria-label="播放进度"
          aria-valuemin={0}
          aria-valuemax={Math.round(dur)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${formatDuration(time)} / ${formatDuration(dur)}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            seekFromPointer(e.clientX);
          }}
          onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e.clientX); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
              e.preventDefault();
              e.stopPropagation();
              seekTo(time + (e.key === 'ArrowRight' ? 5 : -5));
            } else if (e.key === 'Home' || e.key === 'End') {
              e.preventDefault();
              e.stopPropagation();
              seekTo(e.key === 'Home' ? 0 : dur);
            }
          }}
        >
          <span ref={trackRef}><i style={{ width: `${frac * 100}%` }} /></span>
        </span>
        <span>{formatDuration(dur)}</span>
      </div>
    </>
  );
}
