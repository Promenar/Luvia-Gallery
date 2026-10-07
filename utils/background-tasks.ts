/** 后台任务（媒体库扫描、缩略图生成）在前端的展示规则。 */

export type BackgroundTaskSnapshot = {
  status?: string;
  /** 扫描触发来源：manual 为用户在界面启动，periodic 为服务端定时扫描 */
  trigger?: string;
} | null | undefined;

export const isBackgroundTaskActive = (status: string | undefined | null): boolean =>
  status === 'scanning' || status === 'paused';

/**
 * 页面加载时是否自动弹出任务进度窗口：手动扫描与缩略图任务弹出；
 * 定时扫描只在侧边栏显示同步状态，避免刷新页面恰逢后台扫描时打断浏览。
 */
export const shouldAutoOpenTaskProgress = (scan: BackgroundTaskSnapshot, thumb: BackgroundTaskSnapshot): boolean =>
  (isBackgroundTaskActive(scan?.status) && scan?.trigger !== 'periodic')
  || isBackgroundTaskActive(thumb?.status);
