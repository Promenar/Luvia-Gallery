/**
 * 释放媒体元素占用的网络连接。
 *
 * 浏览器在 <video>/<audio> 从页面移除后并不会立即中止下载，连接要等元素被回收才断开；
 * HTTP/1.1 下同一主机只有 6 个连接，几个悬停预览就能让缩略图与接口请求全部排队。
 * 卸载前移除 src 并调用 load()，按规范会中止进行中的资源获取并立即释放连接。
 */
export function releaseMediaElement(element: HTMLMediaElement | null | undefined): void {
  if (!element) return;
  try {
    element.pause();
  } catch {
    // 部分测试环境未实现 pause，忽略
  }
  if (!element.hasAttribute('src') && !element.currentSrc) return;
  element.removeAttribute('src');
  try {
    element.load();
  } catch {
    // 部分测试环境未实现 load，忽略
  }
}
