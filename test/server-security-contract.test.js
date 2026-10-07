const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const runnerSource = fs.readFileSync(path.join(__dirname, '..', 'runner.js'), 'utf8');

function getRoute(method, routePath) {
    const marker = `app.${method}('${routePath}'`;
    const start = serverSource.indexOf(marker);
    assert.notEqual(start, -1, `Missing route ${method.toUpperCase()} ${routePath}`);
    const end = serverSource.indexOf('\napp.', start + 1);
    return serverSource.slice(start, end === -1 ? undefined : end);
}

test('破坏性文件操作与目录浏览均要求管理员并限定在媒体库之内', () => {
    for (const routePath of ['/api/file/delete', '/api/file/rename', '/api/folder/delete', '/api/folder/rename']) {
        const route = getRoute('post', routePath);
        assert.match(route, new RegExp(`app\\.post\\('${routePath.replace(/\//g, '\\/')}', adminOnly,`));
        assert.match(route, /resolveAdminManagedPath\(req,/);
    }
    assert.match(getRoute('post', '/api/file/rename'), /isSafeEntryName\(newName\)/);
    assert.match(getRoute('post', '/api/folder/rename'), /isSafeEntryName\(newName\)/);
    assert.match(getRoute('get', '/api/fs/list'), /app\.get\('\/api\/fs\/list', adminOnly,/);
});

test('目录浏览不在免登录白名单中，匿名配置不暴露用户列表', () => {
    const whitelistStart = serverSource.indexOf('const whitelist = [');
    const whitelist = serverSource.slice(whitelistStart, serverSource.indexOf('];', whitelistStart));
    assert.doesNotMatch(whitelist, /\/api\/fs\/list/);

    const configRoute = getRoute('get', '/api/config');
    const anonymousSection = configRoute.slice(configRoute.indexOf('Scenario 3'));
    assert.doesNotMatch(anonymousSection, /users:/);
});

test('缩略图批量任务与智能扫描结果仅管理员可用', () => {
    assert.match(getRoute('post', '/api/thumb-gen/start'), /adminOnly/);
    assert.match(getRoute('post', '/api/thumb-gen/control'), /adminOnly/);
    assert.match(getRoute('post', '/api/thumb/smart-scan'), /adminOnly/);
    assert.match(getRoute('get', '/api/thumb/smart-results'), /adminOnly/);
    assert.match(getRoute('post', '/api/thumb/smart-repair'), /adminOnly/);

    const regenerate = getRoute('post', '/api/thumb/regenerate');
    assert.match(regenerate, /checkFileAccess\(req\.user, filePath\)/);
    assert.match(regenerate, /req\.user\?\.role !== 'admin'/);
});

test('ffmpeg 调用不经过 shell 拼接文件路径', () => {
    assert.doesNotMatch(serverSource, /exec\(`ffmpeg[^`]*\$\{(filePath|file\.path)\}/);
    assert.doesNotMatch(serverSource, /-i "\$\{/);
    const exifRoute = getRoute('get', '/api/file/:id/exif');
    assert.match(exifRoute, /checkFileAccess\(req\.user, filePath\)/);
    assert.match(exifRoute, /execFile\('ffmpeg',/);
});

test('口令只以哈希形式写入配置', () => {
    assert.match(getRoute('post', '/api/auth/login'), /verifyPassword\(password, user\.password\)/);
    assert.match(getRoute('post', '/api/users'), /password: normalizeStoredPassword\(password\)/);
    assert.match(getRoute('post', '/api/users/:targetUser'), /normalizeStoredPassword\(newPassword\)/);
    assert.match(getRoute('post', '/api/users/:targetUser'), /renameFavoritesUser\(targetUser, newUsername\)/);
});

test('更新守护进程未配置令牌时拒绝更新接口', () => {
    const checkAuth = runnerSource.slice(runnerSource.indexOf('function checkAuth('), runnerSource.indexOf('// Main Supervisor Server'));
    assert.doesNotMatch(checkAuth, /return true; \/\/ No token set/);
    assert.match(checkAuth, /if \(!requiredToken\) \{[\s\S]*?return false;/);
    assert.match(checkAuth, /timingSafeEqual/);
    const statusHandler = runnerSource.slice(runnerSource.indexOf("'/api/admin/system/update/status'"));
    assert.match(statusHandler.slice(0, 200), /checkAuth\(req, res\)/);
});

test('时间线分桶接口沿用权限路径过滤，区间参数严格校验', () => {
    const route = getRoute('get', '/api/timeline/buckets');
    assert.match(route, /allowedPaths: isAdmin \? null : userLibraryPaths/);
    assert.match(route, /if \(!isAdmin && userLibraryPaths\.length === 0\)/);
    assert.doesNotMatch(serverSource.slice(serverSource.indexOf('const whitelist = ['), serverSource.indexOf('];', serverSource.indexOf('const whitelist = ['))), /timeline/);

    const helperStart = serverSource.indexOf('function parseTimeRangeQuery(');
    const helperSource = serverSource.slice(helperStart, serverSource.indexOf('\n}', helperStart) + 2);
    const parseTimeRangeQuery = new Function(`return (${helperSource})`)();
    assert.equal(parseTimeRangeQuery({}), null);
    assert.deepEqual(parseTimeRangeQuery({ from: '10', to: '20' }), { from: 10, to: 20 });
    assert.equal(parseTimeRangeQuery({ from: '20', to: '10' }), false);
    assert.equal(parseTimeRangeQuery({ from: 'x', to: '10' }), false);
    assert.equal(parseTimeRangeQuery({ from: '10' }), false);
});

test('媒体文件接口不记录含登录令牌的请求地址', () => {
    const route = getRoute('get', '/api/file/*');
    assert.doesNotMatch(route, /console\.log\([^)]*req\.(url|originalUrl)/);
    assert.doesNotMatch(route, /Range Requested|Media Hit/);
});

test('扫描状态区分手动与定时触发，无变化的扫描不清空时间线缓存', () => {
    assert.match(serverSource, /processScan\('periodic'\)/);
    assert.match(getRoute('post', '/api/scan/start'), /processScan\('manual'\)/);
    assert.match(getRoute('get', '/api/scan/status'), /trigger: scanState\.trigger/);
    assert.match(serverSource, /if \(changedCount > 0\) database\.clearTimelineBucketCache\(\);/);
});
