/**
 * 并发运行若干通道：任一通道出错时让其它通道停止（stop），并抛出最先发生的那个错误。
 * 其它通道随之抛出的中止错误不能顶替它：例如数据库暂时繁忙应放回队列，被顶替成中止错误就会把作业判为失败。
 */
export async function runLanes(count: number, stop: AbortController, lane: () => Promise<void>): Promise<void> {
  let first: { error: unknown } | undefined;
  await Promise.allSettled(Array.from({ length: count }, async () => {
    try { await lane(); } catch (error) { first ??= { error }; stop.abort(); throw error; }
  }));
  if (first) throw first.error;
}
