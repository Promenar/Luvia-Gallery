import { coreHandlers } from './core';
import { adminHandlers } from './admin';
import { albumHandlers } from './albums';
import { editorHandlers } from './editor';
import { folderHandlers } from './folders';
import { photosHandlers } from './photos';

/** 需先于 core 生效的拦截（未命中时返回 undefined 交给 core）：文件夹 404、媒体列表的相册范围。 */
const beforeCore = [...folderHandlers, ...albumHandlers];

/**
 * 模拟接口汇总。各功能区在 handlers/<area>.ts 中维护自己的处理器并在此登记；
 * 越具体的路径要排在越前面（例如 /api/v2/media/random 先于 /api/v2/media/:id）。
 */
export const handlers = [...beforeCore, ...coreHandlers, ...adminHandlers, ...editorHandlers, ...photosHandlers];
