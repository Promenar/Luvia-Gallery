/** 过期或无效的心跳不能表明工作进程已就绪。 */
export function workerReady(heartbeat: { at?: number; healthy?: boolean } | null, now: number): boolean {
  return heartbeat?.healthy === true && typeof heartbeat.at === 'number' && Number.isFinite(heartbeat.at) && now - heartbeat.at >= -5 && now - heartbeat.at < 20;
}
