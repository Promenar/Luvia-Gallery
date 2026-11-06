/** SQLite 暂时繁忙或被锁（例如检查点短暂占用写锁），稍后重试即可。 */
export function isTransientSqliteError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED'));
}

/**
 * 定时续租一次：续租返回 false（租约已被收回）或出现其它错误时中止；数据库暂时繁忙时跳过，下一轮再续。
 * 租约有效期是续租间隔的数倍，跳过一次不会失效；繁忙就中止会把正常运行的作业判为失败。
 */
export function renewLease(renew: () => boolean, abort: () => void): void {
  try { if (!renew()) abort(); }
  catch (error) { if (!isTransientSqliteError(error)) abort(); }
}
