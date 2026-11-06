/** 访问权限变化后重新建立页面状态，避免保留过期的媒体及管理数据。 */
export function reloadForAccessChange(): void { window.location.reload(); }
