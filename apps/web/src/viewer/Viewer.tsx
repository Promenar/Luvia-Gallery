import { useViewer } from '@/stores/viewer';

/** 占位：全屏查看器，由查看器功能区实现。 */
export function Viewer() {
  const close = useViewer((s) => s.close);
  return <div role="dialog" aria-modal className="fixed inset-0 z-50 bg-black" onClick={close} />;
}
