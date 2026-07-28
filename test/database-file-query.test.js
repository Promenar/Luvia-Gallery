const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');
const BetterSqlite3 = require('better-sqlite3');

function loadIsolatedDatabaseModule() {
    const databasePath = require.resolve('../database');
    const originalLoad = Module._load;

    delete require.cache[databasePath];
    Module._load = function isolatedDatabaseLoad(request, parent, isMain) {
        if (parent && parent.filename === databasePath) {
            if (request === 'better-sqlite3') {
                return function MemoryDatabase() {
                    return new BetterSqlite3(':memory:');
                };
            }
            if (request === 'fs') {
                const realFs = originalLoad.call(this, request, parent, isMain);
                return {
                    ...realFs,
                    existsSync: () => false,
                    mkdirSync: () => undefined
                };
            }
        }
        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(databasePath);
    } finally {
        Module._load = originalLoad;
    }
}

const database = loadIsolatedDatabaseModule();

function addFile({
    id,
    path,
    name,
    folderPath,
    mediaType = 'image',
    sourceId = 'source-a',
    lastModified = 1
}) {
    database.upsertFile({
        id,
        path,
        name,
        folderPath,
        size: 1,
        type: 'file',
        mediaType,
        lastModified,
        sourceId
    });
}

test.beforeEach(() => {
    database.initDatabase();
});

test.afterEach(() => {
    database.closeDatabase();
});

test('queryFiles 与 countFiles 复用全部过滤条件，直接收藏可与搜索组合', () => {
    addFile({
        id: 'direct-favorite',
        path: '/library/trips/2026/holiday sunset.jpg',
        name: 'holiday sunset.jpg',
        folderPath: '/library/trips/2026',
        lastModified: 10
    });
    addFile({
        id: 'excluded-video',
        path: '/library/trips/2026/holiday sunset.mp4',
        name: 'holiday sunset.mp4',
        folderPath: '/library/trips/2026',
        mediaType: 'video',
        lastModified: 10
    });
    addFile({
        id: 'wrong-source',
        path: '/library/trips/2026/holiday beach.jpg',
        name: 'holiday beach.jpg',
        folderPath: '/library/trips/2026',
        sourceId: 'source-b'
    });
    database.toggleFavorite('user-a', 'direct-favorite', 'file');
    database.toggleFavorite('user-a', 'excluded-video', 'file');

    const options = {
        folderPath: '/library/trips',
        recursive: true,
        allowedPaths: ['/library'],
        search: 'holiday sunset',
        mediaType: ['image', 'video'],
        excludeMediaType: ['video'],
        favoritesOnly: true,
        userId: 'user-a',
        sourceId: 'source-a'
    };
    const files = database.queryFiles(options);

    assert.deepEqual(files.map(file => file.id), ['direct-favorite']);
    assert.equal(files[0].isFavorite, true);
    assert.equal(database.countFiles(options), files.length);
});

test('递归目录仅包含自身与后代，不包含同前缀兄弟，根目录可覆盖绝对路径', () => {
    addFile({
        id: 'child',
        path: '/album/a/child/photo.jpg',
        name: 'photo.jpg',
        folderPath: '/album/a/child'
    });
    addFile({
        id: 'prefix-sibling',
        path: '/album/ab/photo.jpg',
        name: 'photo.jpg',
        folderPath: '/album/ab'
    });

    assert.deepEqual(
        database.queryFiles({ folderPath: '/album/a', recursive: true }).map(file => file.id),
        ['child']
    );
    assert.equal(database.countFiles({ folderPath: '/', recursive: true }), 2);
});

test('folderPath 中的百分号和下划线按字面匹配', () => {
    addFile({
        id: 'literal-path',
        path: '/library/100%_raw/child/photo.jpg',
        name: 'photo.jpg',
        folderPath: '/library/100%_raw/child'
    });
    addFile({
        id: 'wildcard-lookalike',
        path: '/library/100XXraw/child/photo.jpg',
        name: 'photo.jpg',
        folderPath: '/library/100XXraw/child'
    });

    const options = { folderPath: '/library/100%_raw', recursive: true };
    assert.deepEqual(database.queryFiles(options).map(file => file.id), ['literal-path']);
    assert.equal(database.countFiles(options), 1);
});

test('allowedPaths 中的反斜杠按字面匹配', () => {
    addFile({
        id: 'literal-backslash',
        path: '/library/back\\slash/photo.jpg',
        name: 'photo.jpg',
        folderPath: '/library/back\\slash'
    });
    addFile({
        id: 'backslash-lookalike',
        path: '/library/backXslash/photo.jpg',
        name: 'photo.jpg',
        folderPath: '/library/backXslash'
    });

    const options = { allowedPaths: ['/library/back\\slash'] };
    assert.deepEqual(database.queryFiles(options).map(file => file.id), ['literal-backslash']);
    assert.equal(database.countFiles(options), 1);
});

test('特殊 FTS 输入按普通文本搜索，空白搜索不启用 MATCH', () => {
    addFile({
        id: 'special-search',
        path: '/library/sunset draft raw.jpg',
        name: 'sunset draft raw.jpg',
        folderPath: '/library'
    });

    assert.deepEqual(
        database.queryFiles({ search: 'sunset -(draft) "raw"' }).map(file => file.id),
        ['special-search']
    );
    assert.equal(database.countFiles({ search: '  \t\n ' }), 1);
});
