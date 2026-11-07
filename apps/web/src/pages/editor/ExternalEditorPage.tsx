import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Folder as FolderIcon, FolderInput, ImagePlus, RefreshCw, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import type { EditorJob, EditorModelId, FolderListing } from '@luvia/contracts';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { createOperationId } from '@/lib/operation-id';
import { q, queryClient } from '@/lib/query';
import { useIsAdmin } from '@/stores/session';
import { EditorDock } from '@/viewer/editor/EditorDock';
import { MaskCanvas, type MaskCanvasHandle } from '@/viewer/editor/MaskCanvas';
import { formatBytes } from '@/viewer/sequence';
import { Chip, Field, Modal, Pill, Section, inputClass } from '@/pages/admin/ui';
import { errMsg, formatWhen } from '@/pages/admin/format';
import { importExternalResult, uploadExternalImage, type ExternalImportResult, type ExternalUpload } from './external-api';
import { defaultImportName, folderProblem, isImageFile, normalizeFolder } from './format';
import { useExternalJob } from './useExternalJob';
import { BatchAutomationPanel } from './BatchAutomation';
import './editor-page.css';

function FolderPickerDialog({ library, initialPath, onClose, onPick }: {
  library: { id: string; name: string };
  initialPath: string;
  onClose: () => void;
  onPick: (folder: string) => void;
}) {
  const [path, setPath] = useState(initialPath || library.id);
  const listing = useQuery({ ...q('folders', { query: { path } }), enabled: true });
  const data: FolderListing | undefined = listing.data;
  const relative = (value: string) => value === library.id ? '' : value.startsWith(`${library.id}/`) ? value.slice(library.id.length + 1) : '';
  return (
    <Modal
      open
      onOpenChange={(value) => { if (!value) onClose(); }}
      title="选择文件夹"
      desc={library.name}
      wide
      footer={<><Chip onClick={onClose}>取消</Chip><Chip variant="primary" disabled={listing.isLoading || listing.isError} onClick={() => onPick(relative(path))}>使用此文件夹</Chip></>}
    >
      {listing.isError ? (
        <div className="grid gap-3 text-[13px]">
          <p className="m-0 text-bad">{errMsg(listing.error)}</p>
          <Chip size="sm" onClick={() => setPath(library.id)}>回到媒体库根目录</Chip>
        </div>
      ) : listing.isLoading ? (
        <div className="py-6 text-center text-[13px] text-muted">正在读取文件夹…</div>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-1 text-[12.5px] text-muted">
            {data?.breadcrumbs.map((crumb, index) => (
              <span key={crumb.path} className="flex items-center gap-1">
                {index > 0 && <span aria-hidden className="opacity-40">/</span>}
                <button type="button" className="rounded px-1 py-0.5 hover:bg-accent-soft hover:text-fg" onClick={() => setPath(crumb.path)}>
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
          <div className="max-h-[46vh] overflow-y-auto rounded-[var(--r2)] border border-line">
            {data?.folders.length ? data.folders.map((folder) => (
              <button
                key={folder.path}
                type="button"
                className="flex w-full items-center gap-2.5 border-b border-line px-3 py-2.5 text-left text-[13px] last:border-b-0 hover:bg-accent-soft"
                onClick={() => setPath(folder.path)}
              >
                <FolderIcon className="size-4 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                <small className="shrink-0 text-[12px] text-muted">{folder.mediaCount} 项</small>
              </button>
            )) : <div className="px-3 py-6 text-center text-[13px] text-muted">没有子文件夹。可以使用当前文件夹，或在页面上直接输入新路径。</div>}
          </div>
          <p className="m-0 text-[12.5px] text-muted">
            当前：{library.name} / <b className="font-medium text-fg-2">{relative(path) || '根目录'}</b>
          </p>
        </div>
      )}
    </Modal>
  );
}

export default function ExternalEditorPage() {
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: 'single' | 'batches' };
  const tab = search.tab ?? 'single';
  const caps = useQuery({ ...q('editorCapabilities'), enabled: isAdmin });
  const librariesQuery = useQuery({ ...q('listLibraries'), enabled: isAdmin });
  const libraries = (librariesQuery.data?.libraries ?? []).filter((library) => library.enabled);
  const models = caps.data?.models ?? [];
  const availableModels = models.filter((model) => model.available);
  const maskLimit = caps.data?.mask ?? null;

  const [upload, setUpload] = useState<ExternalUpload | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [pendingName, setPendingName] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const [model, setModel] = useState<EditorModelId>('migan');
  const [brush, setBrush] = useState(18);
  const [erase, setErase] = useState(false);
  const [hasMask, setHasMask] = useState(false);
  const [adjustBase, setAdjustBase] = useState<EditorJob | null>(null);
  const [comparing, setComparing] = useState(false);
  const maskRef = useRef<MaskCanvasHandle>(null);
  const editor = useExternalJob();

  const [libraryId, setLibraryId] = useState('');
  const [folder, setFolder] = useState('');
  const [name, setName] = useState('');
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPending, setImportPending] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ result: ExternalImportResult; libraryId: string } | null>(null);
  const importOpRef = useRef<{ key: string; id: string } | null>(null);
  const pictureRevision = useRef(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState({ w: 0, h: 0 });

  const resultUrl = !adjustBase && editor.job?.status === 'succeeded' ? editor.job.resultUrl : null;
  const autoModel = models.find((item) => item.id === 'slbr' && item.available && item.features.includes('detect'));
  const library = libraries.find((item) => item.id === libraryId) ?? null;
  const normalizedFolder = normalizeFolder(folder);
  const folderError = folderProblem(normalizedFolder);
  const trimmedName = name.trim();
  const nameError = !trimmedName ? '请输入文件名' : /[\\/\0]/.test(trimmedName) ? '文件名不能包含路径分隔符' : null;
  const uploadExpired = upload ? Date.parse(upload.expiresAt) <= Date.now() : false;
  const canAuto = !!upload && !uploadExpired && !!autoModel &&
    (!autoModel.maxPixels || upload.width * upload.height <= autoModel.maxPixels);
  const jobError = editor.createError ?? editor.queryError ?? editor.job?.error ?? null;
  const canGenerate = !!upload && !uploadExpired && !!maskLimit && hasMask && !editor.busy;
  const generateHint = !upload ? null
    : uploadExpired ? '图片暂存已过期，请重新上传'
      : !maskLimit ? '正在读取编辑器能力…'
        : !hasMask ? '先涂抹要修复的区域'
          : null;
  const importReady = !!resultUrl && !!libraryId && !folderError && !nameError && caps.data?.write.available !== false;
  const importBlockReason = !resultUrl ? null
    : !libraryId ? '先选择媒体库'
        : folderError ?? nameError ?? (caps.data?.write.available === false ? caps.data.write.reason : null);

  const frame = useMemo(() => {
    if (!upload || stageBox.w < 2 || stageBox.h < 2) return null;
    const dock = 112;
    const pad = 24;
    const aw = Math.max(1, stageBox.w - pad * 2);
    const ah = Math.max(1, stageBox.h - dock - pad);
    const scale = Math.min(aw / upload.width, ah / upload.height);
    const width = Math.max(1, Math.floor(upload.width * scale));
    const height = Math.max(1, Math.floor(upload.height * scale));
    return { left: Math.floor((stageBox.w - width) / 2), top: Math.floor((stageBox.h - dock - height) / 2) + 6, width, height };
  }, [upload, stageBox]);

  useEffect(() => {
    if (availableModels.length && !availableModels.some((item) => item.id === model)) setModel(availableModels[0]!.id);
  }, [availableModels, model]);

  useEffect(() => {
    if (!libraryId && libraries.length) setLibraryId(libraries[0]!.id);
  }, [libraries, libraryId]);

  useEffect(() => {
    importOpRef.current = null;
  }, [libraryId, folder, name, editor.job?.id]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !upload) { setStageBox({ w: 0, h: 0 }); return; }
    const measure = () => setStageBox({ w: stage.clientWidth, h: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [upload?.id]);

  useEffect(() => () => { uploadAbort.current?.abort(); uploadAbort.current = null; }, []);

  const startOver = useCallback(() => {
    pictureRevision.current++;
    setImportPending(false);
    uploadAbort.current?.abort();
    uploadAbort.current = null;
    if (editor.busy) void editor.cancel();
    editor.reset();
    setUpload(null);
    setFileSize(null);
    setUploading(false);
    setUploadProgress(0);
    setUploadError(null);
    setHasMask(false);
    setAdjustBase(null);
    setComparing(false);
    setImportResult(null);
    setImportOpen(false);
    setImportError(null);
    importOpRef.current = null;
  }, [editor]);

  const acceptFile = useCallback(async (file: File) => {
    if (!isImageFile(file)) { toast.error('请选择 JPEG、PNG、WebP 或 GIF 图片'); return; }
    pictureRevision.current++;
    setImportPending(false);
    importOpRef.current = null;
    uploadAbort.current?.abort();
    const controller = new AbortController();
    uploadAbort.current = controller;
    if (editor.busy) void editor.cancel();
    setUploading(true);
    setUploadProgress(0);
    setUploadError(null);
    setPendingName(file.name);
    setUpload(null);
    setFileSize(file.size);
    setHasMask(false);
    setAdjustBase(null);
    setComparing(false);
    setImportResult(null);
    setImportOpen(false);
    editor.reset();
    try {
      const uploaded = await uploadExternalImage(file, { signal: controller.signal, onProgress: (value) => {
        if (uploadAbort.current === controller) setUploadProgress(value);
      } });
      if (uploadAbort.current !== controller) return;
      setUpload(uploaded);
      setName(defaultImportName(uploaded.name));
      if (!libraryId && libraries.length) setLibraryId(libraries[0]!.id);
    } catch (error) {
      if (uploadAbort.current !== controller || (error instanceof DOMException && error.name === 'AbortError')) return;
      setUploadError(errMsg(error));
    } finally {
      if (uploadAbort.current === controller) { setUploading(false); uploadAbort.current = null; }
    }
  }, [editor, libraries, libraryId]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (tab !== 'single') return;
      const items = Array.from(event.clipboardData?.items ?? []);
      const file = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
      if (!file) return;
      event.preventDefault();
      void acceptFile(file);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [acceptFile, tab]);

  const generate = useCallback(async () => {
    const mask = maskRef.current;
    if (!upload || !mask || !maskLimit) return;
    const data = adjustBase ? mask.exportChanges() : mask.exportPng();
    if (!data) { toast.error('先涂抹要修复的区域'); return; }
    if (Math.floor((data.length * 3) / 4) > maskLimit.maxBytes) {
      toast.error('蒙版文件过大，请减少涂抹范围或换更小的笔刷');
      return;
    }
    setComparing(false);
    setImportResult(null);
    const created = await editor.create(upload.id, model, adjustBase
      ? { mode: 'adjust', baseJobId: adjustBase.id, changes: { data, width: mask.width, height: mask.height } }
      : { data, width: mask.width, height: mask.height });
    if (created) setAdjustBase(null);
  }, [adjustBase, editor, maskLimit, model, upload]);

  const autoRepair = useCallback(async () => {
    if (!upload) return;
    setComparing(false); setImportResult(null); setModel('slbr');
    await editor.create(upload.id, 'slbr', { mode: 'auto', threshold: 128 });
  }, [editor, upload]);

  const resetResult = useCallback(() => {
    editor.reset();
    setAdjustBase(null);
    setComparing(false);
    setImportResult(null);
  }, [editor]);

  const handleImport = useCallback(async () => {
    const job = editor.job;
    if (!job || !importReady) return;
    const revision = pictureRevision.current;
    const key = JSON.stringify([job.id, libraryId, normalizedFolder, trimmedName]);
    const operationId = importOpRef.current?.key === key ? importOpRef.current.id : createOperationId();
    importOpRef.current = { key, id: operationId };
    setImportPending(true);
    setImportError(null);
    try {
      const result = await importExternalResult(job.id, {
        libraryId, folder: normalizedFolder, name: trimmedName, operationId,
      });
      if (pictureRevision.current !== revision) {
        toast.success(`上一张图片已写入：${result.name}`);
        return;
      }
      setImportPending(false);
      setImportOpen(false);
      setImportResult({ result, libraryId });
      toast.success(result.status === 'saved' ? `已导入 ${result.name}` : `已写入 ${result.name}，正在入库`);
      void queryClient.invalidateQueries({ queryKey: ['listMedia'] });
      void queryClient.invalidateQueries({ queryKey: ['folders'] });
      void queryClient.invalidateQueries({ queryKey: ['adminOverview'] });
    } catch (error) {
      if (pictureRevision.current === revision) { setImportPending(false); setImportError(errMsg(error)); }
      else toast.error('上一张图片导入失败，请重试');
    }
  }, [editor.job, importReady, libraryId, normalizedFolder, trimmedName]);

  const openImportedFolder = () => {
    if (!importResult) return;
    const path = `${importResult.libraryId}${importResult.result.folder ? `/${importResult.result.folder}` : ''}`;
    void navigate({ to: '/folders', search: { path } });
  };

  if (!isAdmin) {
    return <div className="grid h-full place-items-center p-8 text-[13px] text-muted">只有管理员可以使用图片修复。</div>;
  }

  return (
    <div
      className="h-full overflow-y-auto"
      onDragOver={(event) => { event.preventDefault(); if (tab === 'single' && !uploading) setDragActive(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false); }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        if (uploading || tab !== 'single') return;
        const file = Array.from(event.dataTransfer.files).find(isImageFile);
        if (file) void acceptFile(file);
        else if (event.dataTransfer.files.length) toast.error('请拖入图片文件');
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void acceptFile(file);
          event.target.value = '';
        }}
      />

      {dragActive && <div className="ue-drop-overlay" aria-hidden><span>松开以添加图片</span></div>}

      <div className="mx-auto grid max-w-[1440px] gap-5 px-4 pt-7 pb-24 md:px-11 md:pt-10">
        <header className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="m-0 text-[28px] font-semibold tracking-[-0.02em] md:text-[34px]">修复</h1>
              <Pill tone="accent">{tab === 'single' ? '未入库图片' : '批量处理'}</Pill>
            </div>
            <p className="mt-1 mb-0 max-w-[72ch] text-[13px] text-muted">
              {tab === 'single' ? '拖入、粘贴或选择图片，涂抹要去掉的内容；生成预览可对比，确认后导入媒体库。原图不会被修改。'
                : '查看和管理批量自动修复任务，处理结果保存为新副本。'}
            </p>
          </div>
          <div className="flex gap-2" role="group" aria-label="修复方式">
            <Chip variant={tab === 'single' ? 'primary' : 'outline'} onClick={() => void navigate({ to: '/editor', search: { tab: 'single' } })}>单张修复</Chip>
            <Chip variant={tab === 'batches' ? 'primary' : 'outline'} onClick={() => void navigate({ to: '/editor', search: { tab: 'batches' } })}>批量队列</Chip>
          </div>
        </header>

        {tab === 'batches' ? <BatchAutomationPanel /> : <>
        {uploadError && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[var(--r2)] border border-[color-mix(in_oklab,var(--bad)_35%,transparent)] bg-[color-mix(in_oklab,var(--bad)_8%,transparent)] px-4 py-3 text-[13px]">
            <span className="min-w-0 flex-1 text-bad">{uploadError}</span>
            <Chip size="sm" onClick={() => { setUploadError(null); fileInputRef.current?.click(); }}>重新选择</Chip>
          </div>
        )}

        {caps.isLoading ? (
          <div className="grid min-h-[360px] place-items-center rounded-[var(--r3)] border border-line bg-surface text-[13px] text-muted">正在检测修复能力…</div>
        ) : caps.isError ? (
          <div className="grid min-h-[360px] place-items-center rounded-[var(--r3)] border border-line bg-surface">
            <div className="grid max-w-[420px] gap-3 text-center">
              <b className="text-[15px]">无法读取修复能力</b>
              <p className="m-0 text-[13px] text-muted">{errMsg(caps.error)}</p>
              <div><Chip size="sm" onClick={() => void caps.refetch()}><RefreshCw />重新检测</Chip></div>
            </div>
          </div>
        ) : !availableModels.length ? (
          <div className="grid min-h-[420px] place-items-center rounded-[var(--r3)] border border-line bg-surface">
            <div className="grid max-w-[460px] gap-3 text-center">
              <span aria-hidden className="mx-auto grid size-14 place-items-center rounded-[18px] bg-accent-soft text-accent"><ImagePlus className="size-6" /></span>
              <b className="text-[16px]">图像修复暂不可用</b>
              <p className="m-0 text-[13px] text-muted">{models.find((item) => item.reason)?.reason ?? '推理服务未配置或未启动，部署后这里会自动开放。'}</p>
              <div><Chip size="sm" onClick={() => void caps.refetch()}><RefreshCw />重新检测</Chip></div>
            </div>
          </div>
        ) : uploading ? (
          <div className="grid min-h-[420px] place-items-center rounded-[var(--r3)] border border-line bg-surface">
            <div className="grid w-[min(420px,calc(100%-32px))] gap-3 text-center">
              <span aria-hidden className="mx-auto grid size-14 place-items-center rounded-[18px] bg-accent-soft text-accent"><Upload className="size-6" /></span>
              <b className="truncate text-[15px]">{pendingName}</b>
              <div className="h-1.5 overflow-hidden rounded-full bg-line"><i className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(uploadProgress * 100)}%` }} /></div>
              <div className="flex items-center justify-center gap-3 text-[12.5px] text-muted">
                <span className="tabular-nums">{Math.round(uploadProgress * 100)}%</span>
                <Chip size="sm" onClick={() => uploadAbort.current?.abort()}>取消</Chip>
              </div>
            </div>
          </div>
        ) : !upload ? (
          <button
            type="button"
            className={cn('ue-drop', dragActive && 'is-drag')}
            onClick={() => fileInputRef.current?.click()}
          >
            <span aria-hidden className="ue-drop-icon"><ImagePlus className="size-7" /></span>
            <b>拖入图片、粘贴或选择文件</b>
            <span className="ue-drop-desc">支持 JPG、PNG、WebP、GIF；大图由后端分块处理。图片只暂存在服务端缓存，不会改动原文件。</span>
            <span className="ue-drop-action">选择图片</span>
            <small>也可以在任意位置按 ⌘V / Ctrl+V 粘贴截图</small>
          </button>
        ) : (
          <div className="ue-layout">
            <div ref={stageRef} className="ue-stage">
              {frame && (
                <div className="ue-frame" style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}>
                  <img
                    src={comparing ? upload.sourceUrl : resultUrl ?? upload.sourceUrl}
                    alt={upload.name}
                    draggable={false}
                    onError={() => toast.error(resultUrl ? '修复结果加载失败，请重新生成' : '图片预览加载失败')}
                  />
                  <MaskCanvas
                    key={upload.id}
                    ref={maskRef}
                    item={{ id: upload.id, width: upload.width, height: upload.height }}
                    rotation={0}
                    brush={brush}
                    erase={erase}
                    active={!resultUrl && !editor.busy}
                    maxEdge={maskLimit?.maxEdge ?? 2048}
                    baseMaskUrl={adjustBase?.maskUrl}
                    onChange={setHasMask}
                  />
                  {comparing && <span className="ue-compare">原图</span>}
                </div>
              )}
              <EditorDock
                models={models}
                model={model}
                onModel={setModel}
                brush={brush}
                onBrush={setBrush}
                erase={erase}
                onErase={setErase}
                hasMask={hasMask}
                onUndo={() => maskRef.current?.undo()}
                onClear={() => maskRef.current?.clear()}
                job={adjustBase ? null : editor.job}
                createPending={editor.createPending}
                error={jobError}
                canGenerate={canGenerate}
                generateHint={generateHint}
                onGenerate={() => void generate()}
                onAuto={autoModel ? () => void autoRepair() : undefined}
                canAuto={canAuto}
                onAdjust={editor.job?.maskUrl ? () => { setAdjustBase(editor.job); setComparing(false); } : undefined}
                adjusting={!!adjustBase}
                onCancelAdjust={() => setAdjustBase(null)}
                onCancel={() => void editor.cancel()}
                onReset={resetResult}
                onSave={() => { setImportError(null); setImportOpen(true); }}
                onCompare={setComparing}
                comparing={comparing}
                savedName={importResult?.result.name ?? null}
                savedText={importResult ? (importResult.result.status === 'saved' ? `已导入 ${importResult.result.name}` : `已写入 ${importResult.result.name}，正在入库`) : undefined}
                unsavedText="修复预览 · 未导入"
                resultActionLabel="导入媒体库"
                resultActionIcon={<FolderInput />}
                writeAvailable={importReady}
                writeReason={importBlockReason}
                showDone={false}
              />
            </div>

            <aside className="ue-side">
              <Section title="导入位置" desc="选择媒体库和相对文件夹；不存在的文件夹会按路径创建。">
                <div className="ue-form">
                  <Field label="媒体库" htmlFor="ue-library">
                    <select
                      id="ue-library"
                      className={inputClass}
                      value={libraryId}
                      onChange={(event) => { setLibraryId(event.target.value); setFolder(''); }}
                      disabled={!libraries.length}
                    >
                      {libraries.length ? libraries.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">没有启用的媒体库</option>}
                    </select>
                  </Field>
                  <Field label="文件夹" htmlFor="ue-folder" hint="留空表示媒体库根目录；支持多级路径。">
                    <div className="flex gap-2">
                      <input
                        id="ue-folder"
                        className={inputClass}
                        value={folder}
                        placeholder="例如 2026/07 杭州"
                        onChange={(event) => setFolder(event.target.value)}
                        aria-invalid={!!folderError}
                        disabled={!libraryId}
                      />
                      <Chip size="sm" className="h-[34px]" disabled={!libraryId} onClick={() => setFolderPickerOpen(true)}>浏览</Chip>
                    </div>
                  </Field>
                  {folderError && <p className="m-0 text-[12px] text-bad">{folderError}</p>}
                  <Field label="文件名" htmlFor="ue-name" hint="同名文件不会覆盖。">
                    <input
                      id="ue-name"
                      className={inputClass}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      aria-invalid={!!nameError}
                      disabled={!upload}
                    />
                  </Field>
                  <div className="ue-target">
                    <span>导入到</span>
                    <b>{library?.name ?? '未选择媒体库'}</b>
                    <span aria-hidden className="opacity-40">/</span>
                    <span className="truncate">{normalizedFolder || '根目录'}</span>
                  </div>
                  {resultUrl ? (
                    <div className="ue-note">{importReady ? '生成结果已就绪，点击下方工具栏的「导入媒体库」。' : importBlockReason}</div>
                  ) : (
                    <div className="ue-note">生成预览后，在下方工具栏确认导入。</div>
                  )}
                  {resultUrl && (
                    <Chip
                      variant="primary"
                      className="w-full md:hidden"
                      disabled={!importReady}
                      title={importBlockReason ?? undefined}
                      onClick={() => { setImportError(null); setImportOpen(true); }}
                    >
                      <FolderInput />导入媒体库
                    </Chip>
                  )}
                </div>
              </Section>

              <Section title="图片">
                <div className="ue-form">
                  <dl className="ue-meta">
                    <div><dt>文件</dt><dd className="break-all">{upload.name}</dd></div>
                    <div><dt>尺寸</dt><dd>{upload.width} × {upload.height}（{((upload.width * upload.height) / 1e6).toFixed(1)} 百万像素）</dd></div>
                    <div><dt>大小</dt><dd>{fileSize != null ? formatBytes(fileSize) : '未知'}</dd></div>
                    <div><dt>类型</dt><dd>{upload.mime}</dd></div>
                    <div><dt>暂存</dt><dd className={uploadExpired ? 'text-bad' : undefined}>{uploadExpired ? '已过期，请重新上传' : `至 ${formatWhen(upload.expiresAt) ?? '稍后'}`}</dd></div>
                  </dl>
                  <div className="flex flex-wrap gap-2">
                    <Chip size="sm" onClick={() => fileInputRef.current?.click()}><ImagePlus />更换图片</Chip>
                    <Chip size="sm" onClick={startOver}><X />放弃当前图片</Chip>
                  </div>
                </div>
              </Section>

              {importResult && (
                <Section title={importResult.result.status === 'saved' ? '已导入' : '正在入库'}>
                  <div className="ue-form">
                    <b className="text-[13px] break-all">{importResult.result.name}</b>
                    <div className="ue-target">
                      <span>{libraries.find((item) => item.id === importResult.libraryId)?.name ?? '媒体库'}</span>
                      <span aria-hidden className="opacity-40">/</span>
                      <span className="truncate">{importResult.result.folder || '根目录'}</span>
                    </div>
                    {importResult.result.status === 'pending' && <p className="m-0 text-[12.5px] text-muted">文件已写入磁盘，索引完成后会出现在媒体库中。</p>}
                    <div className="flex flex-wrap gap-2">
                      <Chip size="sm" variant="primary" onClick={openImportedFolder}>打开文件夹</Chip>
                      <Chip size="sm" onClick={startOver}>再处理一张</Chip>
                    </div>
                  </div>
                </Section>
              )}

              {!libraries.length && !librariesQuery.isLoading && (
                <div className="rounded-[var(--r2)] border border-[color-mix(in_oklab,var(--warn)_35%,transparent)] bg-[color-mix(in_oklab,var(--warn)_8%,transparent)] px-4 py-3 text-[12.5px] text-warn">
                  没有启用的媒体库，暂时无法导入。可以先修复并预览，启用媒体库后再导入。
                </div>
              )}
            </aside>
          </div>
        )}
        </>}
      </div>

      {folderPickerOpen && library && (
        <FolderPickerDialog
          library={library}
          initialPath={`${library.id}${normalizedFolder ? `/${normalizedFolder}` : ''}`}
          onClose={() => setFolderPickerOpen(false)}
          onPick={(picked) => { setFolder(picked); setFolderPickerOpen(false); }}
        />
      )}

      <Modal
        open={importOpen}
        onOpenChange={(value) => { if (!value && !importPending) { setImportOpen(false); setImportError(null); } }}
        title="导入媒体库"
        desc="确认目标位置与文件名；同名文件会自动追加序号，不会覆盖已有文件。"
        footer={<><Chip disabled={importPending} onClick={() => { setImportOpen(false); setImportError(null); }}>取消</Chip><Chip variant="primary" disabled={importPending || !importReady} onClick={() => void handleImport()}>{importPending ? '正在导入…' : '导入'}</Chip></>}
      >
        <div className="ue-import">
          <div><span>媒体库</span><b>{library?.name ?? '—'}</b></div>
          <div><span>文件夹</span><b>{normalizedFolder || '根目录'}</b></div>
          <div><span>文件名</span><b className="break-all">{trimmedName || '—'}</b></div>
          {importError && <p className="m-0 text-[12.5px] text-bad" role="alert">{importError}</p>}
        </div>
      </Modal>
    </div>
  );
}
