import type Database from 'better-sqlite3';
import { AdminSettings } from '@luvia/contracts';
import type { z } from 'zod';

type Settings = z.output<typeof AdminSettings>;
const defaults: Settings = {
  siteName: 'Luvia Gallery', publicUrl: null,
  libraries: { autoEnableNewMounts: false, missingGraceDays: 7 }, folders: { exposeHostPaths: false },
  scan: { mode: 'daily', intervalMinutes: 60, dailyAt: '04:00' },
  workers: { thumbnailConcurrency: 4, ffmpegConcurrency: 2 },
  transcode: { enabled: true, hwaccel: 'auto' }, previews: { enabled: true }, cache: { limitGB: 20 },
};
export function readSettings(db: Database.Database): Settings {
  const row = db.prepare("SELECT value FROM settings WHERE key='admin.settings'").get() as { value: string } | undefined;
  const saved = row ? JSON.parse(row.value) as Partial<Settings> : {};
  const site = db.prepare("SELECT value FROM settings WHERE key='siteName'").get() as { value: string } | undefined;
  return AdminSettings.parse({ ...defaults, ...saved, siteName: site ? JSON.parse(site.value) : saved.siteName ?? defaults.siteName,
    libraries: { ...defaults.libraries, ...saved.libraries }, folders: { ...defaults.folders, ...saved.folders }, scan: { ...defaults.scan, ...saved.scan },
    workers: { ...defaults.workers, ...saved.workers }, transcode: { ...defaults.transcode, ...saved.transcode },
    previews: { ...defaults.previews, ...saved.previews }, cache: { ...defaults.cache, ...saved.cache } });
}
export function writeSettings(db: Database.Database, patch: Partial<Settings>): Settings {
  return db.transaction(() => {
    const current = readSettings(db);
    const next = AdminSettings.parse({ ...current, ...patch,
      libraries: { ...current.libraries, ...patch.libraries }, folders: { ...current.folders, ...patch.folders }, scan: { ...current.scan, ...patch.scan },
      workers: { ...current.workers, ...patch.workers }, transcode: { ...current.transcode, ...patch.transcode },
      previews: { ...current.previews, ...patch.previews }, cache: { ...current.cache, ...patch.cache } });
    const save = db.prepare('INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
    save.run('admin.settings', JSON.stringify(next));
    save.run('siteName', JSON.stringify(next.siteName));
    save.run('folders.exposeHostPaths', JSON.stringify(next.folders.exposeHostPaths));
    if (next.scan.mode !== current.scan.mode || next.scan.intervalMinutes !== current.scan.intervalMinutes) db.prepare("DELETE FROM settings WHERE key='scan.scheduler'").run();
    return next;
  }).immediate();
}
