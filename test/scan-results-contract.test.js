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
