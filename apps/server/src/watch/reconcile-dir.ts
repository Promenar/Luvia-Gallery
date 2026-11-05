export interface DirectoryEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
  dev: number | string | null;
  ino: number | string | null;
}

export function diffDirectory<T extends DirectoryEntry, I extends DirectoryEntry>(entries: T[], indexed: I[]): { added: T[]; changed: T[]; vanished: I[]; newSubdirs: T[] } {
  const previous = new Map(indexed.map((entry) => [entry.name, entry]));
  const current = new Map(entries.map((entry) => [entry.name, entry]));
  const added: T[] = []; const changed: T[] = []; const newSubdirs: T[] = [];
  for (const entry of entries) {
    const old = previous.get(entry.name);
    if (!old || old.isDir !== entry.isDir) {
      added.push(entry); if (entry.isDir) newSubdirs.push(entry);
    } else if (!entry.isDir && (entry.size !== old.size || entry.mtimeMs !== old.mtimeMs || entry.dev !== old.dev || entry.ino !== old.ino)) changed.push(entry);
  }
  const vanished = indexed.filter((old) => !current.has(old.name) || current.get(old.name)!.isDir !== old.isDir);
  return { added, changed, vanished, newSubdirs };
}
