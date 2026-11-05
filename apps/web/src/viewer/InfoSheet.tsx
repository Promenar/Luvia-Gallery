import { useQuery } from '@tanstack/react-query';
import type { MediaDetail, MediaItem } from '@luvia/contracts';
import { q } from '@/lib/query';
import { formatDuration } from '@/components/media/Thumb';
import { formatBytes, formatExposure, formatTakenAt } from './sequence';

export const detailQuery = (id: string) => q('mediaDetail', { params: { id } });

const SOURCE_NOTE: Record<MediaItem['takenAtSource'], string | null> = {
  metadata: null,
  filename: '没有拍摄时间元数据，显示的时间取自文件名。',
  mtime: '没有拍摄时间元数据，显示的时间取自文件修改时间。',
};

function cameraOf(d: MediaDetail) {
  const make = d.exif?.make?.trim();
  const model = d.exif?.model?.trim();
  if (!model) return make || null;
  return make && !model.toLowerCase().startsWith(make.toLowerCase()) ? `${make} ${model}` : model;
}

/** 信息侧栏（原型 .sheet）：拍摄参数、尺寸、大小、位置、所在文件夹面包屑。 */
export function InfoSheet({ item, open, onOpenFolder }: { item: MediaItem; open: boolean; onOpenFolder: (path: string) => void }) {
  const { data: d, isError, isPending } = useQuery({ ...detailQuery(item.id), enabled: open });
  const exif = d?.exif;
  const strip = exif && (exif.fNumber || exif.exposureTime || exif.iso || exif.focalLength)
    ? [
      { v: exif.fNumber ? `ƒ${exif.fNumber}` : '—', l: '光圈' },
      { v: exif.exposureTime ? formatExposure(exif.exposureTime) : '—', l: '快门' },
      { v: exif.iso ? String(exif.iso) : '—', l: 'ISO' },
      { v: exif.focalLength ? String(Math.round(exif.focalLength)) : '—', l: '毫米' },
    ]
    : null;
  const w = d?.width ?? item.width;
  const h = d?.height ?? item.height;

  return (
    <aside className="lv-sheet" aria-label="照片信息" aria-hidden={!open} inert={!open}>
      <h4>{item.name}</h4>
      <div className="when">{formatTakenAt(item.takenAt)}</div>
      {strip && (
        <div className="ex">
          {strip.map((s) => <div key={s.l}><b>{s.v}</b><small>{s.l}</small></div>)}
        </div>
      )}
      {!strip && <div style={{ height: 16 }} />}
      <dl>
        {d && cameraOf(d) && (<><dt>相机</dt><dd>{cameraOf(d)}</dd></>)}
        {exif?.lens && (<><dt>镜头</dt><dd>{exif.lens}</dd></>)}
        {exif?.focalLength35 && (<><dt>等效焦距</dt><dd>{Math.round(exif.focalLength35)} 毫米</dd></>)}
        {w && h && (<><dt>尺寸</dt><dd>{w} × {h}{item.mediaType === 'image' ? `（${((w * h) / 1e6).toFixed(1)} 百万像素）` : ''}</dd></>)}
        <dt>大小</dt><dd>{formatBytes(item.size)}</dd>
        {item.durationSec != null && (<><dt>时长</dt><dd>{formatDuration(item.durationSec)}</dd></>)}
        {d?.video && (
          <>
            <dt>编码</dt>
            <dd>{[d.video.codec, d.video.audioCodec].filter(Boolean).join(' / ') || '未知'}{d.video.fps ? `，${Math.round(d.video.fps)} 帧/秒` : ''}</dd>
          </>
        )}
        <dt>类型</dt><dd>{item.mime}</dd>
        {d?.location && (
          <>
            <dt>位置</dt>
            <dd>{d.location.lat.toFixed(5)}, {d.location.lon.toFixed(5)}{d.location.altitude != null ? `，海拔 ${Math.round(d.location.altitude)} 米` : ''}</dd>
          </>
        )}
        <dt>文件夹</dt>
        <dd>
          {d ? (
            <span className="crumbs">
              {d.breadcrumbs.map((b, i) => (
                <span key={b.path} style={{ display: 'contents' }}>
                  {i > 0 && <span aria-hidden>/</span>}
                  <button type="button" className="lnk" onClick={() => onOpenFolder(b.path)} title={`打开文件夹「${b.name}」`}>{b.name}</button>
                </span>
              ))}
            </span>
          ) : isError ? '详情加载失败，关闭信息后再打开可以重试' : isPending ? '正在加载…' : null}
        </dd>
      </dl>
      {SOURCE_NOTE[item.takenAtSource] && <p className="note">{SOURCE_NOTE[item.takenAtSource]}</p>}
    </aside>
  );
}
