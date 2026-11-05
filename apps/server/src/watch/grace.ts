export function classifyMissing(options: { missingAt: number; now: number; missingGraceDays: number; present: boolean; nextReconcile: boolean }): 'pending' | 'restored' | 'removed' {
  const { missingAt, now, missingGraceDays, present, nextReconcile } = options;
  if (missingGraceDays === 0) {
    if (present && !nextReconcile) return 'restored';
    return nextReconcile ? 'removed' : 'pending';
  }
  if (now > missingAt + missingGraceDays * 86_400_000) return 'removed';
  return present ? 'restored' : 'pending';
}
