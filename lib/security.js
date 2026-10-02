const crypto = require('crypto');
const path = require('path');

const PASSWORD_HASH_PREFIX = 'scrypt';
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_SALT_BYTES = 16;

/** 判断候选路径是否位于根路径之内（含根路径本身）。 */
function isPathWithin(candidate, root) {
    if (typeof candidate !== 'string' || typeof root !== 'string' || !candidate || !root) {
        return false;
    }

    const relativePath = path.relative(path.resolve(root), path.resolve(candidate));
    return relativePath === '' ||
        (relativePath !== '..' &&
            !relativePath.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relativePath));
}

/**
 * 解析受管写操作的目标路径：必须位于某个媒体库根目录之内，且不能是根目录本身。
 * 返回规范化后的绝对路径；不满足条件时返回 null。
 */
function resolveManagedPath(targetPath, libraryRoots) {
    if (typeof targetPath !== 'string' || !targetPath.trim()) return null;
    if (!Array.isArray(libraryRoots) || libraryRoots.length === 0) return null;

    const resolved = path.resolve(targetPath);
    const isRoot = libraryRoots.some(root => typeof root === 'string' && root && path.resolve(root) === resolved);
    if (isRoot) return null;

    return libraryRoots.some(root => isPathWithin(resolved, root)) ? resolved : null;
}

/** 校验单段文件/目录名，禁止路径分隔符、空名与上级目录引用。 */
function isSafeEntryName(name) {
    if (typeof name !== 'string') return false;
    const trimmed = name.trim();
    if (!trimmed || trimmed !== name) return false;
    if (trimmed === '.' || trimmed === '..') return false;
    if (trimmed.length > 255) return false;
    return !/[\\/\0]/.test(trimmed);
}

function isPasswordHash(value) {
    return typeof value === 'string' && value.startsWith(`${PASSWORD_HASH_PREFIX}$`);
}

/** 生成 scrypt 口令哈希：scrypt$<salt hex>$<hash hex>。 */
function hashPassword(password) {
    const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
    const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEY_LENGTH);
    return `${PASSWORD_HASH_PREFIX}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

/**
 * 校验口令。兼容历史明文存储：明文匹配时返回 needsUpgrade=true，由调用方写回哈希。
 */
function verifyPassword(password, stored) {
    if (typeof password !== 'string' || typeof stored !== 'string' || !stored) {
        return { valid: false, needsUpgrade: false };
    }

    if (!isPasswordHash(stored)) {
        const expected = Buffer.from(stored);
        const actual = Buffer.from(password);
        const valid = expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
        return { valid, needsUpgrade: valid };
    }

    const [, saltHex, hashHex] = stored.split('$');
    if (!saltHex || !hashHex) return { valid: false, needsUpgrade: false };

    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return {
        valid: expected.length === actual.length && crypto.timingSafeEqual(expected, actual),
        needsUpgrade: false
    };
}

/** 写入配置前统一把明文口令转换为哈希；已是哈希的值原样保留。 */
function normalizeStoredPassword(password) {
    if (typeof password !== 'string' || !password) return password;
    return isPasswordHash(password) ? password : hashPassword(password);
}

module.exports = {
    hashPassword,
    isPasswordHash,
    isPathWithin,
    isSafeEntryName,
    normalizeStoredPassword,
    resolveManagedPath,
    verifyPassword
};
