const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function loadHelper(name, context = {}) {
    const start = serverSource.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `Missing helper: ${name}`);

    const functionSource = serverSource.slice(start).match(/^function [\s\S]*?^\}/m);
    assert.ok(functionSource, `Unable to extract helper: ${name}`);
    return vm.runInNewContext(`(${functionSource[0]})`, context);
}

function getScanResultsRoute() {
    const start = serverSource.indexOf("app.get('/api/scan/results'");
    const end = serverSource.indexOf('\napp.', start + 1);
    assert.notEqual(start, -1, 'Missing /api/scan/results route');
    assert.notEqual(end, -1, 'Unable to isolate /api/scan/results route');
    return serverSource.slice(start, end);
}

function getScanStatusRoute() {
    const start = serverSource.indexOf("app.get('/api/scan/status'");
    const end = serverSource.indexOf('\napp.', start + 1);
    assert.notEqual(start, -1, 'Missing /api/scan/status route');
    assert.notEqual(end, -1, 'Unable to isolate /api/scan/status route');
    return serverSource.slice(start, end);
}

function getLibraryFoldersRoute() {
    const start = serverSource.indexOf("app.get('/api/library/folders'");
    const end = serverSource.indexOf('\n});', start) + 4;
    assert.notEqual(start, -1, 'Missing /api/library/folders route');
    assert.ok(end > 3, 'Unable to isolate /api/library/folders route');
    return serverSource.slice(start, end);
}

test('scan results rejects invalid decimal pagination with HTTP 400', () => {
    const parseScanPagination = loadHelper('parseScanPagination');
    const invalidQueries = [
        { offset: '-1' },
        { offset: '1.5' },
        { offset: '1e2' },
        { offset: '9007199254740992' },
        { limit: '0' },
        { limit: '501' },
        { limit: '10px' }
    ];

    for (const query of invalidQueries) {
        assert.equal(parseScanPagination(query), null);
    }

    const defaults = parseScanPagination({});
    assert.equal(defaults.offset, 0);
    assert.equal(defaults.limit, 100);

    const route = getScanResultsRoute();
    assert.match(route, /if \(!pagination\)[\s\S]*?res\.status\(400\)/);
});

test('scan status only reads constant-time cached statistics', () => {
    const route = getScanStatusRoute();

    assert.match(route, /database\.getCachedStats\(\)/);
    assert.doesNotMatch(route, /database\.getStats\(\)/);
});

test('folder cover formatting refuses a missing cached thumbnail', () => {
    const formatFolderCoverMedia = loadHelper('formatFolderCoverMedia', {
        crypto: { createHash: () => ({ update: () => ({ digest: () => 'cover' }) }) },
        getCachedPath: () => '/cache/missing.webp',
        fs: { existsSync: () => false }
    });

    assert.equal(formatFolderCoverMedia({
        id: 'cover-id',
        path: '/library/cover.jpg',
        type: 'image/jpeg',
        mediaType: 'image',
        name: 'cover.jpg',
        thumbnailPath: '/cache/missing.webp'
    }), null);
});

test('favorites uses the unified database filters and pagination', () => {
    const route = getScanResultsRoute();

    assert.match(route, /const filterOptions = \{[\s\S]*?favoritesOnly,[\s\S]*?sortOption,[\s\S]*?random/);
    assert.match(route, /database\.queryFiles\(\{ \.\.\.filterOptions, offset, limit \}\)/);
    assert.match(route, /database\.countFiles\(filterOptions\)/);
    assert.doesNotMatch(route, /queryFavoriteFiles|countFavoriteFiles|999999|filteredFiles\.slice/);
});

test('path containment rejects a sibling that only shares the root prefix', () => {
    const isPathWithin = loadHelper('isPathWithin', { path });
    const root = path.resolve('/media/library');

    assert.equal(isPathWithin(path.join(root, 'album', 'photo.jpg'), root), true);
    assert.equal(isPathWithin(root, root), true);
    assert.equal(isPathWithin(path.resolve('/media/library-copy/photo.jpg'), root), false);
    assert.equal(isPathWithin(path.parse(root).root, path.parse(root).root), true);
});

test('folder search limit only accepts integers from 1 through 100', () => {
    const parseFolderSearchLimit = loadHelper('parseFolderSearchLimit');

    assert.equal(parseFolderSearchLimit(undefined), 100);
    assert.equal(parseFolderSearchLimit('1'), 1);
    assert.equal(parseFolderSearchLimit('100'), 100);
    for (const value of ['0', '101', '1.5', '1e2', '10px']) {
        assert.equal(parseFolderSearchLimit(value), null);
    }
});

test('folder route batches cover queries and buildFolderResult never queries the database', () => {
    const route = getLibraryFoldersRoute();
    const helper = serverSource.slice(
        serverSource.indexOf('function buildFolderResult('),
        serverSource.indexOf("app.get('/api/library/folders'")
    );

    assert.equal((route.match(/database\.queryFolderCovers\(subs\)/g) || []).length, 3);
    assert.equal((route.match(/database\.queryFolderMetadata\(subs\)/g) || []).length, 3);
    assert.match(route, /buildFolderResult\(\s*folderPath,\s*coverByFolder\.get\(folderPath\) \|\| null,/);
    assert.doesNotMatch(helper, /database\./);
});

test('folder route narrows searched and historical favorite paths to current permissions', () => {
    const route = getLibraryFoldersRoute();

    assert.match(route, /database\.queryFolderPaths\(\{[\s\S]*?parentPath: resolvedParentPath,[\s\S]*?allowedPaths: userLibraryPaths,[\s\S]*?search,[\s\S]*?limit/);
    assert.match(route, /\.filter\(folderPath => isCurrentlyAllowed\(folderPath\)\)/);
    assert.match(route, /favoriteIds\.folders \|\| \[\]\)\.filter\(folderPath => isCurrentlyAllowed\(folderPath\)\)/);
    assert.match(route, /isPathWithin\(path\.resolve\(folderPath\), allowedPath\)/);
});

test('folder route cover selection never calls recursive filesystem cover discovery', () => {
    const route = getLibraryFoldersRoute();
    const folderHelper = serverSource.slice(
        serverSource.indexOf('function buildFolderResult('),
        serverSource.indexOf("app.get('/api/library/folders'")
    );

    assert.doesNotMatch(route, /findCoverMedia/);
    assert.doesNotMatch(folderHelper, /findCoverMedia/);
});

test('folder metadata never performs per-folder synchronous filesystem reads', () => {
    const helper = serverSource.slice(
        serverSource.indexOf('function buildFolderResult('),
        serverSource.indexOf("app.get('/api/library/folders'")
    );

    assert.doesNotMatch(helper, /readdirSync|statSync/);
    assert.match(helper, /metadata\?\.mediaCount/);
});

test('batch delete passes both decoded path and media id to the database', () => {
    const start = serverSource.indexOf("app.post('/api/file/batch-delete'");
    const end = serverSource.indexOf('\n});', start) + 4;
    const route = serverSource.slice(start, end);

    assert.equal((route.match(/database\.deleteFile\(filePath, id\)/g) || []).length, 2);
});

test('historical folder cover backfill uses paced small batches', () => {
    const start = serverSource.indexOf('async function backfillFolderCoverCache()');
    const end = serverSource.indexOf('\nfunction scheduleFolderCoverBackfill', start);
    const helper = serverSource.slice(start, end);

    assert.match(helper, /getFolderCoverBackfillBatch\(afterRowid, 32\)/);
    assert.match(helper, /setTimeout\(resolve, 10\)/);
});
