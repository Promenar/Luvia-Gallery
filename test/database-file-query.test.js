const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const BetterSqlite3 = require('better-sqlite3');

const preparedSql = [];
const preparedGetCalls = [];
let inMemoryDatabase = null;

function loadIsolatedDatabaseModule() {
    const databasePath = require.resolve('../database');
    const originalLoad = Module._load;

    delete require.cache[databasePath];
    Module._load = function isolatedDatabaseLoad(request, parent, isMain) {
        if (parent && parent.filename === databasePath) {
            if (request === 'better-sqlite3') {
                return function MemoryDatabase() {
                    const memoryDatabase = new BetterSqlite3(':memory:');
                    const prepare = memoryDatabase.prepare.bind(memoryDatabase);
                    memoryDatabase.prepare = sql => {
                        preparedSql.push(sql);
                        const statement = prepare(sql);
                        return new Proxy(statement, {
                            get(target, property) {
                                const value = Reflect.get(target, property, target);
                                if (property === 'get') {
                                    return (...params) => {
                                        preparedGetCalls.push({ sql, params });
                                        return value.apply(target, params);
                                    };
                                }
                                return typeof value === 'function' ? value.bind(target) : value;
                            }
                        });
                    };
                    inMemoryDatabase = memoryDatabase;
                    return memoryDatabase;
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
    preparedSql.length = 0;
    preparedGetCalls.length = 0;
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

test('目录搜索可从命中媒体提取名称匹配的祖先目录', () => {
    addFile({
        id: 'nested-media',
        path: '/library/Family Trips/2026/Beach/photo.jpg',
        name: 'photo.jpg',
        folderPath: '/library/Family Trips/2026/Beach'
    });

    assert.deepEqual(
        database.queryFolderPaths({
            parentPath: '/library',
            allowedPaths: ['/library'],
            search: 'Family Trips'
        }),
        ['/library/Family Trips']
    );
});

test('目录搜索同时限制 parent、allowedPaths、limit 和最多 100 条', () => {
    for (let index = 0; index < 105; index += 1) {
        const folder = `/library/allowed/Match ${String(index).padStart(3, '0')}`;
        addFile({
            id: `allowed-${index}`,
            path: `${folder}/photo.jpg`,
            name: 'photo.jpg',
            folderPath: folder
        });
    }
    addFile({
        id: 'outside-parent',
        path: '/library/other/Match Outside/photo.jpg',
        name: 'photo.jpg',
        folderPath: '/library/other/Match Outside'
    });
    addFile({
        id: 'outside-permission',
        path: '/private/Match Private/photo.jpg',
        name: 'photo.jpg',
        folderPath: '/private/Match Private'
    });

    const scoped = database.queryFolderPaths({
        parentPath: '/library/allowed',
        allowedPaths: ['/library/allowed'],
        search: 'Match',
        limit: 2
    });
    assert.deepEqual(scoped, [
        '/library/allowed/Match 000',
        '/library/allowed/Match 001'
    ]);

    const capped = database.queryFolderPaths({
        parentPath: '/library',
        allowedPaths: ['/library'],
        search: 'Match',
        limit: 1000
    });
    assert.equal(capped.length, 100);
    assert.equal(capped.every(folder => folder.startsWith('/library/')), true);
    assert.equal(capped.some(folder => folder.startsWith('/private')), false);
});

test('批量目录封面只匹配自身或真实后代，并为每个目录选择最新媒体', () => {
    const fixtureRoot = path.join(path.parse(process.cwd()).root, 'album');
    const albumA = path.join(fixtureRoot, 'a');
    const albumB = path.join(fixtureRoot, 'b');
    const albumAB = path.join(fixtureRoot, 'ab');
    const albumAWithTrailingSeparator = `${albumA}${path.sep}`;

    addFile({
        id: 'a-direct',
        path: path.join(albumA, 'direct.jpg'),
        name: 'direct.jpg',
        folderPath: albumA,
        lastModified: 20
    });
    addFile({
        id: 'a-newest',
        path: path.join(albumA, 'deep', 'newest.jpg'),
        name: 'newest.jpg',
        folderPath: path.join(albumA, 'deep'),
        lastModified: 30
    });
    addFile({
        id: 'a-audio-newer',
        path: path.join(albumA, 'deep', 'newest.mp3'),
        name: 'newest.mp3',
        folderPath: path.join(albumA, 'deep'),
        mediaType: 'audio',
        lastModified: 40
    });
    addFile({
        id: 'prefix-sibling',
        path: path.join(albumAB, 'newest.jpg'),
        name: 'newest.jpg',
        folderPath: albumAB,
        lastModified: 50
    });
    addFile({
        id: 'b-stable-second',
        path: path.join(albumB, 'second.jpg'),
        name: 'second.jpg',
        folderPath: albumB,
        lastModified: 60
    });
    addFile({
        id: 'b-stable-first',
        path: path.join(albumB, 'first.jpg'),
        name: 'first.jpg',
        folderPath: albumB,
        lastModified: 60
    });

    const covers = database.queryFolderCovers([
        albumA,
        albumB,
        albumAWithTrailingSeparator,
        albumA
    ]);

    assert.equal(covers.get(albumA).id, 'a-newest');
    assert.equal(covers.get(albumB).id, 'b-stable-first');
    assert.equal(covers.get(albumAWithTrailingSeparator).id, 'a-newest');
    assert.equal(covers.has(albumAB), false);
    assert.deepEqual(
        new Set(covers.keys()),
        new Set([albumA, albumB, albumAWithTrailingSeparator])
    );

    const coverSql = preparedSql.find(sql =>
        sql.includes('INDEXED BY idx_folder_path') &&
        sql.includes('ORDER BY f.last_modified DESC, f.id ASC')
    );
    assert.ok(coverSql, '应记录目录封面查询使用的 prepared SQL');

    const coverQueryPaths = preparedGetCalls
        .filter(call => call.sql.includes('INDEXED BY idx_folder_path'))
        .map(call => call.params[0]);
    assert.deepEqual(coverQueryPaths, [albumA, albumB]);

    const descendantStart = albumAWithTrailingSeparator;
    const descendantEnd = `${descendantStart.slice(0, -1)}${String.fromCharCode(descendantStart.charCodeAt(descendantStart.length - 1) + 1)}`;
    const plan = inMemoryDatabase.prepare(`EXPLAIN QUERY PLAN ${coverSql}`).all(
        albumA,
        descendantStart,
        descendantEnd
    );

    assert.equal(plan.some(step => step.detail.includes('idx_folder_path')), true);
    assert.equal(database.queryFolderCovers([]).size, 0);
});
