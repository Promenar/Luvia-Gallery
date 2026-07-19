const fs = require('fs');
const path = require('path');

const MEDIA_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.mp4', '.webm', '.mov',
    '.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.wma'
]);

function shouldStop(options) {
    return typeof options.shouldStop === 'function' && options.shouldStop();
}

function reportError(options, error, target) {
    if (typeof options.onError === 'function') {
        try {
            options.onError(error, target);
        } catch (_) {
            // 错误回调不能中断后台遍历。
        }
    }
}

function yieldToEventLoop() {
    return new Promise(resolve => setImmediate(resolve));
}

async function* readDirectory(directory, options) {
    const openDirectory = typeof options.openDirectory === 'function'
        ? options.openDirectory
        : fs.promises.opendir;
    let handle;

    try {
        handle = await openDirectory(directory);
    } catch (error) {
        reportError(options, error, directory);
        return;
    }

    try {
        for await (const entry of handle) {
            yield entry;
        }
    } catch (error) {
        reportError(options, error, directory);
    } finally {
        try {
            await handle.close();
        } catch (_) {
            // 异步迭代器通常已自动关闭目录句柄。
        }
    }
}

async function statPathBatch(paths, options = {}) {
    const concurrency = Math.max(1, options.concurrency || 16);
    const stat = typeof options.stat === 'function' ? options.stat : fs.promises.stat;
    const results = new Array(paths.length);
    let nextIndex = 0;

    async function worker() {
        while (!shouldStop(options)) {
            const index = nextIndex++;
            if (index >= paths.length) return;

            const filePath = paths[index];
            try {
                results[index] = await stat(filePath);
            } catch (error) {
                reportError(options, error, filePath);
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
    return results;
}

async function collectCacheStats(root, options = {}) {
    const directories = [root];
    let directoryIndex = 0;
    const batchSize = Math.max(1, options.batchSize || 256);
    const entryYieldEvery = Math.max(1, options.entryYieldEvery || batchSize);
    let count = 0;
    let size = 0;

    while (directoryIndex < directories.length && !shouldStop(options)) {
        const directory = directories[directoryIndex++];
        let cacheFiles = [];
        let entryCount = 0;

        for await (const entry of readDirectory(directory, options)) {
            if (shouldStop(options)) break;
            entryCount++;
            if (entry.isDirectory()) {
                directories.push(path.join(directory, entry.name));
            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.webp')) {
                cacheFiles.push(path.join(directory, entry.name));
            }

            if (cacheFiles.length >= batchSize) {
                const stats = await statPathBatch(cacheFiles, options);
                for (const fileStats of stats) {
                    if (fileStats && fileStats.isFile()) {
                        count++;
                        size += fileStats.size;
                    }
                }
                cacheFiles = [];
                await yieldToEventLoop();
            } else if (entryCount % entryYieldEvery === 0) {
                await yieldToEventLoop();
            }
        }

        if (cacheFiles.length > 0 && !shouldStop(options)) {
            const stats = await statPathBatch(cacheFiles, options);
            for (const fileStats of stats) {
                if (fileStats && fileStats.isFile()) {
                    count++;
                    size += fileStats.size;
                }
            }
            await yieldToEventLoop();
        }
    }

    return { count, size };
}

async function* walkMediaFiles(roots, options = {}) {
    const directories = Array.isArray(roots) ? [...roots] : [roots];
    let directoryIndex = 0;
    const batchSize = Math.max(1, options.batchSize || 256);
    const entryYieldEvery = Math.max(1, options.entryYieldEvery || batchSize);

    while (directoryIndex < directories.length && !shouldStop(options)) {
        const directory = directories[directoryIndex++];
        if (typeof options.onDirectory === 'function') {
            try {
                options.onDirectory(directory);
            } catch (error) {
                reportError(options, error, directory);
            }
        }

        let mediaPaths = [];
        let entryCount = 0;
        for await (const entry of readDirectory(directory, options)) {
            if (shouldStop(options)) break;
            entryCount++;
            if (entry.name.startsWith('.')) {
                if (entryCount % entryYieldEvery === 0) await yieldToEventLoop();
                continue;
            }
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                directories.push(fullPath);
            } else if (entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
                mediaPaths.push(fullPath);
            }

            if (mediaPaths.length >= batchSize) {
                const stats = await statPathBatch(mediaPaths, options);
                const batch = mediaPaths.flatMap((filePath, index) => (
                    stats[index] && stats[index].isFile()
                        ? [{ path: filePath, name: path.basename(filePath), stats: stats[index] }]
                        : []
                ));
                mediaPaths = [];
                if (batch.length > 0) yield batch;
                await yieldToEventLoop();
            } else if (entryCount % entryYieldEvery === 0) {
                await yieldToEventLoop();
            }
        }

        if (mediaPaths.length > 0 && !shouldStop(options)) {
            const stats = await statPathBatch(mediaPaths, options);
            const batch = mediaPaths.flatMap((filePath, index) => (
                stats[index] && stats[index].isFile()
                    ? [{ path: filePath, name: path.basename(filePath), stats: stats[index] }]
                    : []
            ));
            if (batch.length > 0) yield batch;
            await yieldToEventLoop();
        }
    }
}

function canCleanUpScan({ scanIncomplete, shouldStop }) {
    return !scanIncomplete && !shouldStop;
}

function findMissingDatabaseRows(rows, scannedPaths) {
    return rows.filter(row => !scannedPaths.has(row.path));
}

async function reconcileScannedFiles({
    database,
    scannedPaths,
    scanIncomplete,
    shouldStop,
    batchSize = 256,
    onError
}) {
    const stopped = typeof shouldStop === 'function' && shouldStop();
    if (!canCleanUpScan({ scanIncomplete, shouldStop: stopped })) {
        return { skipped: true, incomplete: Boolean(scanIncomplete || stopped), deletedCount: 0 };
    }

    let lastRowid = 0;
    let deletedCount = 0;
    try {
        while (!(typeof shouldStop === 'function' && shouldStop())) {
            const rows = database.getFilesAfterRowid(lastRowid, batchSize);
            if (rows.length === 0) {
                return { skipped: false, incomplete: false, deletedCount };
            }
            lastRowid = rows[rows.length - 1].rowid;
            const missingFiles = findMissingDatabaseRows(rows, scannedPaths);
            if (missingFiles.length > 0) {
                if (!database.deleteFilesBatch(missingFiles)) {
                    return { skipped: false, incomplete: true, deletedCount };
                }
                deletedCount += missingFiles.length;
            }
            await yieldToEventLoop();
        }
    } catch (error) {
        if (typeof onError === 'function') onError(error);
        return { skipped: false, incomplete: true, deletedCount };
    }

    return { skipped: false, incomplete: true, deletedCount };
}

function getScanStartResponse(started) {
    return started
        ? { statusCode: 200, body: { success: true } }
        : { statusCode: 409, body: { success: false, error: 'Scan already running' } };
}

function tryStartScan(coordinator, scanState, task) {
    const scheduled = coordinator.run('media-scan', async () => {
        scanState.status = 'scanning';
        scanState.shouldPause = false;
        scanState.shouldStop = false;
        scanState.count = 0;
        await task();
    });
    return scheduled === false
        ? { started: false, task: null }
        : { started: true, task: scheduled };
}

function createBackgroundTaskCoordinator() {
    let activeTask = null;

    return {
        isBusy: () => activeTask !== null,
        currentTask: () => activeTask,
        run(name, task) {
            if (activeTask !== null) return false;
            activeTask = name;
            let result;
            try {
                result = task();
            } catch (error) {
                activeTask = null;
                return Promise.reject(error);
            }
            return Promise.resolve(result).finally(() => {
                activeTask = null;
            });
        }
    };
}

module.exports = {
    canCleanUpScan,
    collectCacheStats,
    createBackgroundTaskCoordinator,
    findMissingDatabaseRows,
    getScanStartResponse,
    reconcileScannedFiles,
    statPathBatch,
    tryStartScan,
    walkMediaFiles
};
