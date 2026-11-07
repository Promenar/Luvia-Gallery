/** 五秒采样窗口中持续延迟才改变健康状态；原始延迟仍由监控指标报告。 */
export class HealthWindow {
  private consecutiveSlow = 0;

  observe(p99: number): boolean {
    this.consecutiveSlow = p99 > 50 ? this.consecutiveSlow + 1 : 0;
    return this.consecutiveSlow < 3;
  }
}

/** 过期或无效的心跳不能表明工作进程已就绪。 */
export function workerReady(heartbeat: { at?: number; healthy?: boolean } | null, now: number): boolean {
  return heartbeat?.healthy === true && typeof heartbeat.at === 'number' && Number.isFinite(heartbeat.at) && now - heartbeat.at >= -5 && now - heartbeat.at < 20;
}
