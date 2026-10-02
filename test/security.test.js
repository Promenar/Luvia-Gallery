const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
    hashPassword,
    isPasswordHash,
    isSafeEntryName,
    normalizeStoredPassword,
    resolveManagedPath,
    verifyPassword
} = require('../lib/security');

const ROOT = path.resolve('/media/library');

test('受管路径必须位于媒体库之内且不能是根目录本身', () => {
    assert.equal(resolveManagedPath(path.join(ROOT, 'album/a.jpg'), [ROOT]), path.join(ROOT, 'album/a.jpg'));
    assert.equal(resolveManagedPath(ROOT, [ROOT]), null);
    assert.equal(resolveManagedPath(`${ROOT}/`, [ROOT]), null);
    assert.equal(resolveManagedPath('/etc/passwd', [ROOT]), null);
    assert.equal(resolveManagedPath(path.join(ROOT, '../other/a.jpg'), [ROOT]), null);
    assert.equal(resolveManagedPath(`${ROOT}-evil/a.jpg`, [ROOT]), null);
    assert.equal(resolveManagedPath('', [ROOT]), null);
    assert.equal(resolveManagedPath(path.join(ROOT, 'a.jpg'), []), null);
    assert.equal(resolveManagedPath(undefined, [ROOT]), null);
});

test('单段文件名校验拒绝分隔符、上级引用与首尾空白', () => {
    assert.equal(isSafeEntryName('新相册 2026'), true);
    assert.equal(isSafeEntryName('photo.final.jpg'), true);
    for (const name of ['', '.', '..', 'a/b', 'a\\b', ' a', 'a ', 'a\0b', 'x'.repeat(256), null, 42]) {
        assert.equal(isSafeEntryName(name), false, `应拒绝 ${JSON.stringify(name)}`);
    }
});

test('口令哈希可校验且每次加盐不同', () => {
    const first = hashPassword('s3cret');
    const second = hashPassword('s3cret');
    assert.equal(isPasswordHash(first), true);
    assert.notEqual(first, second);
    assert.deepEqual(verifyPassword('s3cret', first), { valid: true, needsUpgrade: false });
    assert.deepEqual(verifyPassword('wrong', first), { valid: false, needsUpgrade: false });
});

test('历史明文口令仍可登录并提示升级，错误口令不提示升级', () => {
    assert.deepEqual(verifyPassword('legacy', 'legacy'), { valid: true, needsUpgrade: true });
    assert.deepEqual(verifyPassword('legacyX', 'legacy'), { valid: false, needsUpgrade: false });
    assert.deepEqual(verifyPassword('', ''), { valid: false, needsUpgrade: false });
    assert.deepEqual(verifyPassword(undefined, 'legacy'), { valid: false, needsUpgrade: false });
    assert.deepEqual(verifyPassword('x', 'scrypt$broken'), { valid: false, needsUpgrade: false });
});

test('写入前规范化口令：明文转哈希，已有哈希与空值保持不变', () => {
    const hashed = normalizeStoredPassword('plain');
    assert.equal(isPasswordHash(hashed), true);
    assert.equal(verifyPassword('plain', hashed).valid, true);
    assert.equal(normalizeStoredPassword(hashed), hashed);
    assert.equal(normalizeStoredPassword(''), '');
    assert.equal(normalizeStoredPassword(undefined), undefined);
});
