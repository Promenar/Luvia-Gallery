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
