import { readFile } from 'node:fs/promises';
import type { LibraryWatch } from '@luvia/contracts';

type Decision = Pick<LibraryWatch, 'state' | 'degradedReason'>;
export function decideWatchMode(options: { requested: LibraryWatch['mode']; fsType: string | null; dirCount: number; quota: number | null; pollIntervalSec?: number }): Decision {
  const { requested, dirCount, quota } = options;
  if (requested === 'off') return { state: 'off', degradedReason: null };
  if (requested === 'poll') return { state: 'polling', degradedReason: null };
  const fsType = options.fsType?.toLowerCase() ?? '';
  const interval = options.pollIntervalSec ?? 300;
  const intervalText = interval % 60 === 0 ? `${interval / 60} 分钟` : `${interval} 秒`;
  let reason: string | null = null;
  if (['nfs', 'nfs4', 'cifs', 'smb3', '9p', 'fuse'].includes(fsType) || fsType.startsWith('fuse.')) {
    reason = `网络文件系统 ${fsType} 不支持实时事件，已改为每 ${intervalText}对账`;
  } else if (quota !== null && dirCount > Math.max(0, quota) * 0.8) {
    reason = `目录数 ${dirCount} 超过剩余监视额度的 80%，已改为轮询；可调高 fs.inotify.max_user_watches`;
  }
  return reason ? { state: requested === 'watch' ? 'degraded' : 'polling', degradedReason: reason } : { state: 'watching', degradedReason: null };
}

export async function readInotifyQuota(): Promise<number | null> {
  if (process.platform !== 'linux') return null;
  try {
    const value = Number((await readFile('/proc/sys/fs/inotify/max_user_watches', 'utf8')).trim());
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch { return null; }
}
