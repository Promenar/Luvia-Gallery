import { coreHandlers } from './core';

/**
 * 模拟接口汇总。各功能区在 handlers/<area>.ts 中维护自己的处理器并在此登记；
 * 越具体的路径要排在越前面（例如 /api/v2/media/random 先于 /api/v2/media/:id）。
 */
export const handlers = [...coreHandlers];
