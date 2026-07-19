const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
    canCleanUpScan,
    collectCacheStats,
    createBackgroundTaskCoordinator,
    findMissingDatabaseRows,
    getScanStartResponse,
    reconcileScannedFiles,
    statPathBatch,
    tryStartScan,
    walkMediaFiles
} = require('../lib/background-file-walker');

async function withTempDirectory(callback) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'luvia-walker-'));
    try {
        await callback(directory);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
}

test('递归统计缓存中的 webp 文件，不统计其它文件', async () => {
    await withTempDirectory(async (root) => {
        await fs.mkdir(path.join(root, 'aa', 'bb'), { recursive: true });
        await fs.writeFile(path.join(root, 'top.webp'), '1234');
        await fs.writeFile(path.join(root, 'aa', 'middle.webp'), '123');
        await fs.writeFile(path.join(root, 'aa', 'bb', 'bottom.webp'), '12');
        await fs.writeFile(path.join(root, 'aa', 'ignore.jpg'), '123456');

        const stats = await collectCacheStats(root, { concurrency: 2, batchSize: 1 });

        assert.deepEqual(stats, { count: 3, size: 9 });
    });
});

test('媒体遍历器过滤扩展名，并且每批不超过指定大小', async () => {
    await withTempDirectory(async (root) => {
        await fs.mkdir(path.join(root, 'nested'), { recursive: true });
        await Promise.all([
            fs.writeFile(path.join(root, 'one.jpg'), 'a'),
            fs.writeFile(path.join(root, 'two.mp4'), 'b'),
            fs.writeFile(path.join(root, 'ignore.txt'), 'c'),
            fs.writeFile(path.join(root, '.hidden.png'), 'd'),
            fs.writeFile(path.join(root, 'nested', 'three.flac'), 'e')
        ]);

        const batches = [];
        for await (const batch of walkMediaFiles([root], { batchSize: 2, concurrency: 2 })) {
            batches.push(batch);
        }

        assert.ok(batches.every(batch => batch.length <= 2));
        const names = batches.flat().map(file => file.name).sort();
        assert.deepEqual(names, ['one.jpg', 'three.flac', 'two.mp4']);
        assert.ok(batches.flat().every(file => file.stats.size === 1));
    });
});

test('媒体遍历器在批次边界响应停止条件', async () => {
    await withTempDirectory(async (root) => {
        await Promise.all(Array.from({ length: 6 }, (_, index) => (
            fs.writeFile(path.join(root, `${index}.jpg`), 'x')
        )));

        let yielded = 0;
        for await (const batch of walkMediaFiles([root], {
            batchSize: 1,
            shouldStop: () => yielded >= 2
        })) {
            yielded += batch.length;
        }

        assert.equal(yielded, 2);
    });
});

test('长遍历在每批让出事件循环，使定时器能够执行', async () => {
    await withTempDirectory(async (root) => {
        await Promise.all(Array.from({ length: 80 }, (_, index) => (
            fs.writeFile(path.join(root, `${index}.jpg`), 'x')
        )));

        let timerFired = false;
        const timer = setTimeout(() => {
            timerFired = true;
        }, 0);

        for await (const _batch of walkMediaFiles([root], { batchSize: 1, concurrency: 4 })) {
            // 消费所有批次以验证遍历期间的调度让出。
        }

        clearTimeout(timer);
        assert.equal(timerFired, true);
    });
});

test('大目录通过 opendir 流式读取并在固定条目后让出事件循环', async () => {
    await withTempDirectory(async (root) => {
        await Promise.all(Array.from({ length: 320 }, (_, index) => (
            fs.writeFile(path.join(root, `${index}.jpg`), 'x')
        )));

        let openDirectoryCalls = 0;
        let timerFired = false;
        const timer = setTimeout(() => {
            timerFired = true;
        }, 0);

        for await (const _batch of walkMediaFiles([root], {
            batchSize: 32,
            entryYieldEvery: 32,
            openDirectory: async directory => {
                openDirectoryCalls++;
                return fs.opendir(directory);
            }
        })) {
            // 消费所有批次，验证目录迭代期间的调度让出。
        }

        clearTimeout(timer);
        assert.equal(openDirectoryCalls, 1);
        assert.equal(timerFired, true);
    });
});

test('只包含隐藏文件的大目录仍会按固定条目让出事件循环', async () => {
    await withTempDirectory(async (root) => {
        await Promise.all(Array.from({ length: 160 }, (_, index) => (
            fs.writeFile(path.join(root, `.hidden-${index}.jpg`), 'x')
        )));

        let timerFired = false;
        const timer = setTimeout(() => {
            timerFired = true;
        }, 0);

        for await (const _batch of walkMediaFiles([root], {
            batchSize: 32,
            entryYieldEvery: 16
        })) {
            // 隐藏文件不会形成媒体批次，但目录遍历仍必须让出事件循环。
        }

        clearTimeout(timer);
        assert.equal(timerFired, true);
    });
});

test('数据库清理只返回本轮未扫描到的记录', () => {
    const scannedPaths = new Set(['/media/a.jpg', '/media/c.mp4']);
    const rows = [
        { rowid: 1, id: 'a', path: '/media/a.jpg' },
        { rowid: 2, id: 'b', path: '/media/b.jpg' },
        { rowid: 3, id: 'c', path: '/media/c.mp4' }
    ];

    assert.deepEqual(findMissingDatabaseRows(rows, scannedPaths), [rows[1]]);
});

test('目录和 stat 错误都会通过回调报告，且 stat 并发受上限约束', async () => {
    const errors = [];
    let activeStats = 0;
    let peakStats = 0;
    const files = ['/virtual/a.jpg', '/virtual/b.jpg', '/virtual/c.jpg'];
    const stats = await statPathBatch(files, {
        concurrency: 2,
        stat: async filePath => {
            activeStats++;
            peakStats = Math.max(peakStats, activeStats);
            await new Promise(resolve => setImmediate(resolve));
            activeStats--;
            if (filePath.endsWith('b.jpg')) throw new Error('stat denied');
            return { isFile: () => true, size: 1 };
        },
        onError: (error, target) => errors.push({ error, target })
    });

    assert.equal(peakStats <= 2, true);
    assert.equal(stats.filter(Boolean).length, 2);
    assert.equal(errors[0].target, '/virtual/b.jpg');

    const directoryErrors = [];
    const batches = [];
    for await (const batch of walkMediaFiles(['/unreadable'], {
        openDirectory: async () => { throw new Error('directory denied'); },
        onError: (error, target) => directoryErrors.push({ error, target })
    })) {
        batches.push(batch);
    }
    assert.deepEqual(batches, []);
    assert.equal(directoryErrors[0].target, '/unreadable');
});

test('扫描不完整或停止时拒绝清理，只有完整扫描允许清理', () => {
    assert.equal(canCleanUpScan({ scanIncomplete: false, shouldStop: false }), true);
    assert.equal(canCleanUpScan({ scanIncomplete: true, shouldStop: false }), false);
    assert.equal(canCleanUpScan({ scanIncomplete: false, shouldStop: true }), false);
});

test('扫描不完整时真实清理流程不会读取或删除数据库记录', async () => {
    let readCalls = 0;
    let deleteCalls = 0;
    const result = await reconcileScannedFiles({
        database: {
            getFilesAfterRowid: () => { readCalls++; return []; },
            deleteFilesBatch: () => { deleteCalls++; return true; }
        },
        scannedPaths: new Set(),
        scanIncomplete: true,
        shouldStop: () => false
    });

    assert.equal(result.skipped, true);
    assert.equal(readCalls, 0);
    assert.equal(deleteCalls, 0);
});

test('清理过程中收到停止请求后不再读取或删除后续批次', async () => {
    let stopped = false;
    let readCalls = 0;
    let deleteCalls = 0;
    const result = await reconcileScannedFiles({
        database: {
            getFilesAfterRowid: () => {
                readCalls++;
                return [{ rowid: readCalls, id: `missing-${readCalls}`, path: `/missing/${readCalls}.jpg` }];
            },
            deleteFilesBatch: () => {
                deleteCalls++;
                stopped = true;
                return true;
            }
        },
        scannedPaths: new Set(),
        scanIncomplete: false,
        shouldStop: () => stopped,
        batchSize: 1
    });

    assert.equal(result.incomplete, true);
    assert.equal(result.deletedCount, 1);
    assert.equal(readCalls, 1);
    assert.equal(deleteCalls, 1);
});

test('协调器冲突不重置进行中的扫描状态，并返回忙响应', async () => {
    const coordinator = createBackgroundTaskCoordinator();
    let release;
    const currentTask = coordinator.run('media-scan', () => new Promise(resolve => {
        release = resolve;
    }));
    const scanState = {
        status: 'paused',
        count: 42,
        currentPath: '/library/current',
        shouldStop: false,
        shouldPause: true
    };

    const result = tryStartScan(coordinator, scanState, async () => {});

    assert.equal(result.started, false);
    assert.deepEqual(scanState, {
        status: 'paused',
        count: 42,
        currentPath: '/library/current',
        shouldStop: false,
        shouldPause: true
    });
    assert.deepEqual(getScanStartResponse(result.started), {
        statusCode: 409,
        body: { success: false, error: 'Scan already running' }
    });

    release();
    await currentTask;
});

test('缓存统计与媒体扫描不能同时运行', async () => {
    const coordinator = createBackgroundTaskCoordinator();
    let releaseCache;
    const cacheTask = coordinator.run('cache', () => new Promise(resolve => {
        releaseCache = resolve;
    }));

    assert.equal(coordinator.isBusy(), true);
    assert.equal(coordinator.run('scan', async () => {}), false);
    releaseCache();
    await cacheTask;

    let releaseScan;
    const scanTask = coordinator.run('scan', () => new Promise(resolve => {
        releaseScan = resolve;
    }));

    assert.equal(coordinator.isBusy(), true);
    assert.equal(coordinator.run('cache', async () => {}), false);
    releaseScan();
    await scanTask;
    assert.equal(coordinator.isBusy(), false);
});
